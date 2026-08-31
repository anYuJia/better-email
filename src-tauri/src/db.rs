use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, Attachment, BackgroundTask,
    BackgroundTaskInput, CacheClearResult, Contact, ContactCreateInput, ContactImportBatch,
    ContactImportCommitSummary, ContactImportPreviewEntry, ContactImportUndoReport, ContactInput,
    CredentialStatus, DraftInput, Folder, ImapFlagSnapshot, ImapFolderProbe, ImapHeaderBatch,
    ImapMailboxState, ImapReconcileResult, Label, LocalBackup, LocalBackupRow, LocalBackupSummary,
    MailIdentity, MailIdentityInput, MailRule, MailRuleInput, MailStats,
    MailboxSyncTransactionResult, Message, MessageSummary, MessageThreadingInput,
    OAuthCallbackReport, OAuthSession, OAuthStartReport, OAuthTokenExchangeReport,
    OutboundAttachmentInput, OutboundMessage, OutboxItem, PendingRemoteWrite,
    RecentContactSyncReport, ReleasedSnoozedCount, RemoteImageTrust, RemoteImageTrustInput,
    RemoteMessageBody, StorageUsage, SyncRun, SyncSchedulePlan, ThreadSummary,
};
use crate::protocol;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{
    params, params_from_iter,
    types::{Value, ValueRef},
    Connection, OptionalExtension, Row,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use thiserror::Error;

mod accounts;
pub(crate) mod ai_settings;
mod app_settings;
mod attachments;
mod background_tasks;
mod backup;
mod contacts_rules;
mod folders;
mod labels;
mod messages;
mod migrations;
mod oauth;
mod outbox;
#[cfg(test)]
mod paging_tests;
mod search;
mod sync;

use self::accounts::{ensure_default_account_for_conn, ensure_default_identity_for_account_conn};
#[cfg(test)]
use self::contacts_rules::upsert_contact;
use self::folders::{create_default_folders_for_account, folder_id_for_role};
use self::messages::thread_key_for_message;
use self::migrations::migrate_legacy_database;

#[derive(Debug, Error)]
pub enum MailError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("application data directory is unavailable")]
    MissingDataDir,
    #[error("database connection lock is unavailable")]
    DatabaseLockPoisoned,
    #[error("folder role not found: {0}")]
    MissingFolderRole(String),
    #[error("{0}")]
    Smtp(String),
    #[error("{0}")]
    Imap(String),
    /// 系统对话框被用户取消（另存为/选择文件等）：不是失败，调用方应保持现状。
    #[error("操作已取消。")]
    Cancelled,
}

impl serde::Serialize for MailError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type MailResult<T> = Result<T, MailError>;

const VERBOSE_DB_LOG_ENV: &str = "BETTER_EMAIL_VERBOSE_COMMAND_LOGS";

fn verbose_db_logs_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var(VERBOSE_DB_LOG_ENV)
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
}

fn db_info(message: impl AsRef<str>) {
    if verbose_db_logs_enabled() {
        crate::logging::log_line(message);
    }
}

fn mask_email_for_log(value: &str) -> String {
    let email = value.trim();
    let Some((local, domain)) = email.split_once('@') else {
        return if email.is_empty() {
            String::new()
        } else {
            "***".to_string()
        };
    };
    let first = local.chars().next().unwrap_or('*');
    format!("{first}***@{}", domain.trim())
}

#[derive(Debug, Clone)]
pub struct OAuthTokenExchangeSession {
    pub id: i64,
    pub account_email: String,
    pub provider: String,
    pub redirect_uri: String,
    pub code_verifier: String,
    pub scopes: Vec<String>,
    pub authorization_code: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct UnreadMessageRemoteRef {
    pub account_id: i64,
    pub remote_mailbox: String,
    pub remote_uid: i64,
}

#[derive(Debug, Clone)]
pub struct MessageRemoteRef {
    pub account_id: i64,
    pub remote_mailbox: String,
    pub remote_uid: i64,
    pub message_id_header: String,
}

const LOCAL_BACKUP_SCHEMA_VERSION: i64 = 1;
const THREAD_KEY_SCHEMA_VERSION: i64 = 1;
/// messages_au 触发器改为仅在 FTS 索引字段变化时重建的版本号。
const FTS_UPDATE_TRIGGER_SCHEMA_VERSION: i64 = 2;
const DATABASE_FILENAME: &str = "better-email.sqlite3";
const LEGACY_DATABASE_FILENAME: &str = "swiftmail.sqlite3";
const LEGACY_APP_IDENTIFIER: &str = "app.swiftmail.client";
const DEMO_DATA_SEED_ENV: &str = "BETTER_EMAIL_SEED_DEMO_DATA";
const LOCAL_BACKUP_TABLES: &[&str] = &[
    "accounts",
    "folders",
    "messages",
    "muted_threads",
    "labels",
    "message_labels",
    "mail_identities",
    "attachments",
    "remote_image_trusts",
    "sync_runs",
    "contacts",
    "mail_rules",
    "outbox_queue",
    "background_tasks",
    "imap_mailboxes",
    "oauth_sessions",
];

#[derive(Clone)]
pub struct MailStore {
    conn: Arc<Mutex<Connection>>,
    data_dir: PathBuf,
    database_path: PathBuf,
}

impl MailStore {
    pub fn open(app: &AppHandle) -> MailResult<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| MailError::MissingDataDir)?;
        fs::create_dir_all(&data_dir)?;
        let database_path = data_dir.join(DATABASE_FILENAME);
        if !database_path.exists() {
            migrate_legacy_database(&data_dir, &database_path)?;
        }
        Self::open_at(database_path)
    }

    pub fn open_at(path: PathBuf) -> MailResult<Self> {
        Self::open_at_with_seed(path, demo_data_seed_enabled())
    }

    fn open_at_with_seed(path: PathBuf, seed_demo_data: bool) -> MailResult<Self> {
        let data_dir = path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        fs::create_dir_all(&data_dir)?;
        let should_seed_demo_data = seed_demo_data && !path.exists();
        db_info(format!(
            "[better-email][db] open path={} should_seed_demo_data={}",
            path.display(),
            should_seed_demo_data,
        ));
        let conn = Connection::open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&path) {
                let mut permissions = metadata.permissions();
                if permissions.mode() & 0o777 != 0o600 {
                    permissions.set_mode(0o600); // User read & write only
                    if let Err(error) = std::fs::set_permissions(&path, permissions) {
                        crate::logging::log_line(format!(
                            "[better-email][db][warning] Failed to enforce 0o600 database file permissions: {}",
                            error
                        ));
                    }
                }
            } else {
                crate::logging::log_line(
                    "[better-email][db][warning] Failed to read database metadata to check permissions",
                );
            }
        }
        let store = Self {
            conn: Arc::new(Mutex::new(conn)),
            data_dir,
            database_path: path,
        };
        // 账号凭据只保存在应用自己的 SQLite 数据库，任何路径都不访问
        // 系统凭据库（Keychain / Credential Manager），因此启动、更新检查、
        // 打开设置页乃至查看邮件都不会触发 macOS Keychain 授权提示。
        store.migrate()?;
        if !seed_demo_data {
            store.remove_demo_seed_data()?;
        }
        store.seed_if_empty(should_seed_demo_data)?;
        // 启动时清理不再被任何草稿/发件箱引用的临时附件（异常退出后的孤儿文件按安全 TTL 清理）。
        let _ = store.prune_temp_attachments(std::time::Duration::from_secs(60));
        db_info("[better-email][db] open ok");
        Ok(store)
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> MailResult<T>) -> MailResult<T> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        f(&conn)
    }

    fn seed_if_empty(&self, should_seed_demo_data: bool) -> MailResult<()> {
        if !should_seed_demo_data {
            db_info("[better-email][db] seed skipped existing database");
            return Ok(());
        }
        self.with_conn(|conn| {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))?;
            if count > 0 {
                db_info(format!(
                    "[better-email][db] seed skipped existing_accounts={count}"
                ));
                return Ok(());
            }
            db_info("[better-email][db] seed demo data start");

            let now = Utc::now();
            conn.execute(
                "INSERT INTO accounts(email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, is_default, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'imap', ?6, ?7, 0, ?8, 1, ?9)",
                params![
                    "demo@better-email.local",
                    "Better Email Demo",
                    "Local",
                    "imap.example.com:993",
                    "smtp.example.com:465",
                    "password",
                    "manual",
                    "Sent from Better Email",
                    now.to_rfc3339()
                ],
            )?;
            let account_id = conn.last_insert_rowid();
            ensure_default_identity_for_account_conn(
                conn,
                account_id,
                "Better Email Demo",
                "demo@better-email.local",
                "Sent from Better Email",
            )?;

            create_default_folders_for_account(conn, account_id)?;

            for (name, color) in [
                ("工作", "#2f7ed8"),
                ("稍后处理", "#d97706"),
                ("重要客户", "#7c3aed"),
            ] {
                conn.execute(
                    "INSERT INTO labels(name, color) VALUES (?1, ?2)",
                    params![name, color],
                )?;
            }

            for (name, condition, action) in [
                ("重要客户置顶", "from contains customer", "apply label 重要客户"),
                ("安全提醒标记", "subject contains 安全", "apply label 工作"),
                ("新闻邮件稍后处理", "from contains updates", "apply label 稍后处理"),
            ] {
                conn.execute(
                    "INSERT INTO mail_rules(name, condition, action, enabled) VALUES (?1, ?2, ?3, 1)",
                    params![name, condition, action],
                )?;
            }

            let inbox_id = folder_id_for_role(conn, "inbox")?;
            let sent_id = folder_id_for_role(conn, "sent")?;
            let label_work: i64 =
                conn.query_row("SELECT id FROM labels WHERE name = '工作'", [], |row| row.get(0))?;
            let label_later: i64 =
                conn.query_row("SELECT id FROM labels WHERE name = '稍后处理'", [], |row| row.get(0))?;

            let samples = [
                (
                    inbox_id,
                    "Ada Chen",
                    "ada@example.com",
                    "demo@better-email.local",
                    "欢迎来到 Better Email",
                    "这封邮件用于验证列表、阅读、搜索和状态切换。",
                    "你好！\n\nBetter Email 的第一版本地原型已经准备好：三栏布局、SQLite 本地存储、搜索、标星、已读未读、归档、删除、标签、附件元数据和草稿/发送都可以先跑通。\n\n下一步会接入 IMAP/SMTP 和真实账号同步。",
                    0,
                    1,
                    0,
                    now - Duration::minutes(18),
                    Some(label_work),
                ),
                (
                    inbox_id,
                    "Product Robot",
                    "updates@example.com",
                    "demo@better-email.local",
                    "低内存设计检查清单",
                    "分页加载、懒加载正文、附件按需下载、HTML 安全渲染。",
                    "低内存路线：\n\n1. 邮件列表只查头信息和摘要。\n2. 正文按需加载，附件仅保存元数据。\n3. SQLite FTS5 负责本地搜索。\n4. 同步队列限流，避免一次性解析大量邮件。",
                    0,
                    0,
                    0,
                    now - Duration::hours(3),
                    Some(label_later),
                ),
                (
                    inbox_id,
                    "Security Team",
                    "security@example.com",
                    "demo@better-email.local",
                    "HTML 邮件安全策略",
                    "默认阻止远程图片，后续接入 HTML 清洗和钓鱼提示。",
                    "安全默认值很重要：凭据进入本地 SQLite 凭据表，HTML 邮件必须清洗，远程图片默认阻止，日志自动脱敏。",
                    1,
                    0,
                    1,
                    now - Duration::days(1),
                    Some(label_work),
                ),
                (
                    sent_id,
                    "Better Email Demo",
                    "demo@better-email.local",
                    "team@example.com",
                    "项目启动计划",
                    "先完成本地闭环，再接入真实同步协议。",
                    "团队好，\n\n第一阶段我们会优先完成本地数据闭环、主界面和核心邮件操作。第二阶段接 IMAP/SMTP/OAuth2。",
                    1,
                    0,
                    0,
                    now - Duration::days(2),
                    None,
                ),
            ];

            for (
                folder_id,
                sender_name,
                sender_email,
                recipients,
                subject,
                snippet,
                body,
                is_read,
                is_starred,
                has_attachments,
                received_at,
                label_id,
            ) in samples
            {
                conn.execute(
                    "INSERT INTO messages(account_id, folder_id, sender_name, sender_email, recipients, subject, snippet, body, received_at, is_read, is_starred, has_attachments, thread_key)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        account_id,
                        folder_id,
                        sender_name,
                        sender_email,
                        recipients,
                        subject,
                        snippet,
                        body,
                        received_at.to_rfc3339(),
                        is_read,
                        is_starred,
                        has_attachments,
                        thread_key_for_message(subject, "", "", "")
                    ],
                )?;
                let message_id = conn.last_insert_rowid();
                if let Some(label_id) = label_id {
                    conn.execute(
                        "INSERT INTO message_labels(message_id, label_id) VALUES (?1, ?2)",
                        params![message_id, label_id],
                    )?;
                }
                if has_attachments != 0 {
                    conn.execute(
                        "INSERT INTO attachments(message_id, filename, mime_type, size_bytes, is_downloaded)
                         VALUES (?1, 'security-checklist.pdf', 'application/pdf', 184320, 0)",
                        params![message_id],
                    )?;
                }
                #[cfg(test)]
                upsert_contact(conn, sender_name, sender_email, &received_at.to_rfc3339())?;
            }
            db_info(format!(
                "[better-email][db] seed demo data ok account_id={account_id}"
            ));
            Ok(())
        })
    }

    fn remove_demo_seed_data(&self) -> MailResult<()> {
        self.with_conn(remove_demo_seed_data_for_conn)
    }
}

fn demo_data_seed_enabled() -> bool {
    std::env::var(DEMO_DATA_SEED_ENV)
        .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
        .unwrap_or(false)
}

