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

mod account_credentials;
mod accounts;
pub(crate) mod ai_settings;
mod app_settings;
mod attachments;
mod background_tasks;
mod backup;
mod composer_recovery;
mod contacts_rules;
mod folders;
mod labels;
mod messages;
mod migrations;
mod oauth;
mod outbox;
#[cfg(test)]
mod paging_tests;
mod read_connection;
mod search;
#[cfg(test)]
mod short_search_experiment;
mod substring_search;
mod sync;
mod trusted_html_cache;

use self::accounts::{ensure_default_account_for_conn, ensure_default_identity_for_account_conn};
#[cfg(test)]
use self::contacts_rules::upsert_contact;
use self::folders::{create_default_folders_for_account, folder_id_for_role};
use self::messages::thread_key_for_message;
use self::migrations::migrate_legacy_database;

mod error;
pub use error::{MailError, MailResult};

const VERBOSE_DB_LOG_ENV: &str = "BETTER_EMAIL_VERBOSE_COMMAND_LOGS";

fn verbose_db_logs_enabled() -> bool {
    // Release test binaries still need the unified log path enabled because
    // logging tests validate the emitted timestamped line itself.
    cfg!(debug_assertions)
        || cfg!(test)
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
    pub message_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageRemoteRef {
    pub account_id: i64,
    pub remote_mailbox: String,
    pub remote_uid: i64,
    pub remote_uid_validity: String,
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
    trusted_html: Arc<Mutex<trusted_html_cache::TrustedHtmlCache>>,
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
            trusted_html: Arc::new(Mutex::new(trusted_html_cache::TrustedHtmlCache::default())),
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
                    "INSERT INTO mail_rules(account_id, name, condition, action, enabled)
                     VALUES (?1, ?2, ?3, ?4, 1)",
                    params![account_id, name, condition, action],
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
                upsert_contact(conn, account_id, sender_name, sender_email, &received_at.to_rfc3339())?;
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
        WHERE (?1 IS NULL OR account_id = ?1)
          AND ((name = '重要客户置顶' AND condition = 'from contains customer' AND action = 'apply label 重要客户')
           OR (name = '安全提醒标记' AND condition = 'subject contains 安全' AND action = 'apply label 工作')
           OR (name = '新闻邮件稍后处理' AND condition = 'from contains updates' AND action = 'apply label 稍后处理'))
        ",
        params![demo_account_id],
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
        WHERE (?1 IS NULL OR account_id = ?1)
          AND ((lower(email) = 'ada@example.com'
            AND lower(name) IN ('ada', 'ada chen', 'ada@example.com'))
          OR (lower(email) = 'updates@example.com'
            AND lower(name) IN ('product robot', 'updates@example.com'))
          OR (lower(email) = 'security@example.com'
            AND lower(name) IN ('security team', 'security@example.com'))
          OR (lower(email) = 'demo@better-email.local'
            AND lower(name) IN ('better email demo', 'demo@better-email.local'))
          OR (lower(email) = 'demo@swiftmail.local'
            AND lower(name) = lower(email)))
        ",
        params![demo_account_id],
    )?;

    Ok(())
}

#[cfg(test)]
#[path = "db/core_tests.rs"]
mod tests;