fn remove_demo_seed_data_for_conn(conn: &Connection) -> MailResult<()> {
    let demo_account_id = conn
        .query_row(
            "
            SELECT id
            FROM accounts
            WHERE email = 'demo@better-email.local'
              AND display_name = 'Better Email Demo'
              AND provider = 'Local'
              AND imap_host = 'imap.example.com:993'
              AND smtp_host = 'smtp.example.com:465'
              AND auth_type = 'password'
              AND signature = 'Sent from Better Email'
            LIMIT 1
            ",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;

    if let Some(account_id) = demo_account_id {
        db_info(format!(
            "[better-email][db] removing built-in demo account account_id={account_id}"
        ));
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])?;
        ensure_default_account_for_conn(conn)?;
    }

    conn.execute(
        "
        DELETE FROM mail_rules
        WHERE (name = '重要客户置顶' AND condition = 'from contains customer' AND action = 'apply label 重要客户')
           OR (name = '安全提醒标记' AND condition = 'subject contains 安全' AND action = 'apply label 工作')
           OR (name = '新闻邮件稍后处理' AND condition = 'from contains updates' AND action = 'apply label 稍后处理')
        ",
        [],
    )?;
    conn.execute(
        "
        DELETE FROM labels
        WHERE NOT EXISTS (
            SELECT 1 FROM message_labels WHERE message_labels.label_id = labels.id
        )
          AND (
            (name = '工作' AND color = '#2f7ed8')
            OR (name = '稍后处理' AND color = '#d97706')
            OR (name = '重要客户' AND color = '#7c3aed')
          )
        ",
        [],
    )?;
    conn.execute(
        "
        DELETE FROM contacts
        WHERE
          (lower(email) = 'ada@example.com'
            AND lower(name) IN ('ada', 'ada chen', 'ada@example.com'))
          OR (lower(email) = 'updates@example.com'
            AND lower(name) IN ('product robot', 'updates@example.com'))
          OR (lower(email) = 'security@example.com'
            AND lower(name) IN ('security team', 'security@example.com'))
          OR (lower(email) = 'demo@better-email.local'
            AND lower(name) IN ('better email demo', 'demo@better-email.local'))
          OR (lower(email) = 'demo@swiftmail.local'
            AND lower(name) = lower(email))
        ",
        [],
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrations::{migrate_legacy_database, path_with_suffix};
    use super::search::{message_order_clause, normalized_list_sort, thread_order_clause};
    use super::*;
    use crate::models::ImapFlagState;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_database_path(prefix: &str) -> PathBuf {
        let unique = TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let data_dir = std::env::temp_dir().join(format!(
            "{prefix}-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap(),
            unique
        ));
        fs::create_dir_all(&data_dir).expect("test data dir created");
        data_dir.join(DATABASE_FILENAME)
    }

    fn test_store() -> MailStore {
        MailStore::open_at_with_seed(test_database_path("better-email-test"), true)
            .expect("test store opens")
    }

    #[test]
    fn db_info_routes_through_timestamped_unified_entry() {
        let text = crate::logging::test_util::with_capture(|| {
            db_info("[better-email][db] open ok");
        });
        assert!(
            text.lines()
                .any(|line| line.ends_with("[better-email][db] open ok")),
            "db_info 应经由统一日志入口输出并带时间戳，实际输出：{text}"
        );
    }

    #[test]
    fn legacy_database_files_migrate_to_better_email_name() {
        let unique = TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let data_dir = std::env::temp_dir().join(format!(
            "better-email-migration-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&data_dir).expect("migration dir created");
        let legacy_path = data_dir.join(LEGACY_DATABASE_FILENAME);
        let database_path = data_dir.join(DATABASE_FILENAME);
        fs::write(&legacy_path, b"legacy database").expect("legacy database written");
        fs::write(path_with_suffix(&legacy_path, "-wal"), b"legacy wal")
            .expect("legacy wal written");

        migrate_legacy_database(&data_dir, &database_path).expect("database migrated");

        assert_eq!(
            fs::read(&database_path).expect("new database read"),
            b"legacy database"
        );
        assert_eq!(
            fs::read(path_with_suffix(&database_path, "-wal")).expect("new wal read"),
            b"legacy wal"
        );
        fs::remove_dir_all(data_dir).expect("migration dir removed");
    }

    #[test]
    fn fresh_install_open_never_touches_keychain() {
        // 回归测试：干净安装后，应用启动（打开数据库）绝不能访问系统凭据库，
        // 否则 macOS 会弹出 Keychain 授权提示。这里验证全新数据库可以直接
        // 打开、没有账号、并且可以安全地再次打开（模拟重启）。
        let db_path = test_database_path("better-email-clean-install");
        let store = MailStore::open_at(db_path.clone()).expect("fresh store opens");
        assert!(store.list_accounts().expect("accounts load").is_empty());

        let reopened = MailStore::open_at(db_path).expect("store reopens");
        assert!(reopened.list_accounts().expect("accounts load").is_empty());
    }

    #[test]
    fn opening_store_does_not_move_legacy_secrets_to_keychain() {
        // 回归测试：旧版本保存在 SQLite account_credentials 中的明文凭据，
        // 在启动路径上必须原样保留，不得被迁移进系统凭据库（那会触发
        // Keychain 写入/授权提示）。迁移只允许在用户执行邮件操作时惰性发生。
        let db_path = test_database_path("better-email-no-startup-migration");
        let store = MailStore::open_at(db_path.clone()).expect("store opens");
        store
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO accounts(id, email, display_name, provider, created_at)
                     VALUES (900, 'legacy@example.com', 'Legacy', 'gmail', '2026-07-15')",
                    [],
                )?;
                conn.execute(
                    "INSERT INTO account_credentials(account_email, secret, updated_at)
                     VALUES ('legacy@example.com', 'LEGACY_PLAINTEXT_SECRET', '2026-07-15')",
                    [],
                )?;
                Ok(())
            })
            .expect("legacy secret seeded");

        let reopened = MailStore::open_at(db_path).expect("store reopens");
        let remaining: i64 = reopened
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT COUNT(*) FROM account_credentials
                     WHERE account_email = 'legacy@example.com' AND secret = 'LEGACY_PLAINTEXT_SECRET'",
                    [],
                    |row| row.get::<_, i64>(0),
                )?)
            })
            .expect("legacy row still queryable");
        assert_eq!(
            remaining, 1,
            "startup must not migrate or erase SQLite secrets"
        );
    }

    #[test]
    fn legacy_messages_missing_columns_upgrade_in_place() {
        // 回归测试：旧版本 messages 表缺少 remote_uid/remote_mailbox 等列时，
        // 打开数据库必须先补齐兼容列、再创建依赖这些列的索引/触发器/FTS，
        // 否则启动会永久失败。这里构造真实旧库并验证迁移成功、列与索引存在、
        // 重复打开（模拟重启）依然成功。
        let data_dir = std::env::temp_dir().join(format!(
            "better-email-legacy-messages-{}-{}",
            std::process::id(),
            TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&data_dir).expect("legacy dir created");
        let db_path = data_dir.join(DATABASE_FILENAME);

        {
            // 构造「旧版本」数据库：messages 表只有历史列，没有 remote_uid、
            // remote_mailbox、message_id_header、in_reply_to_header、
            // references_header、cc、bcc、sanitized_html、security_warnings、snoozed_until。
            let legacy = rusqlite::Connection::open(&db_path).expect("legacy db opened");
            legacy
                .execute_batch(
                    "
                    CREATE TABLE accounts (
                        id INTEGER PRIMARY KEY,
                        email TEXT NOT NULL UNIQUE,
                        display_name TEXT NOT NULL,
                        provider TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );
                    CREATE TABLE folders (
                        id INTEGER PRIMARY KEY,
                        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        role TEXT NOT NULL,
                        sort_order INTEGER NOT NULL DEFAULT 0,
                        UNIQUE(account_id, role)
                    );
                    CREATE TABLE messages (
                        id INTEGER PRIMARY KEY,
                        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                        folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                        sender_name TEXT NOT NULL,
                        sender_email TEXT NOT NULL,
                        recipients TEXT NOT NULL,
                        subject TEXT NOT NULL,
                        snippet TEXT NOT NULL,
                        body TEXT NOT NULL,
                        received_at TEXT NOT NULL,
                        is_read INTEGER NOT NULL DEFAULT 0,
                        is_starred INTEGER NOT NULL DEFAULT 0,
                        has_attachments INTEGER NOT NULL DEFAULT 0,
                        thread_key TEXT NOT NULL DEFAULT ''
                    );
                    INSERT INTO accounts(id, email, display_name, provider, created_at)
                    VALUES (1, 'legacy@example.com', 'Legacy', 'gmail', '2025-01-01T00:00:00Z');
                    INSERT INTO folders(id, account_id, name, role, sort_order)
                    VALUES (1, 1, 'Inbox', 'inbox', 0);
                    INSERT INTO messages(
                        id, account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, is_read, is_starred, has_attachments
                    )
                    VALUES (10, 1, 1, 'Old Sender', 'old@example.com', 'me@example.com',
                            'Old subject', 'old snippet', '', '2025-01-02T00:00:00Z', 0, 0, 0);
                    ",
                )
                .expect("legacy schema created");
        }

        let store = MailStore::open_at(db_path.clone()).expect("legacy database migrates");
        let (has_remote_uid, has_remote_mailbox, has_message_id_header) = store
            .with_conn(|conn| {
                let mut stmt = conn.prepare("PRAGMA table_info(messages)")?;
                let names = stmt
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok((
                    names.contains(&"remote_uid".to_string()),
                    names.contains(&"remote_mailbox".to_string()),
                    names.contains(&"message_id_header".to_string()),
                ))
            })
            .expect("messages columns inspected");
        assert!(has_remote_uid, "remote_uid 列应已补齐");
        assert!(has_remote_mailbox, "remote_mailbox 列应已补齐");
        assert!(has_message_id_header, "message_id_header 列应已补齐");

        let index_exists = store
            .with_conn(|conn| {
                let count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                     WHERE type = 'index' AND name = 'idx_messages_remote_uid'",
                    [],
                    |row| row.get(0),
                )?;
                Ok(count > 0)
            })
            .expect("index lookup");
        assert!(index_exists, "idx_messages_remote_uid 索引应已创建");

        // 迁移后旧消息仍可读，且新列有默认值。
        let legacy_message = store
            .with_conn(|conn| {
                let subject = conn.query_row(
                    "SELECT subject, remote_uid, remote_mailbox FROM messages WHERE id = 10",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                Ok(subject)
            })
            .expect("legacy message read");
        assert_eq!(legacy_message.0, "Old subject");
        assert_eq!(legacy_message.1, 0);
        assert_eq!(legacy_message.2, "");

        // 重复打开（模拟重启）必须依然成功。
        let reopened = MailStore::open_at(db_path).expect("legacy database reopens");
        let reopened_ok = reopened
            .with_conn(|conn| {
                let count: i64 =
                    conn.query_row("SELECT COUNT(*) FROM messages WHERE id = 10", [], |row| {
                        row.get(0)
                    })?;
                Ok(count)
            })
            .expect("reopened messages query");
        assert_eq!(reopened_ok, 1);
        drop(reopened);
        drop(store);
        fs::remove_dir_all(data_dir).expect("legacy dir removed");
    }

    #[test]
    fn account_secret_round_trip_stays_in_local_database() {
        // 回归测试：账号凭据只保存在应用自己的 SQLite 数据库。
        // 存储→读取→检查→删除全程不依赖任何系统凭据服务，
        // 在任何平台（含 macOS）都不会触发 Keychain 授权提示。
        let db_path = test_database_path("better-email-sqlite-credentials");
        let store = MailStore::open_at(db_path.clone()).expect("store opens");
        store
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO accounts(id, email, display_name, provider, created_at)
                     VALUES (901, 'sqlite-creds@example.com', 'Sqlite', 'gmail', '2026-07-15')",
                    [],
                )?;
                Ok(())
            })
            .expect("account seeded");

        let account = store.get_account_by_id(Some(901)).expect("account loaded");
        let stored = store
            .store_account_secret("sqlite-creds@example.com", "round-trip-secret")
            .expect("secret stored");
        assert!(stored.exists);

        let secret = store
            .get_account_secret_raw(&account)
            .expect("secret read back");
        assert_eq!(secret, "round-trip-secret");

        let checked = store
            .check_account_secret("sqlite-creds@example.com")
            .expect("secret checked");
        assert!(checked.exists);

        let deleted = store
            .delete_account_secret("sqlite-creds@example.com")
            .expect("secret deleted");
        assert!(!deleted.exists);

        let after_delete = store
            .get_account_secret_raw(&account)
            .expect_err("secret must be gone after delete");
        assert!(after_delete.to_string().contains("未保存"));
    }

    #[test]
    fn seed_creates_core_folders_messages_labels_and_stats() {
        let store = test_store();
        let folders = store.list_folders_for_account(None).expect("folders load");
        assert!(folders.iter().any(|folder| folder.role == "inbox"));
        assert!(store.list_labels().expect("labels load").len() >= 3);
        let stats = store.get_stats_for_account(None).expect("stats load");
        assert!(stats.total_messages >= 4);
        assert!(stats.attachment_messages >= 1);
    }

    #[test]
    fn get_message_account_reads_every_account_column() {
        let store = test_store();
        let account = store.get_account().expect("seeded account loads");
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .expect("folders load")
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .expect("inbox folder exists");
        let message_id = store
            .list_messages_for_scope_sorted(Some(account.id), inbox.id, None, None, None, 1)
            .expect("messages load")
            .first()
            .expect("seeded message exists")
            .id;
        let fetched = store
            .get_message_account(message_id)
            .expect("get_message_account reads all account columns");
        assert_eq!(fetched.id, account.id);
        assert_eq!(fetched.email, account.email);
        assert_eq!(
            fetched.cross_account_risk_warning, account.cross_account_risk_warning,
            "cross_account_risk_warning column must be selected to keep map_account column order"
        );
        assert_eq!(fetched.is_default, account.is_default);
    }

    #[test]
    fn new_database_starts_empty_without_demo_seed_env() {
        let store = MailStore::open_at(test_database_path("better-email-empty-default"))
            .expect("empty default store opens");

        assert!(store.list_accounts().unwrap().is_empty());
        assert!(store.list_folders_for_account(None).unwrap().is_empty());
        assert_eq!(store.get_stats_for_account(None).unwrap().total_messages, 0);
        assert!(store.get_account_by_id_optional(None).unwrap().is_none());
    }

    #[test]
    fn existing_demo_seed_data_is_removed_by_default() {
        let path = test_database_path("better-email-clean-demo");
        {
            let seeded =
                MailStore::open_at_with_seed(path.clone(), true).expect("seeded store opens");
            assert!(seeded
                .list_accounts()
                .unwrap()
                .iter()
                .any(|account| account.email == "demo@better-email.local"));
            assert!(seeded.get_stats_for_account(None).unwrap().total_messages > 0);
            seeded
                .with_conn(|conn| {
                    conn.execute(
                        "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                         VALUES (?1, ?2, ?3, 0, 0, ?4)",
                        params![
                            "demo@swiftmail.local",
                            "demo@swiftmail.local",
                            "demo@swiftmail.local, ada@example.com, security@example.com",
                            Utc::now().to_rfc3339(),
                        ],
                    )?;
                    Ok(())
                })
                .expect("legacy mock contact inserted");
        }

        let cleaned = MailStore::open_at(path).expect("cleaned store opens");
        assert!(cleaned
            .list_accounts()
            .unwrap()
            .iter()
            .all(|account| account.email != "demo@better-email.local"));
        assert_eq!(
            cleaned.get_stats_for_account(None).unwrap().total_messages,
            0
        );
        assert!(cleaned.list_folders_for_account(None).unwrap().is_empty());
        assert!(cleaned.list_labels().unwrap().is_empty());
        assert!(cleaned.list_rules().unwrap().is_empty());
        assert!(cleaned.list_contacts().unwrap().is_empty());
    }

    #[test]
    fn list_sorting_orders_messages_and_threads_with_safe_fallbacks() {
        let store = test_store();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();

        let newest_messages = store
            .list_messages_for_scope_sorted(
                None,
                inbox.id,
                None,
                None,
                Some("newest".to_string()),
                50,
            )
            .unwrap();
        let oldest_messages = store
            .list_messages_for_scope_sorted(
                None,
                inbox.id,
                None,
                None,
                Some("oldest".to_string()),
                50,
            )
            .unwrap();
        let invalid_messages = store
            .list_messages_for_scope_sorted(
                None,
                inbox.id,
                None,
                None,
                Some("received_at DESC; DROP TABLE messages".to_string()),
                50,
            )
            .unwrap();
        assert!(newest_messages.len() >= 2);
        assert_eq!(
            newest_messages.first().map(|message| message.id),
            invalid_messages.first().map(|message| message.id)
        );
        assert!(
            newest_messages.first().unwrap().received_at
                >= newest_messages.last().unwrap().received_at
        );
        assert!(
            oldest_messages.first().unwrap().received_at
                <= oldest_messages.last().unwrap().received_at
        );
        assert_eq!(
            newest_messages.first().unwrap().id,
            oldest_messages.last().unwrap().id
        );
        let unscoped_messages = store
            .list_messages_for_scope_sorted(None, 0, None, None, Some("newest".to_string()), 50)
            .unwrap();
        assert!(unscoped_messages.len() >= newest_messages.len());

        let newest_threads = store
            .list_threads_for_scope_sorted(
                None,
                Some(inbox.id),
                None,
                None,
                Some("newest".to_string()),
                50,
            )
            .unwrap();
        let oldest_threads = store
            .list_threads_for_scope_sorted(
                None,
                Some(inbox.id),
                None,
                None,
                Some("oldest".to_string()),
                50,
            )
            .unwrap();
        let invalid_threads = store
            .list_threads_for_scope_sorted(
                None,
                Some(inbox.id),
                None,
                None,
                Some("latest_at DESC; DROP TABLE messages".to_string()),
                50,
            )
            .unwrap();
        assert!(newest_threads.len() >= 2);
        assert_eq!(
            newest_threads
                .first()
                .map(|thread| thread.thread_key.as_str()),
            invalid_threads
                .first()
                .map(|thread| thread.thread_key.as_str())
        );
        assert!(
            newest_threads.first().unwrap().latest_at >= newest_threads.last().unwrap().latest_at
        );
        assert!(
            oldest_threads.first().unwrap().latest_at <= oldest_threads.last().unwrap().latest_at
        );
        assert_eq!(
            newest_threads.first().unwrap().thread_key,
            oldest_threads.last().unwrap().thread_key
        );

        assert_eq!(normalized_list_sort(Some("sender")), "sender");
        assert_eq!(normalized_list_sort(Some("subject")), "subject");
        assert_eq!(normalized_list_sort(Some("unknown")), "newest");
        assert_eq!(
            message_order_clause(Some("oldest")),
            "julianday(m.received_at) ASC, m.id ASC"
        );
        assert_eq!(
            thread_order_clause(Some("oldest")),
            "latest_at ASC, scoped.thread_key ASC"
        );
    }

    #[test]
    fn search_filters_and_attachment_listing_work() {
        let store = test_store();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let unread = store
            .list_messages_for_scope(None, inbox.id, None, Some("unread".to_string()), 50)
            .unwrap();
        assert!(unread.iter().all(|message| !message.is_read));
        let matches = store
            .list_messages_for_scope(None, inbox.id, Some("安全".to_string()), None, 50)
            .unwrap();
        let message = matches
            .iter()
            .find(|message| message.has_attachments)
            .expect("security message with attachment exists");
        assert_eq!(store.list_attachments(message.id).unwrap().len(), 1);
        let body_matches = store
            .list_messages_for_scope(None, inbox.id, Some("SQLite FTS5".to_string()), None, 50)
            .unwrap();
        assert!(body_matches.iter().any(|message| store
            .get_message(message.id)
            .unwrap()
            .body
            .contains("SQLite FTS5")));
        let from_matches = store
            .list_messages_for_scope(None, inbox.id, Some("from:security".to_string()), None, 50)
            .unwrap();
        assert!(from_matches
            .iter()
            .all(|message| message.sender_email.contains("security")));
        let to_matches = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("to:demo@better-email.local".to_string()),
                None,
                50,
            )
            .unwrap();
        assert!(to_matches
            .iter()
            .all(|message| message.recipients.contains("demo@better-email.local")));
        let account_matches = store
            .list_messages_for_scope(None, inbox.id, Some("account:demo".to_string()), None, 50)
            .unwrap();
        assert!(!account_matches.is_empty());
        assert!(account_matches
            .iter()
            .all(|message| message.account_email.contains("demo")));
        let mailbox_matches = store
            .list_messages_for_scope(None, inbox.id, Some("mailbox:收件箱".to_string()), None, 50)
            .unwrap();
        assert!(!mailbox_matches.is_empty());
        assert!(mailbox_matches
            .iter()
            .all(|message| message.folder_role == "inbox"));
        let attachment_name_matches = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("filename:security-checklist.pdf".to_string()),
                None,
                50,
            )
            .unwrap();
        assert!(attachment_name_matches
            .iter()
            .all(|message| message.has_attachments && message.attachment_count > 0));
        let label_matches = store
            .list_messages_for_scope(None, inbox.id, Some("label:重要".to_string()), None, 50)
            .unwrap();
        assert!(label_matches
            .iter()
            .all(|message| message.labels.iter().any(|label| label == "重要")));
        let subject_matches = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("subject:HTML has:attachment is:read".to_string()),
                None,
                50,
            )
            .unwrap();
        assert!(subject_matches.iter().all(|message| {
            message.subject.contains("HTML") && message.has_attachments && message.is_read
        }));
        let starred_matches = store
            .list_messages_for_scope(None, inbox.id, Some("is:starred".to_string()), None, 50)
            .unwrap();
        assert!(starred_matches.iter().all(|message| message.is_starred));
        let date_matches = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("after:2026-07-01 before:2026-07-20".to_string()),
                None,
                50,
            )
            .unwrap();
        assert!(date_matches.iter().all(|message| {
            message.received_at.as_str() >= "2026-07-01T00:00:00"
                && message.received_at.as_str() <= "2026-07-20T23:59:59"
        }));
    }

    #[test]
    fn changing_download_dir_does_not_rewrite_existing_attachment_paths() {
        // 已有已下载附件的 local_path 是历史落盘位置，设置新下载目录时不得被迁移或改写。
        let store = test_store();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message = store
            .list_messages_for_scope(None, inbox.id, None, None, 50)
            .unwrap()
            .into_iter()
            .find(|message| message.has_attachments)
            .expect("seeded message with attachment exists");
        let attachment = store.list_attachments(message.id).unwrap().remove(0);
        let legacy_path = "/Users/demo/Downloads/better-email/legacy.pdf";
        store
            .mark_attachment_downloaded(attachment.id, legacy_path, attachment.size_bytes)
            .unwrap();

        let custom_dir =
            std::env::temp_dir().join("better-email-download-location-should-not-migrate");
        store
            .validate_and_save_download_dir(&custom_dir.to_string_lossy())
            .expect("save custom download dir");

        let reloaded = store.get_attachment(attachment.id).unwrap();
        assert_eq!(
            reloaded.local_path, legacy_path,
            "已有附件的落盘路径不能被改写"
        );
        let _ = fs::remove_dir_all(&custom_dir);
    }

    #[test]
    fn message_state_move_and_label_changes_are_persisted() {
        let store = test_store();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let labels = store.list_labels().unwrap();
        let label_id = labels[0].id;
        let message = store
            .list_messages_for_scope(None, inbox.id, None, None, 1)
            .unwrap()
            .remove(0);
        store.set_message_read(message.id, true).unwrap();
        store.set_message_starred(message.id, true).unwrap();
        store.apply_label_to_message(message.id, label_id).unwrap();
        store.move_message_to_role(message.id, "archive").unwrap();
        let archive = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "archive")
            .unwrap();
        let moved = store
            .list_messages_for_scope(None, archive.id, None, None, 10)
            .unwrap();
        assert!(moved
            .iter()
            .any(|item| item.id == message.id && item.is_read && item.is_starred));
        store
            .remove_label_from_message(message.id, label_id)
            .unwrap();
    }

    #[test]
    fn folder_mark_read_updates_real_and_virtual_scopes() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let unread_before = store
            .list_messages_for_scope(
                Some(account_id),
                inbox.id,
                None,
                Some("unread".to_string()),
                100,
            )
            .unwrap();
        assert!(!unread_before.is_empty());

        let updated = store
            .mark_folder_read(inbox.id, &inbox.role, false)
            .unwrap();
        assert_eq!(updated.len(), unread_before.len());
        let unread_after = store
            .list_messages_for_scope(
                Some(account_id),
                inbox.id,
                None,
                Some("unread".to_string()),
                100,
            )
            .unwrap();
        assert!(unread_after.is_empty());

        let message = store
            .list_messages_for_scope(Some(account_id), inbox.id, None, None, 1)
            .unwrap()
            .remove(0);
        store.set_message_read(message.id, false).unwrap();
        let virtual_inbox = store
            .list_folders_for_account(None)
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let virtual_updated = store
            .mark_folder_read(virtual_inbox.id, &virtual_inbox.role, true)
            .unwrap();
        assert_eq!(virtual_updated.len(), 1);
        let refreshed_virtual_inbox = store
            .list_folders_for_account(None)
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        assert_eq!(refreshed_virtual_inbox.unread_count, 0);
    }

    #[test]
    fn custom_folders_can_be_created_renamed_moved_into_and_deleted() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message = store
            .list_messages_for_scope(None, inbox.id, None, None, 1)
            .unwrap()
            .remove(0);

        let custom = store
            .create_custom_folder(Some(account_id), "客户跟进".to_string())
            .unwrap();
        assert!(custom.role.starts_with("custom:"));
        assert_eq!(custom.account_id, Some(account_id));
        assert!(!custom.is_virtual);

        let renamed = store
            .rename_custom_folder(custom.id, "重点客户".to_string())
            .unwrap();
        assert_eq!(renamed.name, "重点客户");
        assert_eq!(renamed.role, custom.role);
        assert!(store
            .create_custom_folder(Some(account_id), "重点客户".to_string())
            .is_err());

        store
            .move_message_to_role(message.id, &renamed.role)
            .unwrap();
        let moved = store
            .list_messages_for_scope(None, renamed.id, None, None, 10)
            .unwrap();
        assert!(moved
            .iter()
            .any(|item| item.id == message.id && item.folder_role == renamed.role));

        store.delete_custom_folder(renamed.id).unwrap();
        let folders = store.list_folders_for_account(Some(account_id)).unwrap();
        assert!(!folders.iter().any(|folder| folder.id == renamed.id));
        let inbox_messages = store
            .list_messages_for_scope(None, inbox.id, None, None, 20)
            .unwrap();
        assert!(inbox_messages
            .iter()
            .any(|item| item.id == message.id && item.folder_role == "inbox"));
        assert!(store
            .rename_custom_folder(inbox.id, "不能改".to_string())
            .is_err());
        assert!(store.delete_custom_folder(inbox.id).is_err());
    }

    #[test]
    fn trash_messages_can_be_restored_permanently_deleted_and_emptied() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let folders = store.list_folders_for_account(Some(account_id)).unwrap();
        let inbox = folders
            .iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let trash = folders
            .iter()
            .find(|folder| folder.role == "trash")
            .unwrap();
        let mut messages = store
            .list_messages_for_scope(None, inbox.id, None, None, 2)
            .unwrap();
        let first = messages.remove(0);
        let second = messages.remove(0);

        store.move_message_to_role(first.id, "trash").unwrap();
        let restored = store.restore_message_to_inbox(first.id).unwrap();
        assert_eq!(restored.folder_role, "inbox");
        assert!(store
            .list_messages_for_scope(None, inbox.id, None, None, 20)
            .unwrap()
            .iter()
            .any(|message| message.id == first.id));

        store.move_message_to_role(first.id, "trash").unwrap();
        let deleted_reference = store.delete_message_permanently(first.id).unwrap();
        assert_eq!(deleted_reference.account_id, account_id);
        assert!(!store
            .list_messages_for_scope(None, trash.id, None, None, 20)
            .unwrap()
            .iter()
            .any(|message| message.id == first.id));
        assert!(store.list_attachments(first.id).unwrap().is_empty());

        store.move_message_to_role(second.id, "trash").unwrap();
        let (deleted, references) = store.empty_trash_for_account(Some(account_id)).unwrap();
        assert!(deleted >= 1);
        assert!(!references.is_empty());
        assert!(store
            .list_messages_for_scope(None, trash.id, None, None, 20)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn snoozed_messages_move_to_snoozed_folder_and_restore_to_inbox() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message = store
            .list_messages_for_scope(None, inbox.id, None, None, 1)
            .unwrap()
            .remove(0);

        let snoozed_until = "2026-07-10T09:00:00+08:00";
        let snoozed = store.snooze_message(message.id, snoozed_until).unwrap();
        assert_eq!(snoozed.folder_role, "snoozed");
        assert_eq!(snoozed.snoozed_until, snoozed_until);
        assert!(snoozed.is_read);

        let snoozed_folder = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "snoozed")
            .unwrap();
        let snoozed_messages = store
            .list_messages_for_scope(None, snoozed_folder.id, None, None, 10)
            .unwrap();
        assert!(snoozed_messages.iter().any(|item| {
            item.id == message.id
                && item.folder_role == "snoozed"
                && item.snoozed_until == snoozed_until
        }));

        let restored = store.unsnooze_message(message.id).unwrap();
        assert_eq!(restored.folder_role, "inbox");
        assert_eq!(restored.snoozed_until, "");

        let inbox_messages = store
            .list_messages_for_scope(None, inbox.id, None, None, 10)
            .unwrap();
        assert!(inbox_messages
            .iter()
            .any(|item| item.id == message.id && item.snoozed_until.is_empty()));
    }

    #[test]
    fn due_snoozed_messages_release_back_to_inbox() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let messages = store
            .list_messages_for_scope(None, inbox.id, None, None, 2)
            .unwrap();
        let due = messages[0].id;
        let future = messages[1].id;

        store
            .snooze_message(due, "2026-07-10T09:00:00+08:00")
            .unwrap();
        store
            .snooze_message(future, "2026-07-12T09:00:00+08:00")
            .unwrap();

        let released = store
            .release_due_snoozed_messages("2026-07-11T09:00:00+08:00")
            .unwrap();
        assert_eq!(released.released_count, 1);
        // Verify the released message is now in inbox by querying separately
        let inbox_folder = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let inbox_messages = store
            .list_messages_for_scope(None, inbox_folder.id, None, None, 10)
            .unwrap();
        assert!(inbox_messages.iter().any(|m| m.id == due));
        assert!(inbox_messages
            .iter()
            .find(|m| m.id == due)
            .is_some_and(|m| m.snoozed_until.is_empty()));

        let snoozed_folder = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "snoozed")
            .unwrap();
        let still_snoozed = store
            .list_messages_for_scope(None, snoozed_folder.id, None, None, 10)
            .unwrap();
        assert!(still_snoozed
            .iter()
            .any(|message| message.id == future && message.folder_role == "snoozed"));
    }

    #[test]
    fn remote_mailbox_lookup_uses_local_role_mapping() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let custom_folder = store
            .create_custom_folder(Some(account.id), "项目 Alpha".to_string())
            .unwrap();
        let mailboxes = store
            .save_imap_mailboxes(&[
                ImapFolderProbe {
                    name: "Archive".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Archive".to_string()],
                },
                ImapFolderProbe {
                    name: "Deleted Items".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Trash".to_string()],
                },
                ImapFolderProbe {
                    name: "Projects/Alpha".to_string(),
                    delimiter: "/".to_string(),
                    attributes: Vec::new(),
                },
            ])
            .unwrap();
        let custom_mailbox = mailboxes
            .iter()
            .find(|mailbox| mailbox.remote_name == "Projects/Alpha")
            .unwrap();
        store
            .map_imap_mailbox(custom_mailbox.id, Some(custom_folder.id))
            .unwrap();
        assert_eq!(
            store.remote_mailbox_for_role("archive").unwrap(),
            Some("Archive".to_string())
        );
        assert_eq!(
            store.remote_mailbox_for_role("trash").unwrap(),
            Some("Deleted Items".to_string())
        );
        assert_eq!(store.remote_mailbox_for_role("spam").unwrap(), None);
        assert_eq!(
            store.remote_mailbox_for_role(&custom_folder.role).unwrap(),
            Some("Projects/Alpha".to_string())
        );
        store.map_imap_mailbox(custom_mailbox.id, None).unwrap();
        assert_eq!(
            store.remote_mailbox_for_role(&custom_folder.role).unwrap(),
            None
        );
    }

    #[test]
    fn draft_and_outbox_messages_are_saved_to_expected_folders() {
        let store = test_store();
        let draft_id = store
            .save_draft(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "friend@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Hello".to_string(),
                body: "Draft body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let sent_id = store
            .send_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "team@example.com".to_string(),
                cc: "lead@example.com".to_string(),
                bcc: String::new(),
                subject: "Ship it".to_string(),
                body: "Sent body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let drafts = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let outbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "outbox")
            .unwrap();
        assert!(store
            .list_messages_for_scope(None, drafts.id, Some("Hello".to_string()), None, 10)
            .unwrap()
            .iter()
            .any(|message| message.id == draft_id));
        assert!(store
            .list_messages_for_scope(None, outbox.id, Some("Ship".to_string()), None, 10)
            .unwrap()
            .iter()
            .any(|message| message.id == sent_id));
        assert!(store
            .list_outbox()
            .unwrap()
            .iter()
            .any(|item| item.message_id == sent_id && item.status == "queued"));

        let message_id_header = "<better-email-direct-send@better-email.local>";
        store
            .mark_outbox_smtp_sent_pending_archive(sent_id, message_id_header)
            .unwrap();
        let sent = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "sent")
            .unwrap();
        assert!(store
            .list_messages_for_scope(None, sent.id, Some("Ship".to_string()), None, 10)
            .unwrap()
            .iter()
            .any(|message| message.id == sent_id));
    }

    #[test]
    fn draft_can_be_rendered_and_bound_to_remote_identity() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let draft_id = store
            .save_draft(DraftInput {
                draft_id: 0,
                account_id: account.id,
                identity_id: 0,
                to: "friend@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Remote draft".to_string(),
                body: "Draft body".to_string(),
                html_body: "<p>Draft body</p>".to_string(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        store
            .set_message_threading(
                draft_id,
                Some(MessageThreadingInput {
                    in_reply_to: "<parent@example.com>".to_string(),
                    references: "<root@example.com> <parent@example.com>".to_string(),
                }),
            )
            .unwrap();
        let outbound = store.get_outbound_message(draft_id).unwrap();
        assert_eq!(outbound.in_reply_to_header, "<parent@example.com>");
        assert_eq!(
            outbound.references_header,
            "<root@example.com> <parent@example.com>"
        );
        let message_id_header = crate::smtp::outbound_message_id(&outbound);
        let raw_message = crate::smtp::render_outbound(&outbound).unwrap();
        let rendered = String::from_utf8_lossy(&raw_message);
        assert!(rendered.contains(&format!("Message-ID: {message_id_header}")));
        assert!(rendered.contains("In-Reply-To: <parent@example.com>"));
        assert!(rendered.contains("References: <root@example.com> <parent@example.com>"));
        assert!(rendered.contains("Remote draft"));

        store
            .set_message_remote_identity(draft_id, "Drafts", 73, &message_id_header)
            .unwrap();
        let reference = store.get_message_remote_reference(draft_id).unwrap();
        assert_eq!(reference.remote_mailbox, "Drafts");
        assert_eq!(reference.remote_uid, 73);
        assert_eq!(reference.message_id_header, message_id_header);
    }

    #[test]
    fn send_identities_can_drive_outbound_sender_signature_and_reply_to() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let identities = store.list_identities_for_account(Some(account.id)).unwrap();
        assert_eq!(identities.len(), 1);
        assert!(identities[0].is_default);
        assert_eq!(identities[0].email, account.email);

        let alias = store
            .upsert_identity(MailIdentityInput {
                id: 0,
                account_id: account.id,
                name: "Demo Support".to_string(),
                email: "support@better-email.local".to_string(),
                reply_to: "demo@better-email.local".to_string(),
                signature: "Support signature".to_string(),
                is_default: false,
            })
            .unwrap();
        let queued = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: account.id,
                identity_id: alias.id,
                to: "friend@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Alias send".to_string(),
                body: "Body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let outbox_folder = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "outbox")
            .unwrap();
        let outbox_message = store
            .list_messages_for_scope(
                None,
                outbox_folder.id,
                Some("Alias send".to_string()),
                None,
                10,
            )
            .unwrap()
            .into_iter()
            .find(|message| message.id == queued.message_id)
            .unwrap();
        assert_eq!(outbox_message.sender_name, "Demo Support");
        assert_eq!(outbox_message.sender_email, "support@better-email.local");
        assert!(store
            .get_message(queued.message_id)
            .unwrap()
            .body
            .contains("Support signature"));

        let outbound = store
            .pending_outbox_messages()
            .unwrap()
            .into_iter()
            .find(|message| message.id == queued.message_id)
            .unwrap();
        assert_eq!(outbound.sender_name, "Demo Support");
        assert_eq!(outbound.sender_email, "support@better-email.local");
        assert_eq!(outbound.reply_to, "demo@better-email.local");

        store.delete_identity(alias.id).unwrap();
        assert!(store
            .list_identities_for_account(Some(account.id))
            .unwrap()
            .iter()
            .all(|identity| identity.id != alias.id));
    }

    #[test]
    fn outbound_html_body_is_sanitized_for_drafts_and_outbox() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let unsafe_html = r#"<p><strong>Hello</strong></p><script>alert("x")</script><img src="https://cdn.example.com/open.png">"#;

        let draft_id = store
            .save_draft(DraftInput {
                draft_id: 0,
                account_id: account.id,
                identity_id: 0,
                to: "friend@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "HTML Draft".to_string(),
                body: "Hello".to_string(),
                html_body: unsafe_html.to_string(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let _ignore = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let saved_draft = store.get_message(draft_id).unwrap();
        assert!(saved_draft
            .sanitized_html
            .contains("<strong>Hello</strong>"));
        assert!(!saved_draft.sanitized_html.contains("<script"));
        assert!(!saved_draft
            .sanitized_html
            .contains("https://cdn.example.com/open.png"));

        let queued = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: account.id,
                identity_id: 0,
                to: "friend@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "HTML Outbox".to_string(),
                body: "Hello".to_string(),
                html_body: unsafe_html.to_string(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let outbound = store
            .pending_outbox_messages()
            .unwrap()
            .into_iter()
            .find(|message| message.id == queued.message_id)
            .unwrap();
        assert!(outbound.html_body.contains("<strong>Hello</strong>"));
        assert!(!outbound.html_body.contains("<script"));
        assert!(!outbound
            .html_body
            .contains("https://cdn.example.com/open.png"));
    }

    #[test]
    fn outbound_attachment_metadata_is_saved_with_drafts_and_outbox() {
        let store = test_store();
        let draft_id = store
            .save_draft(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "design@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Attachment draft".to_string(),
                body: "Draft with a local attachment".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: vec![crate::models::OutboundAttachmentInput {
                    filename: "proposal.pdf".to_string(),
                    mime_type: "application/pdf".to_string(),
                    size_bytes: 2048,
                    local_path: "/tmp/proposal.pdf".to_string(),
                    content_id: String::new(),
                    is_inline: false,
                }],
            })
            .unwrap();
        let draft_attachments = store.list_attachments(draft_id).unwrap();
        assert_eq!(draft_attachments.len(), 1);
        assert_eq!(draft_attachments[0].filename, "proposal.pdf");
        assert_eq!(draft_attachments[0].mime_type, "application/pdf");
        assert_eq!(draft_attachments[0].size_bytes, 2048);
        assert!(draft_attachments[0].is_downloaded);
        assert_eq!(draft_attachments[0].local_path, "/tmp/proposal.pdf");

        let _ignore = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let saved_draft = store
            .list_messages_for_scope(
                None,
                _ignore.id,
                Some("Attachment draft".to_string()),
                None,
                10,
            )
            .unwrap()
            .into_iter()
            .find(|message| message.id == draft_id)
            .unwrap();
        assert!(saved_draft.has_attachments);
        assert_eq!(saved_draft.attachment_count, 1);

        let queued = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "queue@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Attachment queue".to_string(),
                body: "Queue with attachment metadata".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: vec![crate::models::OutboundAttachmentInput {
                    filename: "brief.txt".to_string(),
                    mime_type: String::new(),
                    size_bytes: 12,
                    local_path: String::new(),
                    content_id: String::new(),
                    is_inline: false,
                }],
            })
            .unwrap();
        let queued_attachments = store.list_attachments(queued.message_id).unwrap();
        assert_eq!(queued_attachments.len(), 1);
        assert_eq!(queued_attachments[0].filename, "brief.txt");
        assert_eq!(queued_attachments[0].mime_type, "application/octet-stream");
        assert!(!queued_attachments[0].is_downloaded);

        let pending = store.pending_outbox_messages().unwrap();
        let outbound = pending
            .iter()
            .find(|message| message.id == queued.message_id)
            .unwrap();
        assert_eq!(outbound.attachments.len(), 1);
        assert_eq!(outbound.attachments[0].filename, "brief.txt");
    }

    #[test]
    fn account_settings_are_editable() {
        let store = test_store();
        let account = store
            .update_account_settings_for(
                None,
                AccountSettingsInput {
                    display_name: "New Name".to_string(),
                    provider: "Custom".to_string(),
                    imap_host: "imap.mail.test:993".to_string(),
                    smtp_host: "smtp.mail.test:465".to_string(),
                    incoming_protocol: "imap".to_string(),
                    auth_type: "oauth2".to_string(),
                    sync_mode: "5min".to_string(),
                    remote_images_allowed: true,
                    signature: "Regards".to_string(),
                    cross_account_risk_warning: true,
                    block_external_mailboxes: false,
                    intercept_https_links: true,
                    auto_download_attachments: false,
                    fetch_history_attachments: false,
                    warn_external_senders: false,
                },
            )
            .unwrap();
        assert_eq!(account.display_name, "New Name");
        assert_eq!(account.auth_type, "oauth2");
        assert!(account.remote_images_allowed);
        assert!(!account.auto_download_attachments);
        let updated = store
            .update_account_settings_for(
                None,
                AccountSettingsInput {
                    display_name: "New Name".to_string(),
                    provider: "Custom".to_string(),
                    imap_host: "imap.mail.test:993".to_string(),
                    smtp_host: "smtp.mail.test:465".to_string(),
                    incoming_protocol: "imap".to_string(),
                    auth_type: "oauth2".to_string(),
                    sync_mode: "5min".to_string(),
                    remote_images_allowed: true,
                    signature: "Regards".to_string(),
                    cross_account_risk_warning: true,
                    block_external_mailboxes: false,
                    intercept_https_links: true,
                    auto_download_attachments: true,
                    fetch_history_attachments: true,
                    warn_external_senders: true,
                },
            )
            .unwrap();
        assert!(updated.auto_download_attachments);
        assert!(updated.fetch_history_attachments);
    }

    #[test]
    fn remote_image_trusts_are_persisted_and_allow_sender_images() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message_id = store
            .list_messages_for_scope(
                Some(account.id),
                inbox.id,
                Some("安全".to_string()),
                None,
                10,
            )
            .unwrap()
            .first()
            .unwrap()
            .id;
        let body = RemoteMessageBody {
            body: r#"<p>Hello</p><img src="https://cdn.example.com/open.png">"#.to_string(),
            sanitized_html: crate::protocol::sanitize_html(
                r#"<p>Hello</p><img src="https://cdn.example.com/open.png">"#,
            ),
            security_warnings: vec!["检测到远程图片，默认已阻止自动加载。".to_string()],
            snippet: "Hello".to_string(),
            has_attachments: false,
            attachments: Vec::new(),
        };
        let updated = store.update_message_body(message_id, &body).unwrap();
        assert!(!updated
            .sanitized_html
            .contains("https://cdn.example.com/open.png"));

        let trust = store
            .upsert_remote_image_trust(RemoteImageTrustInput {
                account_id: account.id,
                scope: "sender".to_string(),
                value: updated.sender_email.clone(),
            })
            .unwrap();
        assert_eq!(trust.scope, "sender");
        let trusted = store.message_with_remote_image_policy(message_id).unwrap();
        assert!(trusted
            .sanitized_html
            .contains("https://cdn.example.com/open.png"));
        assert!(trusted
            .security_warnings
            .iter()
            .all(|warning| !warning.contains("远程图片")));
    }

    #[test]
    fn accounts_can_be_created_and_scoped_into_unified_views() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "Second@Better-Email.Local".to_string(),
                display_name: "Second Account".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.second.test:993".to_string(),
                smtp_host: "smtp.second.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "15min".to_string(),
                remote_images_allowed: false,
                signature: "Second signature".to_string(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();

        assert_eq!(second_account.email, "second@better-email.local");
        assert!(first_account.is_default);
        assert!(!second_account.is_default);
        assert_eq!(store.list_accounts().unwrap().len(), 2);

        let second_folders = store
            .list_folders_for_account(Some(second_account.id))
            .unwrap();
        assert!(second_folders.iter().any(|folder| {
            !folder.is_virtual
                && folder.account_id == Some(second_account.id)
                && folder.role == "inbox"
        }));

        let unified_folders = store.list_folders_for_account(None).unwrap();
        let unified_inbox = unified_folders
            .iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        assert!(unified_inbox.is_virtual);
        assert_eq!(unified_inbox.name, "统一收件箱");
        assert_eq!(unified_inbox.account_id, None);
        assert!(unified_inbox.id < 0);

        let first_stats = store.get_stats_for_account(Some(first_account.id)).unwrap();
        let second_stats = store
            .get_stats_for_account(Some(second_account.id))
            .unwrap();
        let unified_stats = store.get_stats_for_account(None).unwrap();
        assert_eq!(second_stats.total_messages, 0);
        assert_eq!(unified_stats.total_messages, first_stats.total_messages);

        let unified_messages = store
            .list_messages_for_scope(None, unified_inbox.id, None, None, 50)
            .unwrap();
        assert_eq!(
            store
                .count_messages_for_scope(None, unified_inbox.id, None, None)
                .unwrap(),
            unified_messages.len() as i64
        );
        assert!(!unified_messages.is_empty());
        assert!(unified_messages
            .iter()
            .all(|message| message.account_id == first_account.id));

        let empty_second_inbox = second_folders
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        assert!(store
            .list_messages_for_scope(
                Some(second_account.id),
                empty_second_inbox.id,
                None,
                None,
                50,
            )
            .unwrap()
            .is_empty());
    }

    #[test]
    fn thread_summaries_follow_account_folder_search_and_filter_scope() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "thread-scope@better-email.local".to_string(),
                display_name: "Thread Scope".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.thread-scope.test:993".to_string(),
                smtp_host: "smtp.thread-scope.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        let first_folders = store
            .list_folders_for_account(Some(first_account.id))
            .unwrap();
        let first_inbox = first_folders
            .iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let first_archive = first_folders
            .iter()
            .find(|folder| folder.role == "archive")
            .unwrap();
        let second_inbox = store
            .list_folders_for_account(Some(second_account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let unified_inbox = store
            .list_folders_for_account(None)
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let thread_key = "msgid:<scope-thread@example.com>";

        store
            .with_conn(|conn| {
                let insert = |account_id: i64,
                              folder_id: i64,
                              subject: &str,
                              received_at: &str,
                              is_read: i64|
                 -> MailResult<()> {
                    conn.execute(
                        "
                        INSERT INTO messages(
                            account_id, folder_id, sender_name, sender_email, recipients,
                            subject, snippet, body, received_at, is_read, thread_key
                        ) VALUES (?1, ?2, 'Scope Sender', 'scope@example.com', 'reader@example.com',
                                  ?3, ?3, ?3, ?4, ?5, ?6)
                        ",
                        params![
                            account_id,
                            folder_id,
                            subject,
                            received_at,
                            is_read,
                            thread_key
                        ],
                    )?;
                    Ok(())
                };
                insert(
                    first_account.id,
                    first_inbox.id,
                    "Alpha inbox scope",
                    "2026-07-10T08:00:00Z",
                    0,
                )?;
                insert(
                    first_account.id,
                    first_archive.id,
                    "Archive scope",
                    "2026-07-10T08:05:00Z",
                    1,
                )?;
                insert(
                    second_account.id,
                    second_inbox.id,
                    "Second account scope",
                    "2026-07-10T08:10:00Z",
                    0,
                )?;
                Ok(())
            })
            .unwrap();

        let first_threads = store
            .list_threads_for_scope(Some(first_account.id), Some(first_inbox.id), None, None, 50)
            .unwrap();
        let first_thread = first_threads
            .iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        assert_eq!(first_thread.message_count, 1);
        assert_eq!(first_thread.subject, "Alpha inbox scope");

        let second_threads = store
            .list_threads_for_scope(
                Some(second_account.id),
                Some(second_inbox.id),
                None,
                None,
                50,
            )
            .unwrap();
        let second_thread = second_threads
            .iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        assert_eq!(second_thread.message_count, 1);
        assert_eq!(second_thread.subject, "Second account scope");

        let unified_threads = store
            .list_threads_for_scope(None, Some(unified_inbox.id), None, None, 50)
            .unwrap();
        let unified_thread = unified_threads
            .iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        assert_eq!(unified_thread.message_count, 2);
        assert_eq!(unified_thread.unread_count, 2);

        let archive_threads = store
            .list_threads_for_scope(
                Some(first_account.id),
                Some(first_archive.id),
                None,
                None,
                50,
            )
            .unwrap();
        let archive_thread = archive_threads
            .iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        assert_eq!(archive_thread.message_count, 1);
        assert_eq!(archive_thread.subject, "Archive scope");

        let search_threads = store
            .list_threads_for_scope(
                Some(first_account.id),
                Some(first_inbox.id),
                Some("subject:Alpha".to_string()),
                Some("unread".to_string()),
                50,
            )
            .unwrap();
        assert_eq!(
            search_threads
                .iter()
                .filter(|thread| thread.thread_key == thread_key)
                .count(),
            1
        );

        let starred_threads = store
            .list_threads_for_scope(
                Some(first_account.id),
                Some(first_inbox.id),
                None,
                Some("starred".to_string()),
                50,
            )
            .unwrap();
        assert!(starred_threads
            .iter()
            .all(|thread| thread.thread_key != thread_key));
    }

    #[test]
    fn thread_summaries_decode_mime_encoded_headers() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let thread_key = "msgid:<mime-thread@example.com>";

        store
            .with_conn(|conn| {
                conn.execute(
                    "
                    INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, is_read, thread_key
                    ) VALUES (?1, ?2, ?3, 'pyu.ida@foxmail.com', 'reader@example.com',
                              ?4, 'header only', '', '2026-07-12T00:43:00Z', 0, ?5)
                    ",
                    params![
                        account.id,
                        inbox.id,
                        "=?utf-8?B?cHl1LmlkYQ==?=",
                        "=?utf-8?B?c2E=?=",
                        thread_key
                    ],
                )?;
                Ok(())
            })
            .unwrap();

        let thread = store
            .list_threads_for_scope(Some(account.id), Some(inbox.id), None, None, 50)
            .unwrap()
            .into_iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();

        assert_eq!(thread.subject, "sa");
        assert_eq!(thread.participants, "pyu.ida");
    }

    #[test]
    fn muted_threads_persist_per_account_and_update_thread_summaries() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "thread-mute@better-email.local".to_string(),
                display_name: "Thread Mute".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.thread-mute.test:993".to_string(),
                smtp_host: "smtp.thread-mute.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        let first_inbox = store
            .list_folders_for_account(Some(first_account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let second_inbox = store
            .list_folders_for_account(Some(second_account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let thread_key = "msgid:<shared-muted-thread@example.com>";
        let (first_message_id, second_message_id) = store
            .with_conn(|conn| {
                conn.execute(
                    "
                    INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, is_read, thread_key
                    ) VALUES (?1, ?2, 'Mute Sender', 'mute@example.com', 'reader@example.com',
                              'First muted thread', 'First muted thread', 'First muted thread',
                              '2026-07-11T08:00:00Z', 0, ?3)
                    ",
                    params![first_account.id, first_inbox.id, thread_key],
                )?;
                let first_message_id = conn.last_insert_rowid();
                conn.execute(
                    "
                    INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, is_read, thread_key
                    ) VALUES (?1, ?2, 'Mute Sender', 'mute@example.com', 'reader@example.com',
                              'Second visible thread', 'Second visible thread', 'Second visible thread',
                              '2026-07-11T08:05:00Z', 0, ?3)
                    ",
                    params![second_account.id, second_inbox.id, thread_key],
                )?;
                Ok((first_message_id, conn.last_insert_rowid()))
            })
            .unwrap();

        assert_eq!(
            store
                .set_threads_muted_for_messages(&[first_message_id], true)
                .unwrap(),
            1
        );
        assert_eq!(
            store.list_muted_thread_keys(first_account.id).unwrap(),
            vec![thread_key.to_string()]
        );
        assert!(store
            .list_muted_thread_keys(second_account.id)
            .unwrap()
            .is_empty());

        let first_thread = store
            .list_threads_for_scope(Some(first_account.id), Some(first_inbox.id), None, None, 50)
            .unwrap()
            .into_iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        let second_thread = store
            .list_threads_for_scope(
                Some(second_account.id),
                Some(second_inbox.id),
                None,
                None,
                50,
            )
            .unwrap()
            .into_iter()
            .find(|thread| thread.thread_key == thread_key)
            .unwrap();
        assert!(first_thread.is_muted);
        assert!(!second_thread.is_muted);

        assert_eq!(
            store
                .set_threads_muted_for_messages(&[second_message_id], false)
                .unwrap(),
            1
        );
        assert!(store
            .list_muted_thread_keys(second_account.id)
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .set_threads_muted_for_messages(&[first_message_id], false)
                .unwrap(),
            1
        );
        assert!(store
            .list_muted_thread_keys(first_account.id)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn default_account_can_be_changed_and_remains_unique() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "default@better-email.local".to_string(),
                display_name: "Default Account".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.default.test:993".to_string(),
                smtp_host: "smtp.default.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();

        let updated = store.set_default_account(second_account.id).unwrap();
        assert!(updated.is_default);
        assert_eq!(store.get_account().unwrap().id, second_account.id);

        let accounts = store.list_accounts().unwrap();
        assert_eq!(accounts[0].id, second_account.id);
        assert_eq!(
            accounts.iter().filter(|account| account.is_default).count(),
            1
        );
        assert!(
            !accounts
                .iter()
                .find(|account| account.id == first_account.id)
                .unwrap()
                .is_default
        );

        let error = store.set_default_account(999_999).unwrap_err().to_string();
        assert!(error.contains("邮箱账号不存在"));
    }

    #[test]
    fn accounts_can_be_safely_deleted_with_related_data() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "remove@better-email.local".to_string(),
                display_name: "Remove Me".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.remove.test:993".to_string(),
                smtp_host: "smtp.remove.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: "Remove signature".to_string(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        store.set_default_account(second_account.id).unwrap();

        let (message_id, attachment_id) = store
            .with_conn(|conn| {
                let inbox_id: i64 = conn.query_row(
                    "SELECT id FROM folders WHERE account_id = ?1 AND role = 'inbox'",
                    params![second_account.id],
                    |row| row.get(0),
                )?;
                conn.execute(
                    "INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at
                     ) VALUES (?1, ?2, 'Sender', 'sender@example.com', ?3, 'Subject', 'Snippet', 'Body', ?4)",
                    params![
                        second_account.id,
                        inbox_id,
                        second_account.email,
                        Utc::now().to_rfc3339()
                    ],
                )?;
                let message_id = conn.last_insert_rowid();
                conn.execute(
                    "INSERT INTO attachments(message_id, filename, mime_type, size_bytes)
                     VALUES (?1, 'sample.txt', 'text/plain', 12)",
                    params![message_id],
                )?;
                let attachment_id = conn.last_insert_rowid();
                conn.execute(
                    "INSERT INTO outbox_queue(message_id, status, queued_at)
                     VALUES (?1, 'queued', ?2)",
                    params![message_id, Utc::now().to_rfc3339()],
                )?;
                conn.execute(
                    "INSERT INTO remote_image_trusts(account_id, scope, value, created_at)
                     VALUES (?1, 'sender', 'sender@example.com', ?2)",
                    params![second_account.id, Utc::now().to_rfc3339()],
                )?;
                conn.execute(
                    "INSERT INTO imap_mailboxes(account_id, remote_name, last_seen_at)
                     VALUES (?1, 'INBOX', ?2)",
                    params![second_account.id, Utc::now().to_rfc3339()],
                )?;
                conn.execute(
                    "INSERT INTO oauth_sessions(
                        account_id, provider, authorization_url, redirect_uri, state,
                        code_challenge, code_verifier, scopes, created_at
                     ) VALUES (?1, 'custom', 'https://auth.example.com', 'better-email://oauth',
                        ?2, 'challenge', 'verifier', 'mail.read', ?3)",
                    params![
                        second_account.id,
                        format!("remove-account-{}", second_account.id),
                        Utc::now().to_rfc3339()
                    ],
                )?;
                Ok((message_id, attachment_id))
            })
            .unwrap();

        let next_account = store.delete_account(second_account.id).unwrap().unwrap();
        assert_eq!(next_account.id, first_account.id);
        assert!(next_account.is_default);
        assert_eq!(store.list_accounts().unwrap().len(), 1);

        store
            .with_conn(|conn| {
                for table in [
                    "folders",
                    "messages",
                    "mail_identities",
                    "remote_image_trusts",
                    "imap_mailboxes",
                    "oauth_sessions",
                ] {
                    let sql = format!("SELECT COUNT(*) FROM {table} WHERE account_id = ?1");
                    let count: i64 =
                        conn.query_row(&sql, params![second_account.id], |row| row.get(0))?;
                    assert_eq!(count, 0, "{table} should be cleared");
                }
                let outbox_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM outbox_queue WHERE message_id = ?1",
                    params![message_id],
                    |row| row.get(0),
                )?;
                let attachment_count: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM attachments WHERE id = ?1",
                    params![attachment_id],
                    |row| row.get(0),
                )?;
                assert_eq!(outbox_count, 0);
                assert_eq!(attachment_count, 0);
                Ok(())
            })
            .unwrap();

        let final_account = store.delete_account(first_account.id).unwrap();
        assert!(final_account.is_none());
        assert!(store.list_accounts().unwrap().is_empty());
        assert!(store.get_account_by_id_optional(None).unwrap().is_none());
    }

    fn create_additional_account(store: &MailStore, email: &str) -> Account {
        store
            .create_account(AccountCreateInput {
                email: email.to_string(),
                display_name: format!("Account {email}"),
                provider: "Custom".to_string(),
                imap_host: format!("imap.{email}:993"),
                smtp_host: format!("smtp.{email}:465"),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap()
    }

    #[test]
    fn remove_account_deletes_credentials_atomically_when_requested() {
        let store = test_store();
        let account = store.get_account().unwrap();
        store
            .store_account_secret(&account.email, "remove-secret")
            .unwrap();
        assert!(store.check_account_secret(&account.email).unwrap().exists);

        let next_account = store.remove_account(account.id, true).unwrap();
        assert!(next_account.is_none());
        assert!(store.list_accounts().unwrap().is_empty());
        assert!(!store.check_account_secret(&account.email).unwrap().exists);
    }

    #[test]
    fn remove_account_preserves_credentials_when_flag_disabled() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = create_additional_account(&store, "keep-secret@better-email.local");
        store
            .store_account_secret(&second_account.email, "keep-me")
            .unwrap();

        let next_account = store
            .remove_account(second_account.id, false)
            .unwrap()
            .unwrap();
        assert_eq!(next_account.id, first_account.id);
        assert!(next_account.is_default);
        let status = store.check_account_secret(&second_account.email).unwrap();
        assert!(
            status.exists,
            "credentials must survive removal when disabled"
        );
    }

    #[test]
    fn remove_account_succeeds_without_stored_credentials() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = create_additional_account(&store, "no-secret@better-email.local");
        assert!(
            !store
                .check_account_secret(&second_account.email)
                .unwrap()
                .exists
        );

        let next_account = store
            .remove_account(second_account.id, true)
            .unwrap()
            .unwrap();
        assert_eq!(next_account.id, first_account.id);
        assert!(store
            .list_accounts()
            .unwrap()
            .iter()
            .all(|account| account.id != second_account.id));
    }

    #[test]
    fn remove_account_switches_default_to_next_account() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = create_additional_account(&store, "default-switch@better-email.local");
        store.set_default_account(second_account.id).unwrap();

        let next_account = store
            .remove_account(second_account.id, true)
            .unwrap()
            .unwrap();
        assert_eq!(next_account.id, first_account.id);
        assert!(next_account.is_default);
        assert_eq!(
            store
                .list_accounts()
                .unwrap()
                .iter()
                .filter(|account| account.is_default)
                .count(),
            1
        );
    }

    #[test]
    fn remove_account_failure_leaves_accounts_and_credentials_untouched() {
        let store = test_store();
        let account = store.get_account().unwrap();
        store
            .store_account_secret(&account.email, "still-here")
            .unwrap();

        let error = store.remove_account(999_999, true).unwrap_err().to_string();
        assert!(error.contains("邮箱账号不存在"));
        assert_eq!(store.list_accounts().unwrap().len(), 1);
        assert!(
            store.check_account_secret(&account.email).unwrap().exists,
            "failed removal must not drop credentials"
        );
    }

    #[test]
    fn remove_account_last_account_returns_none() {
        let store = test_store();
        let account = store.get_account().unwrap();
        store.store_account_secret(&account.email, "gone").unwrap();

        assert!(store.remove_account(account.id, true).unwrap().is_none());
        assert!(store.list_accounts().unwrap().is_empty());
        assert!(store.get_account_by_id_optional(None).unwrap().is_none());
        assert!(!store.check_account_secret(&account.email).unwrap().exists);
    }

    #[test]
    fn reopening_after_removing_all_accounts_does_not_seed_demo_again() {
        let unique = TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let data_dir = std::env::temp_dir().join(format!(
            "better-email-reopen-empty-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&data_dir).expect("test data dir created");
        let path = data_dir.join(DATABASE_FILENAME);

        {
            let store = MailStore::open_at_with_seed(path.clone(), true).expect("test store opens");
            let account = store.get_account().expect("seed account exists");
            assert!(store.delete_account(account.id).unwrap().is_none());
            assert!(store.list_accounts().unwrap().is_empty());
        }

        let reopened = MailStore::open_at(path).expect("empty account store reopens");
        assert!(reopened.list_accounts().unwrap().is_empty());
        assert!(reopened.get_account_by_id_optional(None).unwrap().is_none());
        drop(reopened);
        fs::remove_dir_all(data_dir).expect("test data dir removed");
    }

    #[test]
    fn header_sync_account_selection_prioritizes_unsynced_accounts() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        let second_account = store
            .create_account(AccountCreateInput {
                email: "sync-second@better-email.local".to_string(),
                display_name: "Sync Second".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.second.test:993".to_string(),
                smtp_host: "smtp.second.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();

        store
            .save_imap_mailboxes_for_account(
                Some(first_account.id),
                &[ImapFolderProbe {
                    name: "INBOX".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Inbox".to_string()],
                }],
            )
            .unwrap();

        let selected_before_second_mapping = store.accounts_for_header_sync(None).unwrap();
        assert_eq!(selected_before_second_mapping[0].id, second_account.id);

        let second_mailboxes = store
            .save_imap_mailboxes_for_account(
                Some(second_account.id),
                &[ImapFolderProbe {
                    name: "INBOX".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Inbox".to_string()],
                }],
            )
            .unwrap();
        assert!(second_mailboxes
            .iter()
            .all(|mailbox| mailbox.account_id == second_account.id));

        let scoped_mailboxes = store
            .list_imap_mailboxes_for_account(Some(second_account.id))
            .unwrap();
        assert!(!scoped_mailboxes.is_empty());
        assert!(scoped_mailboxes
            .iter()
            .all(|mailbox| mailbox.account_id == second_account.id));
        assert!(scoped_mailboxes
            .iter()
            .all(|mailbox| mailbox.account_email == second_account.email));
    }

    #[test]
    fn header_sync_schedule_plan_batches_unified_accounts() {
        let store = test_store();
        let first_account = store.get_account().unwrap();
        store
            .save_imap_mailboxes_for_account(
                Some(first_account.id),
                &[ImapFolderProbe {
                    name: "INBOX".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Inbox".to_string()],
                }],
            )
            .unwrap();

        let second_account = store
            .create_account(AccountCreateInput {
                email: "schedule-second@better-email.local".to_string(),
                display_name: "Schedule Second".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.second.test:993".to_string(),
                smtp_host: "smtp.second.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        let third_account = store
            .create_account(AccountCreateInput {
                email: "schedule-third@better-email.local".to_string(),
                display_name: "Schedule Third".to_string(),
                provider: "Custom".to_string(),
                imap_host: "imap.third.test:993".to_string(),
                smtp_host: "smtp.third.test:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();

        let priority = store.accounts_for_header_sync(None).unwrap();
        let plan = store.header_sync_schedule_plan(None, 2).unwrap();
        assert_eq!(plan.max_accounts_per_batch, 2);
        assert_eq!(plan.total_accounts, 3);
        assert_eq!(plan.batch_accounts.len(), 2);
        assert_eq!(plan.delayed_accounts.len(), 1);
        assert_eq!(plan.batch_accounts[0].id, priority[0].id);
        assert_eq!(plan.batch_accounts[1].id, priority[1].id);
        assert_eq!(plan.delayed_accounts[0].id, priority[2].id);
        assert!(plan
            .batch_accounts
            .iter()
            .any(|account| account.id == second_account.id || account.id == third_account.id));
    }

    #[test]
    fn oauth_sessions_are_persisted_for_callback_recovery() {
        let store = test_store();
        let report = store
            .save_oauth_session(
                OAuthStartReport {
                    session_id: 0,
                    provider: "gmail".to_string(),
                    authorization_url:
                        "https://accounts.google.com/o/oauth2/v2/auth?client_id=test".to_string(),
                    redirect_uri: "http://127.0.0.1:17645/oauth/callback".to_string(),
                    state: "state-123".to_string(),
                    code_challenge: "challenge-123".to_string(),
                    code_verifier_hint: "verifier generated".to_string(),
                    scopes: vec!["openid".to_string(), "https://mail.google.com/".to_string()],
                    message: "OAuth session started".to_string(),
                },
                "verifier-123",
            )
            .unwrap();
        assert!(report.session_id > 0);

        let sessions = store.list_oauth_sessions().unwrap();
        let session = sessions
            .iter()
            .find(|session| session.id == report.session_id)
            .expect("saved OAuth session is listed");
        assert_eq!(session.provider, "gmail");
        assert_eq!(session.status, "pending");
        assert_eq!(session.state, "state-123");
        assert!(session
            .scopes
            .contains(&"https://mail.google.com/".to_string()));

        let callback = store
            .complete_oauth_callback("state-123", "auth-code-123")
            .unwrap();
        assert_eq!(callback.session_id, report.session_id);
        assert_eq!(callback.status, "code_received");
        let updated = store
            .list_oauth_sessions()
            .unwrap()
            .into_iter()
            .find(|session| session.id == report.session_id)
            .unwrap();
        assert_eq!(updated.status, "code_received");
        assert!(!updated.completed_at.is_empty());
        assert!(store
            .complete_oauth_callback("state-123", "auth-code-456")
            .unwrap_err()
            .to_string()
            .contains("不能重复处理"));
    }

    #[test]
    fn sync_dry_run_is_recorded() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let run = store.run_sync_dry_run(Some(account.id)).unwrap();
        assert_eq!(run.status, "dry_run");
        assert!(run.scanned_folders >= 6);
        assert!(run.message.contains(&account.email));
        let runs = store.list_sync_runs().unwrap();
        assert!(runs.iter().any(|item| item.id == run.id));
    }

    #[test]
    fn imap_mailboxes_are_mapped_and_listed() {
        let store = test_store();
        let saved = store
            .save_imap_mailboxes(&[
                ImapFolderProbe {
                    name: "INBOX".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Inbox".to_string()],
                },
                ImapFolderProbe {
                    name: "[Gmail]/Sent Mail".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Sent".to_string()],
                },
            ])
            .unwrap();
        assert!(saved.iter().any(|mailbox| mailbox.local_role == "inbox"));
        assert!(saved.iter().any(|mailbox| mailbox.local_role == "sent"));
        assert!(store.list_imap_mailboxes().unwrap().len() >= 2);
    }

    #[test]
    fn imap_headers_are_imported_and_deduplicated() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "42".to_string(),
            highest_uid: 7,
            lowest_uid: 7,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 7,
                message_id: "<m1@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Remote hello".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header only".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: true,
            }],
        };
        let first = store.import_imap_headers(mailbox.id, &batch).unwrap();
        let second = store.import_imap_headers(mailbox.id, &batch).unwrap();
        assert_eq!(first.imported_messages, 1);
        assert_eq!(second.imported_messages, 0);
        let imported_starred: i64 = store
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT is_starred FROM messages WHERE remote_mailbox = 'INBOX' AND remote_uid = 7",
                    [],
                    |row| row.get(0),
                )
                .map_err(MailError::from)
            })
            .unwrap();
        assert_eq!(imported_starred, 1);
        assert_eq!(
            store
                .list_imap_mailboxes()
                .unwrap()
                .into_iter()
                .find(|item| item.remote_name == "INBOX")
                .unwrap()
                .highest_uid,
            7
        );
    }

    #[test]
    fn new_messages_exclude_history_backfill() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let header = |remote_uid: i64, message_id: &str| crate::models::RemoteMessageHeader {
            remote_uid,
            message_id: message_id.to_string(),
            in_reply_to: String::new(),
            references: String::new(),
            subject: format!("Subject {remote_uid}"),
            sender_name: "Remote".to_string(),
            sender_email: "remote@example.com".to_string(),
            recipients: "demo@better-email.local".to_string(),
            snippet: "header only".to_string(),
            received_at: Utc::now().to_rfc3339(),
            is_read: false,
            is_starred: false,
        };
        // 首次同步（游标为空）：整批按历史填充，不产生「新邮件」。
        let first = store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "42".to_string(),
                    highest_uid: 10,
                    lowest_uid: 10,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![header(10, "<m10@example.com>")],
                },
            )
            .unwrap();
        assert_eq!(first, (1, 0, vec![]));

        // 增量同步：UID 高于游标的才算新邮件，历史补同步不计入。
        let second = store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "42".to_string(),
                    highest_uid: 12,
                    lowest_uid: 5,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![
                        header(12, "<m12@example.com>"),
                        header(5, "<m5@example.com>"),
                    ],
                },
            )
            .unwrap();
        assert_eq!(second.0, 2);
        assert_eq!(second.1, 1);
        assert_eq!(second.2.len(), 1, "新增邮件应记录其 message id");
    }

    #[test]
    fn imap_replies_with_different_subjects_share_reference_thread() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let root_message_id = "<reference-root@example.com>";
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "thread-reference-1".to_string(),
            highest_uid: 12,
            lowest_uid: 11,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![
                crate::models::RemoteMessageHeader {
                    remote_uid: 11,
                    message_id: root_message_id.to_string(),
                    in_reply_to: String::new(),
                    references: String::new(),
                    subject: "Quarterly planning".to_string(),
                    sender_name: "Alice".to_string(),
                    sender_email: "alice@example.com".to_string(),
                    recipients: "demo@better-email.local".to_string(),
                    snippet: "Root message".to_string(),
                    received_at: "2026-07-10T08:00:00Z".to_string(),
                    is_read: true,
                    is_starred: false,
                },
                crate::models::RemoteMessageHeader {
                    remote_uid: 12,
                    message_id: "<reference-reply@example.com>".to_string(),
                    in_reply_to: root_message_id.to_string(),
                    references: root_message_id.to_string(),
                    subject: "Completely renamed discussion".to_string(),
                    sender_name: "Bob".to_string(),
                    sender_email: "bob@example.com".to_string(),
                    recipients: "demo@better-email.local".to_string(),
                    snippet: "Reply with a different subject".to_string(),
                    received_at: "2026-07-10T08:05:00Z".to_string(),
                    is_read: false,
                    is_starred: false,
                },
            ],
        };

        assert_eq!(
            store
                .import_imap_headers_batch(mailbox.id, &batch)
                .unwrap()
                .0,
            2
        );

        let thread_key = format!("msgid:{}", root_message_id.to_ascii_lowercase());
        let thread = store
            .list_threads_for_scope(None, None, None, None, 50)
            .unwrap()
            .into_iter()
            .find(|thread| thread.thread_key == thread_key)
            .expect("reference thread exists");
        assert_eq!(thread.message_count, 2);
        assert_eq!(thread.unread_count, 1);
        assert_eq!(thread.subject, "Completely renamed discussion");

        let messages = store
            .list_thread_messages(None, thread.thread_key, 10)
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert_ne!(messages[0].subject, messages[1].subject);
    }

    #[test]
    fn imap_flag_snapshot_updates_flags_and_removes_missing_messages() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let header = |remote_uid: i64| crate::models::RemoteMessageHeader {
            remote_uid,
            message_id: format!("<snapshot-{remote_uid}@example.com>"),
            in_reply_to: String::new(),
            references: String::new(),
            subject: format!("Snapshot {remote_uid}"),
            sender_name: "Remote".to_string(),
            sender_email: "remote@example.com".to_string(),
            recipients: "demo@better-email.local".to_string(),
            snippet: "snapshot header".to_string(),
            received_at: Utc::now().to_rfc3339(),
            is_read: false,
            is_starred: false,
        };
        store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "snapshot-1".to_string(),
                    highest_uid: 11,
                    lowest_uid: 10,
                    history_complete: true,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![header(10), header(11)],
                },
            )
            .unwrap();

        let reconciled = store
            .reconcile_imap_flag_snapshot(
                mailbox.id,
                &ImapFlagSnapshot {
                    floor_uid: 11,
                    complete: true,
                    states: vec![crate::models::ImapFlagState {
                        remote_uid: 11,
                        is_read: true,
                        is_starred: true,
                    }],
                },
            )
            .unwrap();
        assert_eq!(reconciled.updated_messages, 1);
        assert_eq!(reconciled.removed_messages, 1);

        let rows = store
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    "
                    SELECT remote_uid, is_read, is_starred
                    FROM messages
                    WHERE remote_mailbox = 'INBOX'
                      AND remote_uid IN (10, 11)
                    ORDER BY remote_uid
                    ",
                )?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((
                            row.get::<_, i64>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, i64>(2)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap();
        assert_eq!(rows, vec![(11, 1, 1)]);
    }

    #[test]
    fn imap_history_cursor_moves_backward_until_complete() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let header = |remote_uid: i64, message_id: &str| crate::models::RemoteMessageHeader {
            remote_uid,
            message_id: message_id.to_string(),
            in_reply_to: String::new(),
            references: String::new(),
            subject: format!("History {remote_uid}"),
            sender_name: "Remote".to_string(),
            sender_email: "remote@example.com".to_string(),
            recipients: "demo@better-email.local".to_string(),
            snippet: "history header".to_string(),
            received_at: Utc::now().to_rfc3339(),
            is_read: false,
            is_starred: false,
        };

        store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "history-1".to_string(),
                    highest_uid: 100,
                    lowest_uid: 76,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![header(100, "<history-100@example.com>")],
                },
            )
            .unwrap();
        store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "history-1".to_string(),
                    highest_uid: 100,
                    lowest_uid: 51,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![header(51, "<history-51@example.com>")],
                },
            )
            .unwrap();
        store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "history-1".to_string(),
                    highest_uid: 100,
                    lowest_uid: 1,
                    history_complete: true,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![header(1, "<history-1@example.com>")],
                },
            )
            .unwrap();

        let state = store
            .list_imap_mailboxes()
            .unwrap()
            .into_iter()
            .find(|item| item.id == mailbox.id)
            .unwrap();
        assert_eq!(state.highest_uid, 100);
        assert_eq!(state.lowest_uid, 1);
        assert!(state.history_complete);
        assert!(!state.history_last_sync_at.is_empty());
    }

    #[test]
    fn imap_uidvalidity_reset_replaces_stale_remote_uid_rows() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = |uid_validity: &str, message_id: &str, subject: &str, cursor_reset: bool| {
            ImapHeaderBatch {
                remote_name: "INBOX".to_string(),
                uid_validity: uid_validity.to_string(),
                highest_uid: 7,
                lowest_uid: 7,
                history_complete: false,
                history_scanned: true,
                cursor_reset,
                headers: vec![crate::models::RemoteMessageHeader {
                    remote_uid: 7,
                    message_id: message_id.to_string(),
                    in_reply_to: String::new(),
                    references: String::new(),
                    subject: subject.to_string(),
                    sender_name: "Remote".to_string(),
                    sender_email: "remote@example.com".to_string(),
                    recipients: "demo@better-email.local".to_string(),
                    snippet: "uid validity".to_string(),
                    received_at: Utc::now().to_rfc3339(),
                    is_read: false,
                    is_starred: false,
                }],
            }
        };

        store
            .import_imap_headers_batch(
                mailbox.id,
                &batch("uidvalidity-old", "<old@example.com>", "Old UID row", false),
            )
            .unwrap();
        store
            .import_imap_headers_batch(
                mailbox.id,
                &batch("uidvalidity-new", "<new@example.com>", "New UID row", true),
            )
            .unwrap();

        let (old_count, new_count): (i64, i64) = store
            .with_conn(|conn| {
                Ok((
                    conn.query_row(
                        "SELECT COUNT(*) FROM messages WHERE subject = 'Old UID row'",
                        [],
                        |row| row.get(0),
                    )?,
                    conn.query_row(
                        "SELECT COUNT(*) FROM messages WHERE subject = 'New UID row'",
                        [],
                        |row| row.get(0),
                    )?,
                ))
            })
            .unwrap();
        assert_eq!(old_count, 0);
        assert_eq!(new_count, 1);
    }

    #[test]
    fn imap_header_sync_rebinds_pending_moved_message_uid() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "Archive".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Archive".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "Archive".to_string(),
            uid_validity: "archive-1".to_string(),
            highest_uid: 77,
            lowest_uid: 77,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 77,
                message_id: "<moved-rebind@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Moved remote message".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "moved header".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        assert_eq!(
            store
                .import_imap_headers_batch(mailbox.id, &batch)
                .unwrap()
                .0,
            1
        );
        let archive = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "archive")
            .unwrap();
        let message = store
            .list_messages_for_scope(None, archive.id, None, None, 10)
            .unwrap()
            .into_iter()
            .find(|message| message.subject == "Moved remote message")
            .unwrap();
        store
            .set_message_remote_ref(message.id, "Archive", 0)
            .unwrap();

        let rebound_batch = ImapHeaderBatch {
            highest_uid: 91,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 91,
                ..batch.headers[0].clone()
            }],
            ..batch
        };
        assert_eq!(
            store
                .import_imap_headers_batch(mailbox.id, &rebound_batch)
                .unwrap()
                .0,
            0
        );
        let rebound = store.get_message(message.id).unwrap();
        assert_eq!(rebound.remote_mailbox, "Archive");
        assert_eq!(rebound.remote_uid, 91);
    }

    #[test]
    fn imap_header_batch_import_does_not_create_sync_runs() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .into_iter()
            .find(|item| item.remote_name == "INBOX")
            .unwrap();
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "batch-1".to_string(),
            highest_uid: 41,
            lowest_uid: 41,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 41,
                message_id: "<batch-no-log@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Batch import without sync log".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "batch header".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        let initial_sync_runs = store.list_sync_runs().unwrap().len();

        assert_eq!(
            store
                .import_imap_headers_batch(mailbox.id, &batch)
                .unwrap()
                .0,
            1
        );
        assert_eq!(store.list_sync_runs().unwrap().len(), initial_sync_runs);
    }

    #[test]
    fn custom_imap_mailbox_is_not_imported_into_inbox() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "Projects/Alpha".to_string(),
                delimiter: "/".to_string(),
                attributes: Vec::new(),
            }])
            .unwrap()
            .into_iter()
            .find(|item| item.remote_name == "Projects/Alpha")
            .unwrap();
        assert_eq!(mailbox.local_role, "custom");

        let error = store
            .import_imap_headers_batch(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: mailbox.remote_name.clone(),
                    uid_validity: "custom-1".to_string(),
                    highest_uid: 51,
                    lowest_uid: 51,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![crate::models::RemoteMessageHeader {
                        remote_uid: 51,
                        message_id: "<custom-folder@example.com>".to_string(),
                        in_reply_to: String::new(),
                        references: String::new(),
                        subject: "Must stay in custom folder".to_string(),
                        sender_name: "Remote".to_string(),
                        sender_email: "remote@example.com".to_string(),
                        recipients: "demo@better-email.local".to_string(),
                        snippet: "custom header".to_string(),
                        received_at: Utc::now().to_rfc3339(),
                        is_read: false,
                        is_starred: false,
                    }],
                },
            )
            .expect_err("custom mailbox import should be rejected");
        assert!(error.to_string().contains("尚未建立本地映射"));

        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        assert!(store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("Must stay in custom folder".to_string()),
                None,
                10,
            )
            .unwrap()
            .is_empty());
    }

    #[test]
    fn mapped_custom_imap_mailbox_imports_into_selected_folder() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let local_folder = store
            .create_custom_folder(Some(account.id), "项目 Alpha".to_string())
            .unwrap();
        let mailboxes = store
            .save_imap_mailboxes(&[
                ImapFolderProbe {
                    name: "Projects/Alpha".to_string(),
                    delimiter: "/".to_string(),
                    attributes: Vec::new(),
                },
                ImapFolderProbe {
                    name: "INBOX".to_string(),
                    delimiter: "/".to_string(),
                    attributes: vec!["Inbox".to_string()],
                },
            ])
            .unwrap();
        let remote_custom = mailboxes
            .iter()
            .find(|item| item.remote_name == "Projects/Alpha")
            .unwrap();
        let remote_inbox = mailboxes
            .iter()
            .find(|item| item.remote_name == "INBOX")
            .unwrap();

        let mapped = store
            .map_imap_mailbox(remote_custom.id, Some(local_folder.id))
            .unwrap();
        assert_eq!(mapped.local_folder_id, Some(local_folder.id));
        assert_eq!(mapped.local_folder_name, local_folder.name);
        assert!(store
            .map_imap_mailbox(remote_inbox.id, Some(local_folder.id))
            .unwrap_err()
            .to_string()
            .contains("自动映射"));

        let batch = ImapHeaderBatch {
            remote_name: "Projects/Alpha".to_string(),
            uid_validity: "custom-map-1".to_string(),
            highest_uid: 71,
            lowest_uid: 71,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 71,
                message_id: "<custom-mapped@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Mapped custom folder message".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: account.email.clone(),
                snippet: "mapped custom header".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        assert_eq!(
            store
                .import_imap_headers_batch(remote_custom.id, &batch)
                .unwrap()
                .0,
            1
        );
        let imported = store
            .list_messages_for_scope(
                Some(account.id),
                local_folder.id,
                Some("Mapped custom folder message".to_string()),
                None,
                10,
            )
            .unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].folder_id, local_folder.id);

        let unmapped = store.map_imap_mailbox(remote_custom.id, None).unwrap();
        assert_eq!(unmapped.local_folder_id, None);
        assert!(store
            .import_imap_headers_batch(
                remote_custom.id,
                &ImapHeaderBatch {
                    highest_uid: 72,
                    headers: vec![crate::models::RemoteMessageHeader {
                        remote_uid: 72,
                        message_id: "<custom-unmapped@example.com>".to_string(),
                        subject: "Should not import after unmapping".to_string(),
                        ..batch.headers[0].clone()
                    }],
                    ..batch
                },
            )
            .unwrap_err()
            .to_string()
            .contains("尚未建立本地映射"));
    }

    #[test]
    fn enabled_rules_are_applied_to_imported_imap_headers() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "rules-1".to_string(),
            highest_uid: 21,
            lowest_uid: 21,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 21,
                message_id: "<customer@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Customer contract".to_string(),
                sender_name: "Customer Team".to_string(),
                sender_email: "customer@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "Please review".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store.import_imap_headers(mailbox.id, &batch).unwrap();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let imported = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("Customer contract".to_string()),
                None,
                10,
            )
            .unwrap()
            .remove(0);
        assert!(imported.labels.iter().any(|label| label == "重要客户"));
    }

    #[test]
    fn remote_message_body_updates_existing_message() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "42".to_string(),
            highest_uid: 8,
            lowest_uid: 8,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 8,
                message_id: "<m2@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Needs body".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header only".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store.import_imap_headers(mailbox.id, &batch).unwrap();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message = store
            .list_messages_for_scope(None, inbox.id, Some("Needs body".to_string()), None, 10)
            .unwrap()
            .remove(0);
        let updated = store
            .update_message_body(
                message.id,
                &RemoteMessageBody {
                    body: "Full remote body".to_string(),
                    sanitized_html: "<p>Full remote body</p>".to_string(),
                    security_warnings: vec![
                        "HTML 正文包含外部链接，请核对域名后再访问。".to_string()
                    ],
                    snippet: "Full remote body".to_string(),
                    has_attachments: false,
                    attachments: Vec::new(),
                },
            )
            .unwrap();
        assert_eq!(updated.body, "Full remote body");
        assert_eq!(updated.sanitized_html, "<p>Full remote body</p>");
        assert_eq!(updated.security_warnings.len(), 1);
        assert_eq!(updated.remote_uid, 8);
    }

    #[test]
    fn messages_missing_body_are_listed_until_body_is_persisted() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "42".to_string(),
            highest_uid: 5,
            lowest_uid: 5,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 5,
                message_id: "<missing-body@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Missing body".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header only".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store.import_imap_headers(mailbox.id, &batch).unwrap();
        let pending = store
            .list_messages_missing_body(account_id, "INBOX", 50)
            .unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].1, 5);
        let uids = store
            .list_remote_uids_for_mailbox(account_id, "INBOX")
            .unwrap();
        assert!(uids.contains(&5));

        store
            .update_message_body(
                pending[0].0,
                &RemoteMessageBody {
                    body: "Now fetched".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "Now fetched".to_string(),
                    has_attachments: false,
                    attachments: Vec::new(),
                },
            )
            .unwrap();
        let pending = store
            .list_messages_missing_body(account_id, "INBOX", 50)
            .unwrap();
        assert!(pending.is_empty());
    }

    #[test]
    fn remote_message_body_refreshes_attachment_metadata() {
        let store = test_store();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "1".to_string(),
            highest_uid: 9,
            lowest_uid: 9,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 9,
                message_id: "<attachment@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Remote attachment".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header only".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store.import_imap_headers(mailbox.id, &batch).unwrap();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("Remote attachment".to_string()),
                None,
                10,
            )
            .unwrap()
            .remove(0);
        let updated = store
            .update_message_body(
                message.id,
                &RemoteMessageBody {
                    body: "Body with attachment".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "Body with attachment".to_string(),
                    has_attachments: true,
                    attachments: vec![crate::models::RemoteAttachmentMetadata {
                        filename: "remote.png".to_string(),
                        mime_type: "image/png".to_string(),
                        size_bytes: 42,
                        content_id: "remote-image@example.com".to_string(),
                        is_inline: true,
                    }],
                },
            )
            .unwrap();
        let attachments = store.list_attachments(message.id).unwrap();
        assert!(updated.has_attachments);
        assert_eq!(updated.attachment_count, 1);
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "remote.png");
        assert_eq!(attachments[0].mime_type, "image/png");
        assert_eq!(attachments[0].size_bytes, 42);
        assert!(!attachments[0].is_downloaded);
        assert!(attachments[0].local_path.is_empty());
        assert_eq!(attachments[0].content_id, "remote-image@example.com");
        assert!(attachments[0].is_inline);

        let downloaded = store
            .mark_attachment_downloaded(attachments[0].id, "/tmp/better-email/remote.png", 84)
            .unwrap();
        assert!(downloaded.is_downloaded);
        assert_eq!(downloaded.local_path, "/tmp/better-email/remote.png");
        assert_eq!(downloaded.size_bytes, 84);
        assert_eq!(downloaded.content_id, "remote-image@example.com");
        assert!(downloaded.is_inline);
    }

    fn seed_remote_message(store: &MailStore, subject: &str, uid: i64) -> i64 {
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "1".to_string(),
            highest_uid: uid,
            lowest_uid: uid,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: uid,
                message_id: format!("<{subject}@example.com>"),
                in_reply_to: String::new(),
                references: String::new(),
                subject: subject.to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header only".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store.import_imap_headers(mailbox.id, &batch).unwrap();
        let inbox = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        store
            .list_messages_for_scope(None, inbox.id, Some(subject.to_string()), None, 10)
            .unwrap()
            .remove(0)
            .id
    }

    fn remote_attachment(
        filename: &str,
        mime_type: &str,
        size_bytes: i64,
        content_id: &str,
        is_inline: bool,
    ) -> crate::models::RemoteAttachmentMetadata {
        crate::models::RemoteAttachmentMetadata {
            filename: filename.to_string(),
            mime_type: mime_type.to_string(),
            size_bytes,
            content_id: content_id.to_string(),
            is_inline,
        }
    }

    #[test]
    fn update_message_body_preserves_downloaded_attachment_state() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Preserve download", 21);
        let first = store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first body".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first body".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "report.pdf",
                        "application/pdf",
                        100,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        assert_eq!(first.attachment_count, 1);
        let attachment = store.list_attachments(message_id).unwrap().remove(0);

        // 真实写盘并标记下载，模拟用户已下载附件。
        let dir = store.attachment_dir(message_id);
        fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join(format!("{}-report.pdf", attachment.id));
        fs::write(&file_path, b"verified attachment bytes").unwrap();
        store
            .mark_attachment_downloaded(attachment.id, &file_path.to_string_lossy(), 8)
            .unwrap();

        // 正文重拉（附件不变）：已下载状态、local_path 与磁盘实际大小必须保留。
        let updated = store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second body".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second body".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "report.pdf",
                        "application/pdf",
                        100,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap().remove(0);
        assert_eq!(updated.attachment_count, 1);
        assert!(refreshed.is_downloaded, "附件不变时应保留已下载状态");
        assert_eq!(refreshed.local_path, file_path.to_string_lossy());
        assert_eq!(
            refreshed.size_bytes,
            fs::metadata(&file_path).unwrap().len().min(i64::MAX as u64) as i64,
            "size_bytes 应更新为磁盘实际大小"
        );
        assert_eq!(refreshed.filename, "report.pdf");
    }

    #[test]
    fn update_message_body_clears_download_state_when_file_missing() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Missing file", 22);
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "gone.pdf",
                        "application/pdf",
                        10,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        let attachment = store.list_attachments(message_id).unwrap().remove(0);
        // 标记下载但文件并不存在（如外部盘未挂载）。
        store
            .mark_attachment_downloaded(attachment.id, "/tmp/nonexistent-gone.pdf", 10)
            .unwrap();

        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "gone.pdf",
                        "application/pdf",
                        10,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap().remove(0);
        assert!(!refreshed.is_downloaded, "文件缺失时不应保留伪下载状态");
        assert!(refreshed.local_path.is_empty());
    }

    #[test]
    fn update_message_body_removed_attachment_is_cleared_from_database() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Removed attachment", 23);
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("keep.pdf", "application/pdf", 10, "", false),
                        remote_attachment("drop.txt", "text/plain", 5, "", false),
                    ],
                },
            )
            .unwrap();
        let attachments = store.list_attachments(message_id).unwrap();
        assert_eq!(attachments.len(), 2);
        let keep = attachments
            .iter()
            .find(|a| a.filename == "keep.pdf")
            .unwrap();
        let dir = store.attachment_dir(message_id);
        fs::create_dir_all(&dir).unwrap();
        let keep_path = dir.join(format!("{}-keep.pdf", keep.id));
        fs::write(&keep_path, b"keep bytes").unwrap();
        store
            .mark_attachment_downloaded(keep.id, &keep_path.to_string_lossy(), 10)
            .unwrap();

        // 远端已删除 drop.txt：数据库附件状态应清理，保留 keep.pdf 的下载状态。
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "keep.pdf",
                        "application/pdf",
                        10,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap();
        assert_eq!(refreshed.len(), 1, "已删除远端附件应从数据库清理");
        assert_eq!(refreshed[0].filename, "keep.pdf");
        assert!(refreshed[0].is_downloaded);
        assert_eq!(refreshed[0].local_path, keep_path.to_string_lossy());
    }

    #[test]
    fn update_message_body_matches_same_name_attachments_in_order() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Same name attachments", 24);
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("photo.jpg", "image/jpeg", 100, "", false),
                        remote_attachment("photo.jpg", "image/jpeg", 200, "", false),
                    ],
                },
            )
            .unwrap();
        let dir = store.attachment_dir(message_id);
        fs::create_dir_all(&dir).unwrap();
        let attachments = store.list_attachments(message_id).unwrap();
        assert_eq!(attachments.len(), 2);
        let first_path = dir.join(format!("{}-photo.jpg", attachments[0].id));
        let second_path = dir.join(format!("{}-photo.jpg", attachments[1].id));
        fs::write(&first_path, b"first photo bytes").unwrap();
        fs::write(&second_path, b"second photo bytes").unwrap();
        store
            .mark_attachment_downloaded(attachments[0].id, &first_path.to_string_lossy(), 20)
            .unwrap();
        store
            .mark_attachment_downloaded(attachments[1].id, &second_path.to_string_lossy(), 22)
            .unwrap();

        // 同名附件重拉后仍应按顺序配对，两个都已下载状态都被保留。
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("photo.jpg", "image/jpeg", 100, "", false),
                        remote_attachment("photo.jpg", "image/jpeg", 200, "", false),
                    ],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap();
        assert_eq!(refreshed.len(), 2);
        let mut downloaded_paths = refreshed
            .iter()
            .filter(|a| a.is_downloaded)
            .map(|a| a.local_path.clone())
            .collect::<Vec<_>>();
        downloaded_paths.sort();
        let mut expected = vec![
            first_path.to_string_lossy().into_owned(),
            second_path.to_string_lossy().into_owned(),
        ];
        expected.sort();
        assert_eq!(downloaded_paths, expected, "两个同名附件的下载状态都应保留");
    }

    #[test]
    fn update_message_body_matches_inline_by_content_id_across_reorder() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Inline reorder", 25);
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("a.png", "image/png", 10, "cid:a@example.com", true),
                        remote_attachment("b.png", "image/png", 20, "cid:b@example.com", true),
                    ],
                },
            )
            .unwrap();
        let dir = store.attachment_dir(message_id);
        fs::create_dir_all(&dir).unwrap();
        let attachments = store.list_attachments(message_id).unwrap();
        let a = attachments
            .iter()
            .find(|a| a.content_id == "cid:a@example.com")
            .unwrap();
        let b = attachments
            .iter()
            .find(|a| a.content_id == "cid:b@example.com")
            .unwrap();
        let a_path = dir.join(format!("{}-a.png", a.id));
        let b_path = dir.join(format!("{}-b.png", b.id));
        fs::write(&a_path, b"aaa").unwrap();
        fs::write(&b_path, b"bbbb").unwrap();
        store
            .mark_attachment_downloaded(a.id, &a_path.to_string_lossy(), 3)
            .unwrap();
        store
            .mark_attachment_downloaded(b.id, &b_path.to_string_lossy(), 4)
            .unwrap();

        // 重排 + 其中一个同名：content_id 是稳定身份，状态必须跟随内容而非顺序。
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("b.png", "image/png", 20, "cid:b@example.com", true),
                        remote_attachment("a.png", "image/png", 10, "cid:a@example.com", true),
                    ],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap();
        let a = refreshed
            .iter()
            .find(|a| a.content_id == "cid:a@example.com")
            .unwrap();
        let b = refreshed
            .iter()
            .find(|a| a.content_id == "cid:b@example.com")
            .unwrap();
        assert!(a.is_downloaded);
        assert_eq!(a.local_path, a_path.to_string_lossy());
        assert_eq!(a.size_bytes, 3);
        assert!(b.is_downloaded);
        assert_eq!(b.local_path, b_path.to_string_lossy());
        assert_eq!(b.size_bytes, 4);
    }

    #[test]
    fn update_message_body_new_attachment_starts_undownloaded() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "New attachment", 26);
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "first".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "first".to_string(),
                    has_attachments: true,
                    attachments: vec![remote_attachment(
                        "old.pdf",
                        "application/pdf",
                        10,
                        "",
                        false,
                    )],
                },
            )
            .unwrap();
        let old = store.list_attachments(message_id).unwrap().remove(0);
        let dir = store.attachment_dir(message_id);
        fs::create_dir_all(&dir).unwrap();
        let old_path = dir.join(format!("{}-old.pdf", old.id));
        fs::write(&old_path, b"old bytes").unwrap();
        store
            .mark_attachment_downloaded(old.id, &old_path.to_string_lossy(), 9)
            .unwrap();

        // 新增附件：旧附件保留下载状态，新附件从未下载开始。
        store
            .update_message_body(
                message_id,
                &RemoteMessageBody {
                    body: "second".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "second".to_string(),
                    has_attachments: true,
                    attachments: vec![
                        remote_attachment("old.pdf", "application/pdf", 10, "", false),
                        remote_attachment("new.pdf", "application/pdf", 77, "", false),
                    ],
                },
            )
            .unwrap();
        let refreshed = store.list_attachments(message_id).unwrap();
        let old = refreshed.iter().find(|a| a.filename == "old.pdf").unwrap();
        let new = refreshed.iter().find(|a| a.filename == "new.pdf").unwrap();
        assert!(old.is_downloaded);
        assert_eq!(old.local_path, old_path.to_string_lossy());
        assert!(!new.is_downloaded);
        assert!(new.local_path.is_empty());
        assert_eq!(new.size_bytes, 77);
    }

    fn pop3_eml(subject: &str, message_id: &str, body: &str) -> String {
        format!(
            "Subject: {subject}\r\n\
             From: \"Pop Sender\" <pop@example.com>\r\n\
             To: demo@better-email.local\r\n\
             Date: Thu, 09 Jul 2026 10:00:00 +0800\r\n\
             Message-ID: <{message_id}>\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             {body}"
        )
    }

    fn import_pop3(store: &MailStore, account_id: i64, uid: i64, eml: &str) -> i64 {
        store
            .import_pop3_messages(
                account_id,
                &[crate::pop3_probe::Pop3Message {
                    remote_uid: uid,
                    raw: eml.to_string(),
                }],
            )
            .unwrap()
    }

    fn pop3_message_id(store: &MailStore, account_id: i64, subject: &str) -> i64 {
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        store
            .list_messages_for_scope(
                Some(account_id),
                inbox.id,
                Some(subject.to_string()),
                None,
                10,
            )
            .unwrap()
            .remove(0)
            .id
    }

    #[test]
    fn pop3_resync_preserves_local_folder_organization() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;

        // 首次导入进入收件箱。
        assert_eq!(
            import_pop3(
                &store,
                account_id,
                101,
                &pop3_eml("Pop organize", "pop-organize@example.com", "v1 body"),
            ),
            1
        );
        let message_id = pop3_message_id(&store, account_id, "Pop organize");
        assert_eq!(store.get_message(message_id).unwrap().folder_role, "inbox");

        // 用户把邮件移到废纸篓并加星标。
        store.move_message_to_role(message_id, "trash").unwrap();
        store.set_message_starred(message_id, true).unwrap();

        // 再同步同一 UIDL：内容更新，但本地文件夹整理与星标必须保留。
        assert_eq!(
            import_pop3(
                &store,
                account_id,
                101,
                &pop3_eml("Pop organize", "pop-organize@example.com", "v2 body"),
            ),
            0,
            "同一 UIDL 再同步不应计入新增"
        );
        let after = store.get_message(message_id).unwrap();
        assert_eq!(after.folder_role, "trash", "归档/整理不应被拉回收件箱");
        assert!(after.is_starred, "本地星标不应被覆盖");
        assert!(
            after.body.contains("v2 body"),
            "远端内容应更新，实际正文：{}",
            after.body
        );
    }

    #[test]
    fn pop3_resync_preserves_custom_folder_and_snooze_state() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        import_pop3(
            &store,
            account_id,
            102,
            &pop3_eml("Pop custom", "pop-custom@example.com", "v1"),
        );
        let message_id = pop3_message_id(&store, account_id, "Pop custom");

        // 移到自定义文件夹 + 稍后处理。
        store
            .create_custom_folder(Some(account_id), "项目 Alpha".to_string())
            .unwrap();
        let custom = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role.starts_with("custom:") && folder.name == "项目 Alpha")
            .unwrap();
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET folder_id = ?1, snoozed_until = ?2 WHERE id = ?3",
                    params![custom.id, "2099-01-01T00:00:00Z", message_id],
                )?;
                Ok(())
            })
            .unwrap();

        import_pop3(
            &store,
            account_id,
            102,
            &pop3_eml("Pop custom", "pop-custom@example.com", "v2"),
        );
        let after = store.get_message(message_id).unwrap();
        assert_eq!(after.folder_id, custom.id, "自定义文件夹应保留");
        assert_eq!(
            after.snoozed_until, "2099-01-01T00:00:00Z",
            "稍后状态应保留"
        );
    }

    #[test]
    fn pop3_new_uidl_lands_in_inbox() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        import_pop3(
            &store,
            account_id,
            201,
            &pop3_eml("Pop new", "pop-new@example.com", "first"),
        );
        assert_eq!(
            import_pop3(
                &store,
                account_id,
                202,
                &pop3_eml("Pop new", "pop-new@example.com", "second"),
            ),
            1,
            "新 UIDL 应作为新邮件导入收件箱"
        );
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let messages = store
            .list_messages_for_scope(
                Some(account_id),
                inbox.id,
                Some("Pop new".to_string()),
                None,
                10,
            )
            .unwrap();
        assert_eq!(messages.len(), 2);
        assert!(messages
            .iter()
            .all(|message| message.folder_role == "inbox"));
    }

    fn seed_custom_mailbox_message(
        store: &MailStore,
        remote_name: &str,
        uid: i64,
        subject: &str,
    ) -> (i64, i64) {
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: remote_name.to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Custom".to_string()],
            }])
            .unwrap()
            .remove(0);
        let account_id = store.get_account().unwrap().id;
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let message_id = store
            .with_conn(|conn| {
                conn.execute(
                    "INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients, subject,
                        snippet, body, received_at, is_read, is_starred, has_attachments,
                        thread_key, remote_mailbox, remote_uid
                     ) VALUES (?1, ?2, 'x', 'x@example.com', 'me@example.com', ?3, '', '',
                               '2026-01-01T00:00:00Z', 0, 0, 0, '', ?4, ?5)",
                    params![account_id, inbox.id, subject, remote_name, uid],
                )?;
                Ok(conn.last_insert_rowid())
            })
            .unwrap();
        (mailbox.id, message_id)
    }

    #[test]
    fn sync_mailbox_import_failure_rolls_back_reconcile_flag_updates() {
        let store = test_store();
        let (mailbox_id, message_id) =
            seed_custom_mailbox_message(&store, "Projects/Alpha", 1, "Rollback flags");
        // 自定义目录未映射本地文件夹：reconcile 成功更新 flags 后 import 必然失败。
        let snapshot = ImapFlagSnapshot {
            floor_uid: 0,
            complete: false,
            states: vec![ImapFlagState {
                remote_uid: 1,
                is_read: true,
                is_starred: false,
            }],
        };
        let batch = ImapHeaderBatch {
            remote_name: "Projects/Alpha".to_string(),
            uid_validity: "1".to_string(),
            highest_uid: 1,
            lowest_uid: 1,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: Vec::new(),
        };
        let result = store.sync_imap_mailbox_into_db(mailbox_id, &snapshot, &batch);
        assert!(result.is_err(), "import 应失败并使整个事务回滚");

        let after = store.get_message(message_id).unwrap();
        assert!(
            !after.is_read,
            "reconcile 的 flags 更新不应在 import 失败后残留"
        );
    }

    #[test]
    fn sync_mailbox_import_failure_rolls_back_reconcile_deletes() {
        let store = test_store();
        let (mailbox_id, message_id) =
            seed_custom_mailbox_message(&store, "Projects/Beta", 1, "Rollback deletes");
        // complete=true、states 为空：reconcile 会把本地消息当作远端已删除而 DELETE。
        let snapshot = ImapFlagSnapshot {
            floor_uid: 0,
            complete: true,
            states: Vec::new(),
        };
        let batch = ImapHeaderBatch {
            remote_name: "Projects/Beta".to_string(),
            uid_validity: "1".to_string(),
            highest_uid: 1,
            lowest_uid: 1,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: Vec::new(),
        };
        let result = store.sync_imap_mailbox_into_db(mailbox_id, &snapshot, &batch);
        assert!(result.is_err(), "import 应失败并使整个事务回滚");

        let count: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT COUNT(*) FROM messages WHERE id = ?1",
                    params![message_id],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(count, 1, "reconcile 的删除不应在 import 失败后残留");
    }

    #[test]
    fn sync_mailbox_into_db_commits_flags_import_and_cursor_atomically() {
        let store = test_store();
        let (mailbox_id, message_id) =
            seed_custom_mailbox_message(&store, "Projects/Gamma", 7, "Atomic commit");
        // 先建立自定义文件夹并映射，让 import 走通。
        let custom_folder = store
            .create_custom_folder(
                Some(store.get_account().unwrap().id),
                "项目 Gamma".to_string(),
            )
            .unwrap();
        store
            .map_imap_mailbox(mailbox_id, Some(custom_folder.id))
            .unwrap();

        let snapshot = ImapFlagSnapshot {
            floor_uid: 0,
            complete: false,
            states: vec![ImapFlagState {
                remote_uid: 7,
                is_read: true,
                is_starred: false,
            }],
        };
        let batch = ImapHeaderBatch {
            remote_name: "Projects/Gamma".to_string(),
            uid_validity: "42".to_string(),
            highest_uid: 9,
            lowest_uid: 9,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 8,
                message_id: "<gamma-8@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "New gamma".to_string(),
                sender_name: "G".to_string(),
                sender_email: "g@example.com".to_string(),
                recipients: "me@example.com".to_string(),
                snippet: "gamma".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        let result = store
            .sync_imap_mailbox_into_db(mailbox_id, &snapshot, &batch)
            .unwrap();
        assert!(result.reconcile.updated_messages >= 1);
        assert_eq!(result.imported_messages, 1);
        assert!(store.get_message(message_id).unwrap().is_read);
        let mailbox = store
            .list_imap_mailboxes_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|mailbox| mailbox.id == mailbox_id)
            .unwrap();
        assert_eq!(mailbox.uid_validity, "42");
        assert_eq!(mailbox.highest_uid, 9);
    }

    fn inbox_mailbox_id(store: &MailStore) -> i64 {
        store
            .list_imap_mailboxes()
            .unwrap()
            .into_iter()
            .find(|mailbox| mailbox.remote_name == "INBOX")
            .map(|mailbox| mailbox.id)
            .unwrap()
    }

    fn flag_snapshot(states: Vec<(i64, bool, bool)>) -> ImapFlagSnapshot {
        ImapFlagSnapshot {
            floor_uid: 0,
            complete: false,
            states: states
                .into_iter()
                .map(|(remote_uid, is_read, is_starred)| ImapFlagState {
                    remote_uid,
                    is_read,
                    is_starred,
                })
                .collect(),
        }
    }

    #[test]
    fn pending_remote_write_blocks_flag_overwrite_until_successful_writeback() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Pending flags", 31);
        assert!(!store.get_message(message_id).unwrap().is_read);

        // 本地标记已读（is_read=1），远端写回失败：记录待处理意图。
        store.set_message_read(message_id, true).unwrap();
        store
            .record_pending_remote_write(message_id, "seen", "1")
            .unwrap();
        // 远端快照说未读：待处理意图存在，不应被覆盖。
        store
            .reconcile_imap_flag_snapshot(
                inbox_mailbox_id(&store),
                &flag_snapshot(vec![(31, false, false)]),
            )
            .unwrap();
        assert!(
            store.get_message(message_id).unwrap().is_read,
            "写回失败后本地已读状态不应被远端快照静默撤销"
        );

        // 写回成功：清除待处理意图，远端恢复权威。
        store
            .clear_pending_remote_write(message_id, "seen")
            .unwrap();
        store
            .reconcile_imap_flag_snapshot(
                inbox_mailbox_id(&store),
                &flag_snapshot(vec![(31, false, false)]),
            )
            .unwrap();
        assert!(
            !store.get_message(message_id).unwrap().is_read,
            "写回成功后应以远端状态为准"
        );
        assert!(store.list_pending_remote_writes().unwrap().is_empty());
    }

    #[test]
    fn pending_move_blocks_remote_folder_overwrite_until_writeback() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Pending move", 32);
        // 用户本地移到废纸篓，远端移动写回失败。
        store.move_message_to_role(message_id, "trash").unwrap();
        assert_eq!(store.get_message(message_id).unwrap().folder_role, "trash");
        store
            .record_pending_remote_write(message_id, "move", "trash")
            .unwrap();

        // 下一次头同步（INBOX 仍返回该 UID）：待处理移动意图阻止拉回收件箱。
        let batch = ImapHeaderBatch {
            remote_name: "INBOX".to_string(),
            uid_validity: "1".to_string(),
            highest_uid: 32,
            lowest_uid: 32,
            history_complete: false,
            history_scanned: true,
            cursor_reset: false,
            headers: vec![crate::models::RemoteMessageHeader {
                remote_uid: 32,
                message_id: "<Pending move@example.com>".to_string(),
                in_reply_to: String::new(),
                references: String::new(),
                subject: "Pending move".to_string(),
                sender_name: "Remote".to_string(),
                sender_email: "remote@example.com".to_string(),
                recipients: "demo@better-email.local".to_string(),
                snippet: "header".to_string(),
                received_at: Utc::now().to_rfc3339(),
                is_read: false,
                is_starred: false,
            }],
        };
        store
            .import_imap_headers_batch(inbox_mailbox_id(&store), &batch)
            .unwrap();
        assert_eq!(
            store.get_message(message_id).unwrap().folder_role,
            "trash",
            "写回失败后本地文件夹整理不应被下次同步拉回收件箱"
        );

        // 写回成功：清除待处理意图，远端成为权威（INBOX 不再包含该邮件时，
        // 下次 reconcile 才会删除；这里验证待处理清除即可）。
        store
            .clear_pending_remote_write(message_id, "move")
            .unwrap();
        assert!(store.list_pending_remote_writes().unwrap().is_empty());
    }

    #[test]
    fn remote_flag_changes_apply_when_no_pending_intent() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Remote changes", 33);
        assert!(!store.get_message(message_id).unwrap().is_read);
        assert!(!store.get_message(message_id).unwrap().is_starred);

        // 无本地待处理意图：其他客户端在服务器上的修改照常应用。
        store
            .reconcile_imap_flag_snapshot(
                inbox_mailbox_id(&store),
                &flag_snapshot(vec![(33, true, true)]),
            )
            .unwrap();
        let after = store.get_message(message_id).unwrap();
        assert!(after.is_read, "远端已读修改应被应用");
        assert!(after.is_starred, "远端星标修改应被应用");
        assert!(store.list_pending_remote_writes().unwrap().is_empty());
    }

    #[test]
    fn pending_remote_write_list_and_clear_round_trip() {
        let store = test_store();
        let message_id = seed_remote_message(&store, "Pending list", 34);
        store
            .record_pending_remote_write(message_id, "flagged", "1")
            .unwrap();
        store
            .record_pending_remote_write(message_id, "move", "trash")
            .unwrap();
        let writes = store.list_pending_remote_writes().unwrap();
        assert_eq!(writes.len(), 2);
        assert!(writes.iter().any(|w| w.kind == "flagged" && w.value == "1"));
        assert!(writes
            .iter()
            .any(|w| w.kind == "move" && w.value == "trash"));

        store
            .clear_pending_remote_write(message_id, "flagged")
            .unwrap();
        let writes = store.list_pending_remote_writes().unwrap();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].kind, "move");
    }

    #[test]
    fn missing_body_backfill_fairly_reaches_oldest_messages() {
        let store = test_store();
        let account_id = store.get_account().unwrap().id;
        let _mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        let inbox = store
            .list_folders_for_account(Some(account_id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();

        // 大量历史积压：uid 1..20 都缺正文。
        store
            .with_conn(|conn| {
                for uid in 1..=20_i64 {
                    conn.execute(
                        "INSERT INTO messages(
                            account_id, folder_id, sender_name, sender_email, recipients, subject,
                            snippet, body, received_at, is_read, is_starred, has_attachments,
                            thread_key, remote_mailbox, remote_uid
                         ) VALUES (?1, ?2, 'x', 'x@example.com', 'me@example.com', 'Subject ' || ?3,
                                   '', '', '2026-01-01T00:00:00Z', 0, 0, 0, '', 'INBOX', ?3)",
                        params![account_id, inbox.id, uid],
                    )?;
                }
                Ok(())
            })
            .unwrap();

        // 持续新增缺正文邮件，且每轮只回填 limit 条（模拟真实同步批次）。
        let mut fetched_oldest_uid_1 = false;
        let mut next_uid = 100_i64;
        for round in 0..6 {
            let pending = store
                .list_messages_missing_body(account_id, "INBOX", 4)
                .unwrap();
            assert!(!pending.is_empty(), "round {round} 不应为空");
            if pending.iter().any(|(_, uid)| *uid == 1) {
                fetched_oldest_uid_1 = true;
            }
            // 处理本批：补上正文，模拟同步把缺正文邮件标记为已处理。
            for (message_id, _) in &pending {
                store
                    .with_conn(|conn| {
                        conn.execute(
                            "UPDATE messages SET body = 'fetched' WHERE id = ?1",
                            params![message_id],
                        )?;
                        Ok(())
                    })
                    .unwrap();
            }
            // 每轮新增若干新缺正文邮件，模拟持续到达。
            store
                .with_conn(|conn| {
                    for _ in 0..3 {
                        conn.execute(
                            "INSERT INTO messages(
                                account_id, folder_id, sender_name, sender_email, recipients, subject,
                                snippet, body, received_at, is_read, is_starred, has_attachments,
                                thread_key, remote_mailbox, remote_uid
                             ) VALUES (?1, ?2, 'x', 'x@example.com', 'me@example.com', 'Fresh ' || ?3,
                                       '', '', '2026-01-01T00:00:00Z', 0, 0, 0, '', 'INBOX', ?3)",
                            params![account_id, inbox.id, next_uid],
                        )?;
                        next_uid += 1;
                    }
                    Ok(())
                })
                .unwrap();
        }
        assert!(
            fetched_oldest_uid_1,
            "持续新增时，最老积压邮件必须最终进入回填批次"
        );

        // 新邮件不应长期饥饿：最新缺正文邮件也应很快出现在批次中。
        let pending = store
            .list_messages_missing_body(account_id, "INBOX", 4)
            .unwrap();
        assert!(!pending.is_empty(), "仍有新增缺正文邮件时批次不应为空");
    }

    #[test]
    fn contacts_rules_threads_and_outbox_are_available() {
        let store = test_store();
        assert!(store.list_contacts().unwrap().len() >= 3);
        assert!(store.list_rules().unwrap().len() >= 3);
        assert!(
            store
                .list_threads_for_scope(None, None, None, None, 50)
                .unwrap()
                .len()
                >= 3
        );
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "queued@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Queued".to_string(),
                body: "Queued body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        assert_eq!(item.status, "queued");
        let flushed = store.flush_outbox_dry_run().unwrap();
        assert!(flushed.iter().any(|item| item.status == "sent_dry_run"));
    }

    #[test]
    fn contact_list_is_not_truncated_after_large_imports() {
        let store =
            MailStore::open_at_with_seed(test_database_path("better-email-contact-list"), false)
                .expect("empty contact store opens");
        for index in 0..125 {
            store
                .create_contact(ContactCreateInput {
                    name: format!("Contact {index}"),
                    email: format!("contact-{index}@example.com"),
                    aliases: Vec::new(),
                    vip: false,
                })
                .expect("contact creates");
        }

        assert_eq!(store.list_contacts().unwrap().len(), 125);
    }

    #[test]
    fn contact_list_orders_by_actual_last_seen_timestamp() {
        let store =
            MailStore::open_at_with_seed(test_database_path("better-email-contact-order"), false)
                .expect("empty contact store opens");
        let older = store
            .create_contact(ContactCreateInput {
                name: "Older Contact".to_string(),
                email: "older-contact@example.com".to_string(),
                aliases: Vec::new(),
                vip: false,
            })
            .expect("older contact creates");
        let newer = store
            .create_contact(ContactCreateInput {
                name: "Newer Contact".to_string(),
                email: "newer-contact@example.com".to_string(),
                aliases: Vec::new(),
                vip: false,
            })
            .expect("newer contact creates");
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE contacts SET last_seen_at = ?2 WHERE id = ?1",
                    params![older.id, "2026-08-25T00:00:00+08:00"],
                )?;
                // This instant is newer than the value above despite its
                // lexically smaller local date.
                conn.execute(
                    "UPDATE contacts SET last_seen_at = ?2 WHERE id = ?1",
                    params![newer.id, "2026-08-24T20:00:00Z"],
                )?;
                Ok(())
            })
            .expect("contact timestamps update");

        let contacts = store.list_contacts().expect("contacts list");
        let newer_position = contacts
            .iter()
            .position(|contact| contact.email == newer.email)
            .expect("newer contact listed");
        let older_position = contacts
            .iter()
            .position(|contact| contact.email == older.email)
            .expect("older contact listed");
        assert!(newer_position < older_position);
    }

    #[test]
    fn contact_edits_persist_aliases_and_vip_state() {
        let store = test_store();
        let contact = store
            .list_contacts()
            .unwrap()
            .into_iter()
            .find(|contact| contact.email == "ada@example.com")
            .unwrap();

        let updated = store
            .update_contact(
                contact.id,
                ContactInput {
                    name: "Ada Lovelace".to_string(),
                    aliases: vec![
                        "ada@example.com".to_string(),
                        " ADA@WORK.EXAMPLE.COM ".to_string(),
                        "ada@work.example.com".to_string(),
                        "ada+team@example.com".to_string(),
                        String::new(),
                    ],
                    vip: true,
                },
            )
            .unwrap();

        assert_eq!(updated.name, "Ada Lovelace");
        assert_eq!(
            updated.aliases,
            vec![
                "ada@work.example.com".to_string(),
                "ada+team@example.com".to_string()
            ]
        );
        assert!(updated.vip);

        let reloaded = store
            .list_contacts()
            .unwrap()
            .into_iter()
            .find(|contact| contact.id == updated.id)
            .unwrap();
        assert_eq!(reloaded.name, "Ada Lovelace");
        assert_eq!(reloaded.aliases, updated.aliases);
        assert!(reloaded.vip);

        let preserved_name = store
            .update_contact(
                contact.id,
                ContactInput {
                    name: "   ".to_string(),
                    aliases: vec!["ada@personal.example.com".to_string()],
                    vip: false,
                },
            )
            .unwrap();
        assert_eq!(preserved_name.name, "Ada Lovelace");
        assert_eq!(
            preserved_name.aliases,
            vec!["ada@personal.example.com".to_string()]
        );
        assert!(!preserved_name.vip);
    }

    #[test]
    fn contact_create_delete_and_merge_manage_address_book() {
        let store = test_store();
        let created = store
            .create_contact(ContactCreateInput {
                name: "Merge Source".to_string(),
                email: " MERGE-SOURCE@EXAMPLE.COM ".to_string(),
                aliases: vec![
                    "source.alias@example.com".to_string(),
                    "merge-source@example.com".to_string(),
                ],
                vip: true,
            })
            .unwrap();
        assert_eq!(created.email, "merge-source@example.com");
        assert_eq!(created.name, "Merge Source");
        assert_eq!(
            created.aliases,
            vec!["source.alias@example.com".to_string()]
        );
        assert!(created.vip);

        let target = store
            .list_contacts()
            .unwrap()
            .into_iter()
            .find(|contact| contact.email == "ada@example.com")
            .unwrap();
        let merged = store.merge_contacts(target.id, created.id).unwrap();
        assert!(merged
            .aliases
            .contains(&"merge-source@example.com".to_string()));
        assert!(merged
            .aliases
            .contains(&"source.alias@example.com".to_string()));
        assert!(merged.vip);
        assert_eq!(
            merged.message_count,
            target.message_count + created.message_count
        );
        assert!(store
            .list_contacts()
            .unwrap()
            .iter()
            .all(|contact| contact.id != created.id));

        let deleted = store
            .create_contact(ContactCreateInput {
                name: "Delete Me".to_string(),
                email: "delete-me@example.com".to_string(),
                aliases: Vec::new(),
                vip: false,
            })
            .unwrap();
        store.delete_contact(deleted.id).unwrap();
        assert!(store
            .list_contacts()
            .unwrap()
            .iter()
            .all(|contact| contact.id != deleted.id));
    }

    #[test]
    fn sent_header_scan_is_explicit_idempotent_and_initial_scan_runs_once() {
        let store = test_store();
        assert!(store.should_auto_scan_recent_contacts().unwrap());

        let first = store.scan_recent_contacts(true).unwrap();
        assert!(!first.skipped);
        assert!(first.scanned_messages >= 1);
        assert!(store
            .list_contacts()
            .unwrap()
            .iter()
            .any(|contact| contact.email == "team@example.com"));
        assert!(!store.should_auto_scan_recent_contacts().unwrap());

        let repeated_initial = store.scan_recent_contacts(true).unwrap();
        assert!(repeated_initial.skipped);
        let manual = store.scan_recent_contacts(false).unwrap();
        assert!(!manual.skipped);
    }

    #[test]
    fn draft_recipients_are_added_only_after_smtp_success_transition() {
        let store = test_store();
        let message_id = store
            .send_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "\"张三, 销售\" <new-to@example.com>".to_string(),
                cc: "Ada New <new-cc@example.com>".to_string(),
                bcc: "new-bcc@example.com".to_string(),
                subject: "Contact success gate".to_string(),
                body: "body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let before = store.list_contacts().unwrap();
        assert!(before
            .iter()
            .all(|contact| !contact.email.starts_with("new-")));

        store
            .mark_outbox_smtp_sent_pending_archive(message_id, "<contact-success@example.com>")
            .unwrap();
        store.sync_contacts_from_sent_message(message_id).unwrap();
        store.sync_contacts_from_sent_message(message_id).unwrap();

        let contacts = store.list_contacts().unwrap();
        let to = contacts
            .iter()
            .find(|contact| contact.email == "new-to@example.com")
            .unwrap();
        assert_eq!(to.name, "张三, 销售");
        assert_eq!(to.message_count, 1);
        assert!(contacts
            .iter()
            .any(|contact| { contact.email == "new-cc@example.com" && contact.name == "Ada New" }));
        assert!(contacts
            .iter()
            .any(|contact| contact.email == "new-bcc@example.com"));
    }

    #[test]
    fn contact_import_creates_and_merges_by_primary_email() {
        let store = test_store();
        let (created, updated) = store
            .import_contacts(vec![
                ContactCreateInput {
                    name: "Imported Person".to_string(),
                    email: "imported@example.com".to_string(),
                    aliases: vec!["imported.alias@example.com".to_string()],
                    vip: true,
                },
                ContactCreateInput {
                    name: "Ada Imported".to_string(),
                    email: "ADA@EXAMPLE.COM".to_string(),
                    aliases: vec!["ada.vcard@example.com".to_string()],
                    vip: true,
                },
            ])
            .unwrap();

        assert_eq!(created, 1);
        assert_eq!(updated, 1);
        let contacts = store.list_all_contacts().unwrap();
        let imported = contacts
            .iter()
            .find(|contact| contact.email == "imported@example.com")
            .unwrap();
        assert_eq!(imported.name, "Imported Person");
        assert_eq!(
            imported.aliases,
            vec!["imported.alias@example.com".to_string()]
        );
        assert!(imported.vip);

        let ada = contacts
            .iter()
            .find(|contact| contact.email == "ada@example.com")
            .unwrap();
        assert!(ada.aliases.contains(&"ada.vcard@example.com".to_string()));
        assert!(ada.vip);
    }

    #[test]
    fn contact_import_entries_respect_edits_and_survive_collisions() {
        let store = test_store();
        store
            .create_contact(ContactCreateInput {
                name: "Existing Ada".to_string(),
                email: "existing@example.com".to_string(),
                aliases: vec!["existing.old@example.com".to_string()],
                vip: false,
            })
            .unwrap();

        let summary = store
            .commit_contact_import_entries(
                vec![
                    (
                        ContactCreateInput {
                            name: "Collision".to_string(),
                            email: "existing@example.com".to_string(),
                            aliases: Vec::new(),
                            vip: false,
                        },
                        "create".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "Ada Edited".to_string(),
                            email: "existing@example.com".to_string(),
                            aliases: vec!["existing.new@example.com".to_string()],
                            vip: true,
                        },
                        "merge".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "New Person".to_string(),
                            email: "new.person@example.com".to_string(),
                            aliases: vec!["alias.person@example.com".to_string()],
                            vip: false,
                        },
                        "create".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "Broken".to_string(),
                            email: "not-an-email".to_string(),
                            aliases: Vec::new(),
                            vip: false,
                        },
                        "create".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "Skipped".to_string(),
                            email: "skip@example.com".to_string(),
                            aliases: Vec::new(),
                            vip: false,
                        },
                        "skip".to_string(),
                    ),
                ],
                "edits.csv",
                "global",
            )
            .unwrap();

        assert_eq!(summary.created, 1);
        assert_eq!(summary.merged, 2);
        assert_eq!(summary.skipped, 2);

        let contacts = store.list_all_contacts().unwrap();
        let merged_contact = contacts
            .iter()
            .find(|contact| contact.email == "existing@example.com")
            .unwrap();
        assert_eq!(merged_contact.name, "Ada Edited");
        assert!(merged_contact
            .aliases
            .contains(&"existing.old@example.com".to_string()));
        assert!(merged_contact
            .aliases
            .contains(&"existing.new@example.com".to_string()));
        assert!(merged_contact.vip);
        assert!(!contacts
            .iter()
            .any(|contact| contact.email == "skip@example.com"));
        assert!(contacts
            .iter()
            .any(|contact| contact.email == "new.person@example.com"));
    }

    #[test]
    fn local_backup_round_trips_seeded_mailbox_state() {
        let store = test_store();
        let backup = store.export_local_backup().unwrap();
        let original_stats = store.get_stats_for_account(None).unwrap();
        let original_account_count = store.list_accounts().unwrap().len();
        let original_rule_count = store.list_rules().unwrap().len();
        let summary = MailStore::summarize_local_backup(&backup, "backup.json".to_string(), 1024);

        assert_eq!(backup.schema_version, LOCAL_BACKUP_SCHEMA_VERSION);
        assert_eq!(summary.accounts, original_account_count as i64);
        assert_eq!(summary.messages, original_stats.total_messages);
        assert_eq!(summary.rules, original_rule_count as i64);
        assert!(!summary.credentials_included);

        let restored = test_store();
        restored.import_local_backup(&backup).unwrap();
        let restored_stats = restored.get_stats_for_account(None).unwrap();
        assert_eq!(restored_stats.total_messages, original_stats.total_messages);
        assert_eq!(
            restored.list_accounts().unwrap().len(),
            original_account_count
        );
        assert_eq!(restored.list_rules().unwrap().len(), original_rule_count);
    }

    #[test]
    fn failed_outbox_items_wait_until_next_retry_window() {
        let store = test_store();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "retry@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Retry me".to_string(),
                body: "Try again later".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        assert_eq!(item.status, "queued");
        assert!(item.next_attempt_at.is_empty());

        store
            .mark_outbox_failed(item.message_id, "temporary SMTP failure")
            .unwrap();
        let retry_item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();
        assert_eq!(retry_item.status, "retry");
        assert_eq!(retry_item.attempts, 1);
        assert_eq!(retry_item.last_error, "temporary SMTP failure");
        assert!(!retry_item.next_attempt_at.is_empty());

        let before_retry = store
            .pending_outbox_messages_due_at(&retry_item.queued_at)
            .unwrap();
        assert!(before_retry
            .iter()
            .all(|message| message.id != item.message_id));

        let due_retry = store
            .pending_outbox_messages_due_at(&retry_item.next_attempt_at)
            .unwrap();
        assert!(due_retry
            .iter()
            .any(|message| message.id == item.message_id));

        let message_id_header = "<better-email-test-outbox@better-email.local>";
        store
            .mark_outbox_smtp_sent_pending_archive(item.message_id, message_id_header)
            .unwrap();
        let archive_pending_item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();
        assert_eq!(archive_pending_item.status, "sent_remote_pending");
        assert_eq!(archive_pending_item.attempts, 2);
        assert!(archive_pending_item.last_error.is_empty());
        assert!(archive_pending_item.next_attempt_at.is_empty());
        assert!(store
            .pending_outbox_messages()
            .unwrap()
            .iter()
            .all(|message| message.id != item.message_id));
        assert!(store
            .pending_remote_archive_messages()
            .unwrap()
            .iter()
            .any(|message| message.id == item.message_id));

        let (folder_role, saved_message_id): (String, String) = store
            .with_conn(|conn| {
                conn.query_row(
                    "
                    SELECT f.role, m.message_id_header
                    FROM messages m
                    JOIN folders f ON f.id = m.folder_id
                    WHERE m.id = ?1
                    ",
                    params![item.message_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(MailError::from)
            })
            .unwrap();
        assert_eq!(folder_role, "sent");
        assert_eq!(saved_message_id, message_id_header);

        store
            .mark_outbox_remote_archive_failed(item.message_id, "temporary IMAP append failure")
            .unwrap();
        let archive_retry_item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();
        assert_eq!(archive_retry_item.status, "sent_remote_pending");
        assert_eq!(
            archive_retry_item.last_error,
            "temporary IMAP append failure"
        );
        assert!(!archive_retry_item.next_attempt_at.is_empty());
        assert!(store
            .pending_remote_archive_messages_due_at(&archive_retry_item.queued_at)
            .unwrap()
            .iter()
            .all(|message| message.id != item.message_id));
        assert!(store
            .pending_remote_archive_messages_due_at(&archive_retry_item.next_attempt_at)
            .unwrap()
            .iter()
            .any(|message| message.id == item.message_id));

        store
            .mark_outbox_remote_archived(item.message_id, "Sent", 42)
            .unwrap();
        let sent_item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();
        assert_eq!(sent_item.status, "sent");
        assert!(sent_item.last_error.is_empty());
        assert!(sent_item.next_attempt_at.is_empty());
        let remote_ref: (String, i64) = store
            .with_conn(|conn| {
                conn.query_row(
                    "SELECT remote_mailbox, remote_uid FROM messages WHERE id = ?1",
                    params![item.message_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .map_err(MailError::from)
            })
            .unwrap();
        assert_eq!(remote_ref, ("Sent".to_string(), 42));
    }

    #[test]
    fn blocked_outbox_items_do_not_retry_automatically() {
        let store = test_store();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "blocked@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Needs credential".to_string(),
                body: "Pause until credential is saved".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();

        store
            .mark_outbox_blocked(
                item.message_id,
                "缺少账号授权码，请在账号设置中重新保存授权码；已暂停自动发送。",
            )
            .unwrap();

        let blocked_item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();
        assert_eq!(blocked_item.status, "failed");
        assert_eq!(blocked_item.attempts, 1);
        assert!(blocked_item.next_attempt_at.is_empty());
        assert!(store
            .pending_outbox_messages()
            .unwrap()
            .iter()
            .all(|message| message.id != item.message_id));
    }

    #[test]
    fn due_scheduled_outbox_items_release_without_sending() {
        let store = test_store();
        let send_at = "2026-07-09T18:00:00+08:00".to_string();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "scheduled@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Send later".to_string(),
                body: "Wait for manual send".to_string(),
                html_body: String::new(),
                send_at,
                attachments: Vec::new(),
            })
            .unwrap();

        let released = store.release_due_outbox_items().unwrap();
        let released_item = released
            .into_iter()
            .find(|entry| entry.id == item.id)
            .unwrap();

        assert_eq!(released_item.status, "queued");
        assert_eq!(
            released_item.last_error,
            "已到发送时间，等待手动点击真实发送。"
        );
        assert!(released_item.next_attempt_at.is_empty());
    }

    #[test]
    fn provider_write_validation_messages_span_outbox_sent_and_inbox() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let validation_id = "validation-db-001";
        let subject = format!("[Better Email 验收] {validation_id}");
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: account.id,
                identity_id: 0,
                to: account.email.clone(),
                cc: String::new(),
                bcc: String::new(),
                subject: subject.clone(),
                body: "validation body".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();

        let queued = store
            .list_provider_write_validation_messages(account.id, validation_id.to_string())
            .unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].id, item.message_id);
        assert_eq!(queued[0].folder_role, "outbox");

        store
            .mark_outbox_smtp_sent_pending_archive(
                item.message_id,
                "<validation-db-001@better-email.local>",
            )
            .unwrap();
        store
            .mark_outbox_remote_archived(item.message_id, "Sent", 4201)
            .unwrap();
        store
            .with_conn(|conn| {
                let inbox_id: i64 = conn.query_row(
                    "SELECT id FROM folders WHERE account_id = ?1 AND role = 'inbox'",
                    params![account.id],
                    |row| row.get(0),
                )?;
                conn.execute(
                    "
                    INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, has_attachments,
                        remote_mailbox, remote_uid, message_id_header
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?4, ?5, 'validation receipt', 'validation receipt',
                        ?6, 1, 'INBOX', 4202, '<validation-db-001@better-email.local>'
                    )
                    ",
                    params![
                        account.id,
                        inbox_id,
                        account.display_name,
                        account.email,
                        subject,
                        Utc::now().to_rfc3339(),
                    ],
                )?;
                let received_id = conn.last_insert_rowid();
                conn.execute(
                    "
                    INSERT INTO attachments(message_id, filename, mime_type, size_bytes)
                    VALUES (?1, 'validation.txt', 'text/plain', 12)
                    ",
                    params![received_id],
                )?;
                Ok(())
            })
            .unwrap();

        let tracked = store
            .list_provider_write_validation_messages(account.id, validation_id.to_string())
            .unwrap();
        assert_eq!(tracked.len(), 2);
        assert!(tracked.iter().any(|message| {
            message.folder_role == "sent"
                && message.remote_mailbox == "Sent"
                && message.remote_uid == 4201
        }));
        assert!(tracked.iter().any(|message| {
            message.folder_role == "inbox"
                && message.remote_mailbox == "INBOX"
                && message.remote_uid == 4202
                && message.attachment_count == 1
        }));
        assert!(store
            .list_provider_write_validation_messages(account.id, "missing-id".to_string())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn scheduled_outbox_items_wait_until_send_time() {
        let store = test_store();
        let send_at = "2026-07-09T18:00:00+08:00".to_string();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "later@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Send later".to_string(),
                body: "Hold this message until the schedule opens".to_string(),
                html_body: String::new(),
                send_at: send_at.clone(),
                attachments: Vec::new(),
            })
            .unwrap();

        assert_eq!(item.status, "scheduled");
        assert_eq!(item.next_attempt_at, send_at);

        let before_send = store
            .pending_outbox_messages_due_at("2026-07-09T17:59:59+08:00")
            .unwrap();
        assert!(before_send
            .iter()
            .all(|message| message.id != item.message_id));

        let due_send = store.pending_outbox_messages_due_at(&send_at).unwrap();
        assert!(due_send.iter().any(|message| message.id == item.message_id));
    }

    #[test]
    fn thread_messages_are_loaded_in_chronological_order() {
        let store = test_store();
        let thread = store
            .list_threads_for_scope(None, None, None, None, 50)
            .unwrap()
            .into_iter()
            .find(|thread| thread.message_count > 0)
            .expect("seed thread exists");
        let messages = store
            .list_thread_messages(None, thread.thread_key, 20)
            .unwrap();

        assert_eq!(messages.len() as i64, thread.message_count);
        assert!(messages
            .windows(2)
            .all(|pair| pair[0].received_at <= pair[1].received_at));
    }

    #[test]
    fn background_tasks_are_persisted_deduplicated_and_completed() {
        let store = test_store();
        let first_sync = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "manual".to_string(),
                account_id: None,
            })
            .unwrap();
        let duplicate_sync = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "timer".to_string(),
                account_id: None,
            })
            .unwrap();
        assert_eq!(first_sync.id, duplicate_sync.id);
        assert_eq!(first_sync.status, "queued");

        let outbox_task = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "outbox-smtp".to_string(),
                source: "manual".to_string(),
                account_id: None,
            })
            .unwrap();
        assert_ne!(first_sync.id, outbox_task.id);
        let duplicate_outbox = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "outbox-smtp".to_string(),
                source: "timer".to_string(),
                account_id: None,
            })
            .unwrap();
        assert_eq!(outbox_task.id, duplicate_outbox.id);

        let next = store.next_background_task().unwrap().unwrap();
        assert_eq!(next.id, first_sync.id);
        let running = store.mark_background_task_running(next.id).unwrap();
        assert_eq!(running.status, "running");
        assert!(!running.started_at.is_empty());

        let completed = store
            .complete_background_task(running.id, "同步完成")
            .unwrap();
        assert_eq!(completed.status, "done");
        assert_eq!(completed.message, "同步完成");
        assert!(!completed.finished_at.is_empty());

        let failed = store
            .mark_background_task_running(outbox_task.id)
            .and_then(|task| store.fail_background_task(task.id, "SMTP 失败"))
            .unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.message, "SMTP 失败");

        let tasks = store.list_background_tasks().unwrap();
        assert!(tasks.iter().any(|task| task.id == completed.id));
        assert!(tasks.iter().any(|task| task.id == failed.id));
    }

    #[test]
    fn background_tasks_are_account_bound_cancellable_and_retryable() {
        let store = test_store();
        let account_a = store
            .create_account(AccountCreateInput {
                email: "a@example.com".to_string(),
                display_name: "A".to_string(),
                provider: "custom".to_string(),
                imap_host: "imap.example.com:993".to_string(),
                smtp_host: "smtp.example.com:587".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        let account_b = store
            .create_account(AccountCreateInput {
                email: "b@example.com".to_string(),
                display_name: "B".to_string(),
                provider: "custom".to_string(),
                imap_host: "imap.example.com:993".to_string(),
                smtp_host: "smtp.example.com:587".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();

        // 同账号去重，不同账号各自独立排队
        let task_a1 = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "initial".to_string(),
                account_id: Some(account_a.id),
            })
            .unwrap();
        let task_a2 = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "manual".to_string(),
                account_id: Some(account_a.id),
            })
            .unwrap();
        assert_eq!(task_a1.id, task_a2.id);
        assert_eq!(task_a1.account_id, Some(account_a.id));
        assert_eq!(task_a1.title, "首次同步邮件头");
        let task_b = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "initial".to_string(),
                account_id: Some(account_b.id),
            })
            .unwrap();
        assert_ne!(task_a1.id, task_b.id);

        // 排队中取消
        let cancelled = store.cancel_background_task(task_b.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.message, "已取消");

        // 重试后回到排队
        let retried = store.retry_background_task(cancelled.id).unwrap();
        assert_eq!(retried.status, "queued");
        assert_eq!(retried.message, "等待执行");

        // 运行中取消：请求标记 + 安全检查点消费
        let running = store.mark_background_task_running(retried.id).unwrap();
        let cancel_requested = store.cancel_background_task(running.id).unwrap();
        assert!(cancel_requested.cancel_requested);
        assert_eq!(cancel_requested.status, "running");
        assert!(store.consume_background_task_cancel(retried.id).unwrap());
        let consumed = store.get_background_task_by_id(retried.id).unwrap();
        assert_eq!(consumed.status, "cancelled");
        assert!(!consumed.cancel_requested);

        // 已取消任务重试后取消请求被清除
        let retried_again = store.retry_background_task(retried.id).unwrap();
        assert_eq!(retried_again.status, "queued");
        assert!(!retried_again.cancel_requested);
    }

    #[test]
    fn background_task_transitions_are_atomic_against_cancellation() {
        let store = test_store();
        let queued = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "manual".to_string(),
                account_id: None,
            })
            .unwrap();

        // 竞态 1：queued 任务已被取消后，worker 不能再把它标记为 running。
        let cancelled = store.cancel_background_task(queued.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        let mark_result = store.mark_background_task_running(queued.id);
        assert!(
            mark_result.is_err(),
            "已取消的 queued 任务不能被 worker 领取"
        );
        let still = store.get_background_task_by_id(queued.id).unwrap();
        assert_eq!(still.status, "cancelled");

        // 竞态 2：running 任务被请求取消后，不能把完整同步误标为 done。
        let running = store
            .mark_background_task_running(
                store
                    .enqueue_background_task(BackgroundTaskInput {
                        kind: "sync".to_string(),
                        source: "timer".to_string(),
                        account_id: None,
                    })
                    .unwrap()
                    .id,
            )
            .unwrap();
        let cancel_requested = store.cancel_background_task(running.id).unwrap();
        assert!(cancel_requested.cancel_requested);
        assert_eq!(cancel_requested.status, "running");
        assert!(store.background_task_cancel_requested(running.id).unwrap());
        assert!(store
            .complete_background_task(running.id, "同步完成")
            .is_err());
        assert!(store.fail_background_task(running.id, "同步失败").is_err());
        let unchanged = store.get_background_task_by_id(running.id).unwrap();
        assert_eq!(unchanged.status, "running");
        assert!(unchanged.cancel_requested);
        assert!(store.consume_background_task_cancel(running.id).unwrap());
        let consumed = store.get_background_task_by_id(running.id).unwrap();
        assert_eq!(consumed.status, "cancelled");
        assert!(!consumed.cancel_requested);
        assert!(!store.background_task_cancel_requested(running.id).unwrap());

        // 竞态 3：正常完成的 running 任务不受影响。
        let normal = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "manual".to_string(),
                account_id: None,
            })
            .unwrap();
        store.mark_background_task_running(normal.id).unwrap();
        let done = store
            .complete_background_task(normal.id, "同步完成")
            .unwrap();
        assert_eq!(done.status, "done");

        // 进度只对 running 任务生效，完成后不再更新。
        let progress = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "initial".to_string(),
                account_id: None,
            })
            .unwrap();
        store.mark_background_task_running(progress.id).unwrap();
        let progressed = store
            .update_background_task_progress(progress.id, 40, "正在同步文件夹 2/5")
            .unwrap();
        assert_eq!(progressed.progress, 40);
        assert_eq!(progressed.message, "正在同步文件夹 2/5");
        store
            .complete_background_task(progress.id, "同步完成")
            .unwrap();
        let after_done = store
            .update_background_task_progress(progress.id, 100, "不应更新")
            .unwrap();
        assert_eq!(after_done.progress, 40, "已完成任务不得再写入进度");
        assert_eq!(after_done.status, "done");
    }

    #[test]
    fn restart_recovery_marks_running_tasks_failed_and_keeps_queued() {
        let path = test_database_path("better-email-restart");
        let running_task = {
            let store = MailStore::open_at_with_seed(path.clone(), false).unwrap();
            let queued = store
                .enqueue_background_task(BackgroundTaskInput {
                    kind: "sync".to_string(),
                    source: "initial".to_string(),
                    account_id: None,
                })
                .unwrap();
            store
                .enqueue_background_task(BackgroundTaskInput {
                    kind: "outbox-dry-run".to_string(),
                    source: "manual".to_string(),
                    account_id: None,
                })
                .unwrap();
            store.mark_background_task_running(queued.id).unwrap()
        };

        // 模拟应用重启：重新打开数据库，运行中的任务转失败可重试，排队任务保留。
        let reopened = MailStore::open_at_with_seed(path.clone(), false).unwrap();
        let tasks = reopened.list_background_tasks().unwrap();
        let recovered = tasks
            .iter()
            .find(|task| task.id == running_task.id)
            .unwrap();
        assert_eq!(recovered.status, "failed");
        assert_eq!(recovered.message, "应用重启时中断，可重试");
        let queued_after = tasks
            .iter()
            .filter(|task| task.id != running_task.id)
            .find(|task| task.status == "queued");
        assert!(queued_after.is_some(), "排队任务在重启后保留并可恢复");
        let retried = reopened.retry_background_task(recovered.id).unwrap();
        assert_eq!(retried.status, "queued");
        assert!(!retried.cancel_requested);
    }

    #[test]
    fn onboarding_completed_marks_only_new_accounts() {
        let store = test_store();
        let created = store
            .create_account(AccountCreateInput {
                email: "new@example.com".to_string(),
                display_name: "New".to_string(),
                provider: "custom".to_string(),
                imap_host: "imap.example.com:993".to_string(),
                smtp_host: "smtp.example.com:587".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        assert!(!created.onboarding_completed);
        assert!(!created.warn_external_senders);

        let updated = store
            .update_account_settings_for(
                Some(created.id),
                AccountSettingsInput {
                    display_name: "New".to_string(),
                    provider: "custom".to_string(),
                    imap_host: "imap.example.com:993".to_string(),
                    smtp_host: "smtp.example.com:587".to_string(),
                    incoming_protocol: "imap".to_string(),
                    auth_type: "password".to_string(),
                    sync_mode: "manual".to_string(),
                    remote_images_allowed: false,
                    signature: String::new(),
                    cross_account_risk_warning: true,
                    block_external_mailboxes: false,
                    intercept_https_links: true,
                    auto_download_attachments: false,
                    fetch_history_attachments: false,
                    warn_external_senders: true,
                },
            )
            .unwrap();
        assert!(updated.warn_external_senders);
        assert!(!updated.onboarding_completed);

        let marked = store
            .set_account_onboarding_completed(created.id, true)
            .unwrap();
        assert!(marked.onboarding_completed);
    }

    #[test]
    fn rules_can_be_created_updated_disabled_and_deleted() {
        let store = test_store();
        let created = store
            .upsert_rule(
                None,
                MailRuleInput {
                    name: "VIP vendor".to_string(),
                    condition: "from contains vendor".to_string(),
                    action: "apply label 工作".to_string(),
                    enabled: true,
                },
            )
            .unwrap();
        assert_eq!(created.name, "VIP vendor");
        assert!(created.enabled);

        let updated = store
            .upsert_rule(
                Some(created.id),
                MailRuleInput {
                    name: "VIP vendor updated".to_string(),
                    condition: "subject contains invoice".to_string(),
                    action: "star".to_string(),
                    enabled: false,
                },
            )
            .unwrap();
        assert_eq!(updated.action, "star");
        assert!(!updated.enabled);

        let enabled = store.set_rule_enabled(updated.id, true).unwrap();
        assert!(enabled.enabled);

        store.delete_rule(enabled.id).unwrap();
        assert!(!store
            .list_rules()
            .unwrap()
            .iter()
            .any(|rule| rule.id == enabled.id));
    }

    #[test]
    fn rules_apply_multiple_actions_and_can_stop_processing() {
        let store = test_store();
        let account = store.get_account().unwrap();
        let mailbox = store
            .save_imap_mailboxes(&[ImapFolderProbe {
                name: "INBOX".to_string(),
                delimiter: "/".to_string(),
                attributes: vec!["Inbox".to_string()],
            }])
            .unwrap()
            .remove(0);
        store
            .upsert_rule(
                None,
                MailRuleInput {
                    name: "Multi action customer rule".to_string(),
                    condition: "from contains workflow-customer".to_string(),
                    action: "apply label 重要客户; mark read; star; stop processing".to_string(),
                    enabled: true,
                },
            )
            .unwrap();
        store
            .upsert_rule(
                None,
                MailRuleInput {
                    name: "Should stop before this rule".to_string(),
                    condition: "from contains workflow-customer".to_string(),
                    action: "move to trash".to_string(),
                    enabled: true,
                },
            )
            .unwrap();
        store
            .import_imap_headers(
                mailbox.id,
                &ImapHeaderBatch {
                    remote_name: "INBOX".to_string(),
                    uid_validity: "rule-stop".to_string(),
                    highest_uid: 9901,
                    lowest_uid: 9901,
                    history_complete: false,
                    history_scanned: true,
                    cursor_reset: false,
                    headers: vec![crate::models::RemoteMessageHeader {
                        remote_uid: 9901,
                        message_id: "rule-stop-9901@example.com".to_string(),
                        in_reply_to: String::new(),
                        references: String::new(),
                        sender_name: "Workflow Customer".to_string(),
                        sender_email: "workflow-customer@example.com".to_string(),
                        recipients: account.email.clone(),
                        subject: "Rule stop workflow".to_string(),
                        snippet: "Rule engine should apply actions and stop.".to_string(),
                        received_at: "2026-07-09T13:00:00+08:00".to_string(),
                        is_read: false,
                        is_starred: false,
                    }],
                },
            )
            .unwrap();

        let inbox = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let messages = store
            .list_messages_for_scope(
                None,
                inbox.id,
                Some("from:workflow-customer".to_string()),
                None,
                10,
            )
            .unwrap();
        let message = messages
            .iter()
            .find(|message| message.subject == "Rule stop workflow")
            .expect("imported rule workflow message is visible");
        assert!(message.is_read);
        assert!(message.is_starred);
        assert!(message.labels.iter().any(|label| label == "重要客户"));
        assert_eq!(message.folder_role, "inbox");
    }

    #[test]
    fn queued_outbox_item_can_be_cancelled_back_to_drafts() {
        let store = test_store();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "undo@example.com".to_string(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Undo send".to_string(),
                body: "Move me back to drafts".to_string(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: Vec::new(),
            })
            .unwrap();
        let cancelled = store.cancel_outbox_item(item.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.last_error, "已撤回到草稿箱");

        let drafts = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let draft_messages = store
            .list_messages_for_scope(None, drafts.id, Some("Undo send".to_string()), None, 10)
            .unwrap();
        assert!(draft_messages
            .iter()
            .any(|message| message.id == item.message_id));
        assert!(store
            .pending_outbox_messages()
            .unwrap()
            .iter()
            .all(|message| message.id != item.message_id));
    }

    #[test]
    fn local_eml_import_persists_safe_body_contact_and_attachment_file() {
        let store = test_store();
        let raw = concat!(
            "Subject: Local migration sample\r\n",
            "From: \"Migration Sender\" <migration@example.com>\r\n",
            "To: demo@better-email.local\r\n",
            "Date: Thu, 09 Jul 2026 10:00:00 +0800\r\n",
            "Message-ID: <migration-1@example.com>\r\n",
            "Content-Type: multipart/mixed; boundary=\"mix\"\r\n",
            "\r\n",
            "--mix\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p onclick=\"bad()\">Imported safely.</p><img src=\"http://tracker.example/open.png\"><script>bad()</script>\r\n",
            "--mix\r\n",
            "Content-Type: text/plain; name=\"migration-note.txt\"\r\n",
            "Content-Disposition: attachment; filename=\"migration-note.txt\"\r\n",
            "Content-Transfer-Encoding: base64\r\n",
            "\r\n",
            "bG9jYWwgYXR0YWNobWVudA==\r\n",
            "--mix--\r\n",
        );

        let imported = store.import_eml_message(None, raw.as_bytes()).unwrap();
        assert_eq!(imported.folder_role, "inbox");
        assert_eq!(imported.subject, "Local migration sample");
        assert_eq!(imported.sender_email, "migration@example.com");
        assert!(imported.is_read);
        assert!(imported.has_attachments);
        assert!(!imported.sanitized_html.contains("<script"));
        assert!(!imported.sanitized_html.contains("onclick"));
        assert!(!imported.sanitized_html.contains("src=\"http"));
        assert!(imported
            .security_warnings
            .iter()
            .any(|warning| warning.contains("远程图片")));

        let attachments = store.list_attachments(imported.id).unwrap();
        assert_eq!(attachments.len(), 1);
        assert!(attachments[0].is_downloaded);
        assert!(!attachments[0].local_path.is_empty());
        assert_eq!(
            fs::read(&attachments[0].local_path).unwrap(),
            b"local attachment"
        );
        assert!(store
            .list_contacts()
            .unwrap()
            .iter()
            .any(|contact| contact.email == "migration@example.com"));
    }

    #[test]
    fn cache_cleanup_removes_remote_files_and_preserves_local_imports() {
        let store = test_store();
        let inbox = store
            .list_folders_for_account(None)
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .unwrap();
        let remote_message = store
            .list_messages_for_scope(None, inbox.id, None, None, 10)
            .unwrap()
            .remove(0);
        store
            .set_message_remote_ref(remote_message.id, "INBOX", 9901)
            .unwrap();
        store
            .update_message_body(
                remote_message.id,
                &RemoteMessageBody {
                    body: "Remote cache".to_string(),
                    sanitized_html: String::new(),
                    security_warnings: Vec::new(),
                    snippet: "Remote cache".to_string(),
                    has_attachments: true,
                    attachments: vec![crate::models::RemoteAttachmentMetadata {
                        filename: "remote-cache.bin".to_string(),
                        mime_type: "application/octet-stream".to_string(),
                        size_bytes: 64,
                        content_id: String::new(),
                        is_inline: false,
                    }],
                },
            )
            .unwrap();
        let remote_attachment = store.list_attachments(remote_message.id).unwrap().remove(0);
        let remote_dir = store.attachment_dir(remote_message.id);
        fs::create_dir_all(&remote_dir).unwrap();
        let remote_path = remote_dir.join(format!("{}-remote-cache.bin", remote_attachment.id));
        fs::write(&remote_path, vec![7_u8; 64]).unwrap();
        store
            .mark_attachment_downloaded(remote_attachment.id, &remote_path.to_string_lossy(), 64)
            .unwrap();
        let partial_path = remote_dir.join("999.download");
        fs::write(&partial_path, vec![3_u8; 32]).unwrap();

        let local_raw = concat!(
            "Subject: Protected local attachment\r\n",
            "From: Local <local@example.com>\r\n",
            "To: demo@better-email.local\r\n",
            "Content-Type: multipart/mixed; boundary=\"mix\"\r\n",
            "\r\n",
            "--mix\r\n",
            "Content-Type: text/plain\r\n",
            "\r\n",
            "Local body\r\n",
            "--mix\r\n",
            "Content-Type: text/plain; name=\"keep.txt\"\r\n",
            "Content-Disposition: attachment; filename=\"keep.txt\"\r\n",
            "Content-Transfer-Encoding: base64\r\n",
            "\r\n",
            "a2VlcCBtZQ==\r\n",
            "--mix--\r\n",
        );
        let local_message = store
            .import_eml_message(None, local_raw.as_bytes())
            .unwrap();
        let local_attachment = store.list_attachments(local_message.id).unwrap().remove(0);
        let local_path = PathBuf::from(&local_attachment.local_path);

        let before = store.storage_usage().unwrap();
        assert_eq!(before.cached_attachment_count, 1);
        assert_eq!(before.partial_download_count, 1);
        assert!(before.reclaimable_cache_bytes >= 96);
        assert!(before.local_attachment_bytes > 0);

        let cleared = store.clear_reclaimable_attachment_cache().unwrap();
        assert_eq!(cleared.reset_attachment_count, 1);
        assert_eq!(cleared.removed_file_count, 2);
        assert!(cleared.released_bytes >= 96);
        assert!(!remote_path.exists());
        assert!(!partial_path.exists());
        assert!(local_path.exists());
        assert_eq!(fs::read(local_path).unwrap(), b"keep me");

        let refreshed = store.get_attachment(remote_attachment.id).unwrap();
        assert!(!refreshed.is_downloaded);
        assert!(refreshed.local_path.is_empty());
        assert_eq!(cleared.storage.reclaimable_cache_bytes, 0);
        assert!(cleared.storage.local_attachment_bytes > 0);
    }

    #[test]
    fn malicious_backup_html_and_attachment_paths_are_sanitized_on_import() {
        // 备份 JSON 是不可信输入：导入 messages 时必须在 Rust 端重新生成
        // sanitized_html/security_warnings；attachments 的 local_path 必须清空，
        // 防止恶意备份注入脚本或借附件 id 读取任意文件。
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test-malicious-backup.sqlite3");
        let store = MailStore::open_at(db_path).unwrap();

        let mut messages = LocalBackupRow::new();
        messages.insert("id".into(), serde_json::json!(1));
        messages.insert("account_id".into(), serde_json::json!(1));
        messages.insert("folder_id".into(), serde_json::json!(1));
        messages.insert("sender_name".into(), serde_json::json!("Attacker"));
        messages.insert(
            "sender_email".into(),
            serde_json::json!("attacker@example.com"),
        );
        messages.insert("recipients".into(), serde_json::json!("me@example.com"));
        messages.insert("subject".into(), serde_json::json!("Malicious"));
        messages.insert("snippet".into(), serde_json::json!("snippet"));
        messages.insert(
            "body".into(),
            serde_json::json!(
            "<p>Hello</p><script>alert(1)</script><img src=\"http://tracker.example/open.png\">"
        ),
        );
        messages.insert(
            "received_at".into(),
            serde_json::json!("2026-01-01T00:00:00Z"),
        );
        // 备份携带的 sanitized_html 是恶意注入内容，导入时必须被当前 sanitizer 重写。
        messages.insert("sanitized_html".into(), serde_json::json!(
            "<script>alert(1)</script><img src=\"http://tracker.example/open.png\" onerror=\"bad()\">"
        ));
        messages.insert("security_warnings".into(), serde_json::json!(""));

        let mut attachments = LocalBackupRow::new();
        attachments.insert("id".into(), serde_json::json!(1));
        attachments.insert("message_id".into(), serde_json::json!(1));
        attachments.insert("filename".into(), serde_json::json!("leak.txt"));
        attachments.insert("mime_type".into(), serde_json::json!("text/plain"));
        attachments.insert("size_bytes".into(), serde_json::json!(123));
        // 恶意备份伪造已下载状态与任意路径（如 /etc/passwd）。
        attachments.insert("is_downloaded".into(), serde_json::json!(1));
        attachments.insert("local_path".into(), serde_json::json!("/etc/passwd"));
        attachments.insert("content_id".into(), serde_json::json!(""));
        attachments.insert("is_inline".into(), serde_json::json!(0));

        let mut tables = BTreeMap::new();
        let mut accounts = LocalBackupRow::new();
        accounts.insert("id".into(), serde_json::json!(1));
        accounts.insert("email".into(), serde_json::json!("restored@example.com"));
        accounts.insert("display_name".into(), serde_json::json!("Restored"));
        accounts.insert("provider".into(), serde_json::json!("gmail"));
        accounts.insert(
            "created_at".into(),
            serde_json::json!("2026-01-01T00:00:00Z"),
        );
        tables.insert("accounts".to_string(), vec![accounts]);
        let mut folders = LocalBackupRow::new();
        folders.insert("id".into(), serde_json::json!(1));
        folders.insert("account_id".into(), serde_json::json!(1));
        folders.insert("name".into(), serde_json::json!("收件箱"));
        folders.insert("role".into(), serde_json::json!("inbox"));
        folders.insert("sort_order".into(), serde_json::json!(10));
        tables.insert("folders".to_string(), vec![folders]);
        tables.insert("messages".to_string(), vec![messages]);
        tables.insert("attachments".to_string(), vec![attachments]);

        let backup = LocalBackup {
            schema_version: LOCAL_BACKUP_SCHEMA_VERSION,
            app_version: "test".to_string(),
            exported_at: Utc::now().to_rfc3339(),
            tables,
        };
        store.import_local_backup(&backup).unwrap();

        let restored_message = store
            .with_conn(|conn| {
                let row = conn.query_row(
                    "SELECT body, sanitized_html, security_warnings FROM messages WHERE id = 1",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )?;
                Ok(row)
            })
            .unwrap();
        assert!(
            !restored_message.1.contains("<script"),
            "导入后的 sanitized_html 不得包含 script：{}",
            restored_message.1
        );
        assert!(
            !restored_message.1.contains("onerror"),
            "导入后的 sanitized_html 不得包含事件属性：{}",
            restored_message.1
        );
        assert!(
            !restored_message.1.contains("http://tracker"),
            "导入后的 sanitized_html 不得包含远程图片 src：{}",
            restored_message.1
        );
        assert!(
            restored_message.2.contains("远程图片"),
            "重新生成的 security_warnings 应包含远程图片警告：{}",
            restored_message.2
        );

        let restored_attachment = store
            .with_conn(|conn| {
                let row = conn.query_row(
                    "SELECT is_downloaded, local_path FROM attachments WHERE id = 1",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )?;
                Ok(row)
            })
            .unwrap();
        assert_eq!(restored_attachment.0, 0, "导入后附件必须是未下载状态");
        assert!(
            restored_attachment.1.is_empty(),
            "导入后附件 local_path 必须清空（不能指向 /etc/passwd）：{}",
            restored_attachment.1
        );
    }

    #[test]
    fn validate_local_backup_rejects_oversized_tables() {
        use super::backup::validate_local_backup;
        let mut tables = BTreeMap::new();
        let mut accounts = LocalBackupRow::new();
        accounts.insert("id".into(), serde_json::json!(1));
        accounts.insert("email".into(), serde_json::json!("a@example.com"));
        accounts.insert("display_name".into(), serde_json::json!("A"));
        accounts.insert("provider".into(), serde_json::json!("gmail"));
        accounts.insert(
            "created_at".into(),
            serde_json::json!("2026-01-01T00:00:00Z"),
        );
        tables.insert("accounts".to_string(), vec![accounts]);
        // 超过行数上限。
        let many = (0..300_000)
            .map(|_| LocalBackupRow::new())
            .collect::<Vec<_>>();
        tables.insert("contacts".to_string(), many);
        let oversized = LocalBackup {
            schema_version: LOCAL_BACKUP_SCHEMA_VERSION,
            app_version: "test".to_string(),
            exported_at: "2026-01-01T00:00:00Z".to_string(),
            tables,
        };
        let err = validate_local_backup(&oversized).unwrap_err();
        assert!(
            err.to_string().contains("超过上限"),
            "超行数表应被拒绝：{err}"
        );
    }

    #[test]
    fn local_backup_excludes_sensitive_columns_and_credentials_table() {
        let temp_dir = tempfile::tempdir().unwrap();
        let db_path = temp_dir.path().join("test-backup-safety.sqlite3");
        let store = MailStore::open_at(db_path).unwrap();

        // 1. Create a mock account to satisfy foreign keys
        store.with_conn(|conn| {
            conn.execute(
                "INSERT INTO accounts(id, email, display_name, provider, created_at)
                 VALUES (999, 'test@example.com', 'Test User', 'gmail', '2026-07-15')",
                []
            )?;
            conn.execute(
                "INSERT INTO account_credentials(account_email, secret, updated_at) VALUES ('test@example.com', 'SUPER_SECRET_PASSWORD', '2026-07-15')",
                []
            )?;
            conn.execute(
                "INSERT INTO oauth_sessions(account_id, provider, authorization_url, redirect_uri, state, code_challenge, code_verifier, scopes, authorization_code, status, created_at)
                 VALUES (999, 'gmail', 'http://url', 'http://127.0.0.1', 'state_val', 'challenge', 'verifier', '[]', 'AUTH_CODE_LEAK', 'completed', '2026-07-15')",
                []
            )?;
            Ok(())
        }).unwrap();

        // 2. Export local backup
        let backup = store.export_local_backup().unwrap();

        // 3. Exclude checking account_credentials table entirely
        assert!(!backup.tables.contains_key("account_credentials"));

        // 4. Check for sensitive columns in oauth_sessions or accounts
        if let Some(oauth_rows) = backup.tables.get("oauth_sessions") {
            for row in oauth_rows {
                assert!(!row.contains_key("authorization_code"));
                assert!(!row.contains_key("secret"));
                assert!(!row.contains_key("code_verifier"));
                for val in row.values() {
                    let val_str = format!("{:?}", val);
                    assert!(!val_str.contains("AUTH_CODE_LEAK"));
                    assert!(!val_str.contains("SUPER_SECRET_PASSWORD"));
                    assert!(!val_str.contains("verifier"));
                }
            }
        }
    }

    #[test]
    fn undo_contact_import_batch_returns_within_timeout_and_removes_only_created_contacts() {
        // 回归测试：undo_contact_import_batch 之前在外层 with_conn 闭包尚未返回时
        // 又调用了一次 self.with_conn。MailStore 使用不可重入 Mutex，这会导致永久阻塞。
        // 这里在独立线程执行撤销，主线程用 recv_timeout 断言它必须在合理时间内返回。
        let db_path = test_database_path("better-email-undo-import");
        let store = MailStore::open_at(db_path.clone()).expect("store opens");
        store
            .create_contact(ContactCreateInput {
                name: "Existing".into(),
                email: "existing@example.com".into(),
                aliases: vec!["old@example.com".into()],
                vip: false,
            })
            .expect("pre-existing contact created");
        let summary = store
            .commit_contact_import_entries(
                vec![
                    (
                        ContactCreateInput {
                            name: "Alice".into(),
                            email: "alice@example.com".into(),
                            aliases: Vec::new(),
                            vip: false,
                        },
                        "create".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "Existing Import".into(),
                            email: "existing@example.com".into(),
                            aliases: vec!["import@example.com".into()],
                            vip: false,
                        },
                        "merge".to_string(),
                    ),
                    (
                        ContactCreateInput {
                            name: "Bob".into(),
                            email: "bob@example.com".into(),
                            aliases: Vec::new(),
                            vip: false,
                        },
                        "create".to_string(),
                    ),
                ],
                "contacts.vcf",
                "global",
            )
            .expect("import batch commits");
        assert_eq!(summary.created, 2, "batch should create two new contacts");
        assert_eq!(summary.merged, 1, "batch should merge one existing contact");
        drop(store);

        let (tx, rx) = std::sync::mpsc::channel();
        let undo_path = db_path.clone();
        std::thread::spawn(move || {
            let store = MailStore::open_at(undo_path).expect("reopen store for undo");
            let result = store.undo_contact_import_batch(summary.batch_id);
            let _ = tx.send(result);
        });
        let report = rx
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect(
                "undo_contact_import_batch must return within timeout (nested with_conn deadlock)",
            )
            .expect("undo succeeds");

        assert_eq!(
            report.removed, 2,
            "only the two created contacts are removed"
        );
        assert_eq!(
            report.remaining_created, 0,
            "no create entries remain for the batch"
        );

        let store = MailStore::open_at(db_path).expect("reopen store for verification");
        let contacts = store.list_contacts().expect("contacts load");
        assert!(
            !contacts
                .iter()
                .any(|contact| contact.email == "alice@example.com"),
            "created contact Alice must be deleted"
        );
        assert!(
            !contacts
                .iter()
                .any(|contact| contact.email == "bob@example.com"),
            "created contact Bob must be deleted"
        );
        let existing = contacts
            .iter()
            .find(|contact| contact.email == "existing@example.com")
            .expect("merged contact survives undo");
        assert_eq!(
            existing.name, "Existing Import",
            "merge/update changes must not be rolled back"
        );
    }

    #[test]
    fn snooze_messages_moves_every_target_in_one_transaction() {
        let store = test_store();
        let account = store.get_account().expect("seeded account loads");
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .expect("folders load")
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .expect("inbox folder exists");
        let seeded = store
            .list_messages_for_scope_sorted(Some(account.id), inbox.id, None, None, None, 10)
            .expect("seeded messages load");
        assert!(
            seeded.len() >= 2,
            "seed data must provide at least two inbox messages"
        );
        let ids: Vec<i64> = seeded.iter().take(3).map(|message| message.id).collect();
        let until = "2027-01-01T09:00:00+08:00";

        let snoozed = store
            .snooze_messages(&ids, until)
            .expect("batch snooze commits");
        assert_eq!(snoozed.len(), 3);
        for message in &snoozed {
            assert_eq!(message.folder_role, "snoozed");
            assert_eq!(message.snoozed_until, until);
            assert!(message.is_read, "snoozed messages are marked read");
        }

        let snoozed_folder = store
            .list_folders_for_account(Some(account.id))
            .expect("folders load")
            .into_iter()
            .find(|folder| folder.role == "snoozed")
            .expect("snoozed folder exists");
        let after = store
            .list_messages_for_scope_sorted(
                Some(account.id),
                snoozed_folder.id,
                None,
                None,
                None,
                20,
            )
            .expect("snoozed messages load");
        assert_eq!(
            after.len(),
            3,
            "all three targets land in the snoozed folder"
        );
    }

    #[test]
    fn snooze_messages_rolls_back_all_targets_when_any_fails() {
        let store = test_store();
        let account = store.get_account().expect("seeded account loads");
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .expect("folders load")
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .expect("inbox folder exists");
        let valid_id = store
            .list_messages_for_scope_sorted(Some(account.id), inbox.id, None, None, None, 1)
            .expect("seeded messages load")
            .first()
            .expect("seeded message exists")
            .id;

        let result = store.snooze_messages(&[valid_id, 999_999_999], "2027-01-01T09:00:00+08:00");
        assert!(
            result.is_err(),
            "a missing target must fail the whole batch"
        );

        let untouched = store.get_message(valid_id).expect("message still loads");
        assert_ne!(
            untouched.folder_role, "snoozed",
            "transaction rollback must keep the valid message in its original folder"
        );
        assert_eq!(
            untouched.snoozed_until, "",
            "transaction rollback must leave snoozed_until untouched"
        );
    }

    #[test]
    fn fts_update_trigger_is_gated_to_searchable_columns() {
        // 核心断言：messages_au 触发器必须带 WHEN 门控，标记已读/星标等非
        // FTS 列不会触发重建；同时验证更新正文仍会同步索引。
        let store = test_store();
        let account = store.get_account().expect("seeded account loads");
        let inbox = store
            .list_folders_for_account(Some(account.id))
            .expect("folders load")
            .into_iter()
            .find(|folder| folder.role == "inbox")
            .expect("inbox folder exists");
        let message_id = store
            .list_messages_for_scope_sorted(Some(account.id), inbox.id, None, None, None, 1)
            .expect("seeded messages load")
            .first()
            .expect("seeded message exists")
            .id;

        // 触发器定义包含 WHEN，且覆盖全部 FTS 索引列。
        store
            .with_conn(|conn| {
                let sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='messages_au'",
                    [],
                    |row| row.get(0),
                )?;
                assert!(sql.contains("WHEN"), "messages_au 必须带 WHEN 门控");
                for column in [
                    "subject",
                    "sender_name",
                    "sender_email",
                    "recipients",
                    "snippet",
                    "body",
                ] {
                    assert!(
                        sql.contains(&format!("old.{column} IS NOT new.{column}")),
                        "messages_au 必须覆盖 FTS 列 {column}"
                    );
                }
                Ok(())
            })
            .expect("trigger definition inspected");

        // 更新正文到唯一 token：FTS 应同步（新 token 可搜索）。
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body = ?1 WHERE id = ?2",
                    params!["zebraquarkalpha", message_id],
                )?;
                Ok(())
            })
            .expect("body update");
        store
            .with_conn(|conn| {
                let count: i64 = conn.query_row(
                    "SELECT count(*) FROM message_search WHERE message_search MATCH ?1",
                    params!["zebraquarkalpha"],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 1, "更新正文必须同步到 FTS 索引");
                Ok(())
            })
            .expect("fts synced after body update");

        // 只更新 is_read / is_starred（非搜索列）：索引保持可搜索，无数据丢失。
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET is_read = 1, is_starred = 1 WHERE id = ?1",
                    params![message_id],
                )?;
                Ok(())
            })
            .expect("read/star update");
        store
            .with_conn(|conn| {
                let count: i64 = conn.query_row(
                    "SELECT count(*) FROM message_search WHERE message_search MATCH ?1",
                    params!["zebraquarkalpha"],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 1, "标记已读/星标不得破坏 FTS 索引");
                Ok(())
            })
            .expect("fts intact after read/star update");

        // 再次更新正文：新内容进入索引（重建确实发生）。
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body = ?1 WHERE id = ?2",
                    params!["zebraquarkbeta", message_id],
                )?;
                Ok(())
            })
            .expect("second body update");
        store
            .with_conn(|conn| {
                let count: i64 = conn.query_row(
                    "SELECT count(*) FROM message_search WHERE message_search MATCH ?1",
                    params!["zebraquarkbeta"],
                    |row| row.get(0),
                )?;
                assert_eq!(count, 1, "再次更新正文后新 token 必须可搜索");
                Ok(())
            })
            .expect("fts synced after second body update");
    }

    #[test]
    fn fts_trigger_migration_replaces_unconditional_trigger_on_upgrade() {
        // 已有用户数据库里是旧的无条件触发器，只改 IF NOT EXISTS 文本不会生效；
        // 版本化迁移必须先 DROP 再 CREATE，并推进 user_version。
        let db_path = test_database_path("better-email-fts-trigger-upgrade");
        let store = MailStore::open_at(db_path.clone()).expect("store opens");
        store
            .with_conn(|conn| {
                conn.execute_batch(
                    "
                    DROP TRIGGER IF EXISTS messages_au;
                    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
                        INSERT INTO message_search(message_search, rowid, subject, sender_name, sender_email, recipients, snippet, body)
                        VALUES('delete', old.id, old.subject, old.sender_name, old.sender_email, old.recipients, old.snippet, old.body);
                        INSERT INTO message_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
                        VALUES (new.id, new.subject, new.sender_name, new.sender_email, new.recipients, new.snippet, new.body);
                    END;
                    PRAGMA user_version = 1;
                    ",
                )?;
                Ok(())
            })
            .expect("simulate legacy unconditional trigger");
        drop(store);

        // 重新打开触发 migrate：IF NOT EXISTS 保留旧触发器，随后版本化迁移替换之。
        let store = MailStore::open_at(db_path).expect("store reopens after migration");
        store
            .with_conn(|conn| {
                let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
                assert!(
                    version >= FTS_UPDATE_TRIGGER_SCHEMA_VERSION,
                    "FTS 触发器迁移必须推进 user_version"
                );
                let sql: String = conn.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='messages_au'",
                    [],
                    |row| row.get(0),
                )?;
                assert!(
                    sql.contains("WHEN"),
                    "迁移后 messages_au 必须带上 WHEN 门控"
                );
                assert!(
                    sql.contains("old.body IS NOT new.body"),
                    "迁移后触发器必须门控到 FTS 列"
                );
                Ok(())
            })
            .expect("migrated trigger inspected");
    }
}
