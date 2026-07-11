use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, Attachment, BackgroundTask,
    BackgroundTaskInput, CacheClearResult, Contact, ContactCreateInput, ContactInput,
    ContactMergeSuggestion, DraftInput, Folder, ImapFlagSnapshot, ImapFolderProbe, ImapHeaderBatch,
    ImapMailboxState, ImapReconcileResult, Label, LocalBackup, LocalBackupRow, LocalBackupSummary,
    MailIdentity, MailIdentityInput, MailRule, MailRuleInput, MailStats, Message,
    MessageThreadingInput, OAuthCallbackReport, OAuthSession, OAuthStartReport,
    OAuthTokenExchangeReport, OutboundAttachmentInput, OutboundMessage, OutboxItem,
    RemoteImageTrust, RemoteImageTrustInput, RemoteMessageBody, StorageUsage, SyncRun,
    SyncSchedulePlan, ThreadSummary,
};
use crate::protocol;
use chrono::{DateTime, Duration, Utc};
use rusqlite::{
    params, params_from_iter,
    types::{Value, ValueRef},
    Connection, OptionalExtension,
};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MailError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("application data directory is unavailable")]
    MissingDataDir,
    #[error("folder role not found: {0}")]
    MissingFolderRole(String),
    #[error("{0}")]
    Smtp(String),
    #[error("{0}")]
    Imap(String),
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
type AttachmentStorageIndex = (BTreeSet<PathBuf>, Vec<(i64, PathBuf)>);

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
const DATABASE_FILENAME: &str = "better-email.sqlite3";
const LEGACY_DATABASE_FILENAME: &str = "swiftmail.sqlite3";
const LEGACY_APP_IDENTIFIER: &str = "app.swiftmail.client";
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

pub struct MailStore {
    conn: Mutex<Connection>,
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
        let data_dir = path
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        fs::create_dir_all(&data_dir)?;
        let should_seed_demo_data = !path.exists();
        let conn = Connection::open(&path)?;
        let store = Self {
            conn: Mutex::new(conn),
            data_dir,
            database_path: path,
        };
        store.migrate()?;
        store.seed_if_empty(should_seed_demo_data)?;
        Ok(store)
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> MailResult<T>) -> MailResult<T> {
        let conn = self.conn.lock().expect("mail store mutex poisoned");
        f(&conn)
    }

    fn migrate(&self) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    display_name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    imap_host TEXT NOT NULL DEFAULT '',
                    smtp_host TEXT NOT NULL DEFAULT '',
                    incoming_protocol TEXT NOT NULL DEFAULT 'imap',
                    auth_type TEXT NOT NULL DEFAULT 'password',
                    sync_mode TEXT NOT NULL DEFAULT 'manual',
                    remote_images_allowed INTEGER NOT NULL DEFAULT 0,
                    signature TEXT NOT NULL DEFAULT '',
                    is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS folders (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    role TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(account_id, role)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                    sender_name TEXT NOT NULL,
                    sender_email TEXT NOT NULL,
                    recipients TEXT NOT NULL,
                    cc TEXT NOT NULL DEFAULT '',
                    bcc TEXT NOT NULL DEFAULT '',
                    subject TEXT NOT NULL,
                    snippet TEXT NOT NULL,
                    body TEXT NOT NULL,
                    sanitized_html TEXT NOT NULL DEFAULT '',
                    security_warnings TEXT NOT NULL DEFAULT '',
                    received_at TEXT NOT NULL,
                    is_read INTEGER NOT NULL DEFAULT 0,
                    is_starred INTEGER NOT NULL DEFAULT 0,
                    has_attachments INTEGER NOT NULL DEFAULT 0,
                    snoozed_until TEXT NOT NULL DEFAULT '',
                    thread_key TEXT NOT NULL DEFAULT '',
                    remote_mailbox TEXT NOT NULL DEFAULT '',
                    remote_uid INTEGER NOT NULL DEFAULT 0,
                    message_id_header TEXT NOT NULL DEFAULT '',
                    in_reply_to_header TEXT NOT NULL DEFAULT '',
                    references_header TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS mail_identities (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    reply_to TEXT NOT NULL DEFAULT '',
                    signature TEXT NOT NULL DEFAULT '',
                    is_default INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    UNIQUE(account_id, email)
                );

                CREATE TABLE IF NOT EXISTS labels (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS message_labels (
                    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
                    PRIMARY KEY (message_id, label_id)
                );

                CREATE TABLE IF NOT EXISTS muted_threads (
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    thread_key TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (account_id, thread_key)
                );

                CREATE TABLE IF NOT EXISTS attachments (
                    id INTEGER PRIMARY KEY,
                    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    is_downloaded INTEGER NOT NULL DEFAULT 0,
                    local_path TEXT NOT NULL DEFAULT '',
                    content_id TEXT NOT NULL DEFAULT '',
                    is_inline INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS remote_image_trusts (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    scope TEXT NOT NULL,
                    value TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(account_id, scope, value)
                );

                CREATE TABLE IF NOT EXISTS sync_runs (
                    id INTEGER PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    scanned_folders INTEGER NOT NULL,
                    imported_messages INTEGER NOT NULL,
                    message TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    aliases TEXT NOT NULL DEFAULT '',
                    vip INTEGER NOT NULL DEFAULT 0,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    last_seen_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS mail_rules (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    condition TEXT NOT NULL,
                    action TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS outbox_queue (
                    id INTEGER PRIMARY KEY,
                    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    queued_at TEXT NOT NULL,
                    next_attempt_at TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS background_tasks (
                    id INTEGER PRIMARY KEY,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    source TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS imap_mailboxes (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    remote_name TEXT NOT NULL,
                    delimiter TEXT NOT NULL DEFAULT '',
                    attributes TEXT NOT NULL DEFAULT '',
                    local_role TEXT NOT NULL DEFAULT 'custom',
                    local_folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
                    uid_validity TEXT NOT NULL DEFAULT '',
                    highest_uid INTEGER NOT NULL DEFAULT 0,
                    lowest_uid INTEGER NOT NULL DEFAULT 0,
                    history_complete INTEGER NOT NULL DEFAULT 0,
                    history_last_sync_at TEXT NOT NULL DEFAULT '',
                    last_seen_at TEXT NOT NULL,
                    last_sync_at TEXT NOT NULL DEFAULT '',
                    UNIQUE(account_id, remote_name)
                );

                CREATE TABLE IF NOT EXISTS oauth_sessions (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    provider TEXT NOT NULL,
                    authorization_url TEXT NOT NULL,
                    redirect_uri TEXT NOT NULL,
                    state TEXT NOT NULL UNIQUE,
                    code_challenge TEXT NOT NULL,
                    code_verifier TEXT NOT NULL,
                    scopes TEXT NOT NULL,
                    authorization_code TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL DEFAULT '',
                    message TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_messages_folder_time ON messages(folder_id, received_at DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(folder_id, is_read);
                CREATE INDEX IF NOT EXISTS idx_muted_threads_key ON muted_threads(thread_key);
                CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels(label_id);
                CREATE INDEX IF NOT EXISTS idx_mail_identities_account ON mail_identities(account_id, is_default DESC);
                CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
                CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
                CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_queue(status);
                CREATE INDEX IF NOT EXISTS idx_background_tasks_status_created ON background_tasks(status, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_imap_mailboxes_account ON imap_mailboxes(account_id, local_role);
                CREATE INDEX IF NOT EXISTS idx_oauth_sessions_account_status ON oauth_sessions(account_id, status, created_at DESC);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_remote_uid
                    ON messages(account_id, remote_mailbox, remote_uid)
                    WHERE remote_uid > 0;

                CREATE VIRTUAL TABLE IF NOT EXISTS message_search USING fts5(
                    subject, sender_name, sender_email, recipients, snippet, body,
                    content='messages', content_rowid='id'
                );

                CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                    INSERT INTO message_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES (new.id, new.subject, new.sender_name, new.sender_email, new.recipients, new.snippet, new.body);
                END;
                CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                    INSERT INTO message_search(message_search, rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES('delete', old.id, old.subject, old.sender_name, old.sender_email, old.recipients, old.snippet, old.body);
                END;
                CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
                    INSERT INTO message_search(message_search, rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES('delete', old.id, old.subject, old.sender_name, old.sender_email, old.recipients, old.snippet, old.body);
                    INSERT INTO message_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES (new.id, new.subject, new.sender_name, new.sender_email, new.recipients, new.snippet, new.body);
                END;
                ",
            )?;

            add_column_if_missing(conn, "accounts", "imap_host", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "accounts", "smtp_host", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(
                conn,
                "accounts",
                "incoming_protocol",
                "TEXT NOT NULL DEFAULT 'imap'",
            )?;
            add_column_if_missing(conn, "accounts", "auth_type", "TEXT NOT NULL DEFAULT 'password'")?;
            add_column_if_missing(conn, "accounts", "sync_mode", "TEXT NOT NULL DEFAULT 'manual'")?;
            add_column_if_missing(
                conn,
                "accounts",
                "remote_images_allowed",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(conn, "accounts", "signature", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(
                conn,
                "accounts",
                "is_default",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            ensure_default_account_for_conn(conn)?;
            conn.execute_batch(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_single_default
                 ON accounts(is_default) WHERE is_default = 1;",
            )?;
            add_column_if_missing(conn, "messages", "cc", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "messages", "bcc", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(
                conn,
                "messages",
                "sanitized_html",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "messages",
                "security_warnings",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "oauth_sessions",
                "authorization_code",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(conn, "messages", "remote_mailbox", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "messages", "remote_uid", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_missing(
                conn,
                "messages",
                "message_id_header",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "messages",
                "in_reply_to_header",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "messages",
                "references_header",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(conn, "messages", "snoozed_until", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "mail_identities", "reply_to", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "mail_identities", "signature", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(
                conn,
                "mail_identities",
                "is_default",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "attachments",
                "local_path",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "attachments",
                "content_id",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "attachments",
                "is_inline",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "outbox_queue",
                "next_attempt_at",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(conn, "contacts", "aliases", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(conn, "contacts", "vip", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_missing(
                conn,
                "imap_mailboxes",
                "local_folder_id",
                "INTEGER REFERENCES folders(id) ON DELETE SET NULL",
            )?;
            add_column_if_missing(
                conn,
                "imap_mailboxes",
                "lowest_uid",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "imap_mailboxes",
                "history_complete",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "imap_mailboxes",
                "history_last_sync_at",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            conn.execute(
                "
                UPDATE imap_mailboxes
                SET lowest_uid = COALESCE(
                    (
                        SELECT MIN(messages.remote_uid)
                        FROM messages
                        WHERE messages.account_id = imap_mailboxes.account_id
                          AND messages.remote_mailbox = imap_mailboxes.remote_name
                          AND messages.remote_uid > 0
                    ),
                    highest_uid
                )
                WHERE lowest_uid <= 0
                  AND highest_uid > 0
                ",
                [],
            )?;
            migrate_thread_keys_if_needed(conn)?;
            ensure_default_identities_for_conn(conn)?;
            Ok(())
        })
    }

    fn seed_if_empty(&self, should_seed_demo_data: bool) -> MailResult<()> {
        if !should_seed_demo_data {
            return Ok(());
        }
        self.with_conn(|conn| {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))?;
            if count > 0 {
                return Ok(());
            }

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
                    "安全默认值很重要：凭据进入系统 Keychain，HTML 邮件必须清洗，远程图片默认阻止，日志自动脱敏。",
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
                upsert_contact(conn, sender_name, sender_email, &received_at.to_rfc3339())?;
            }
            Ok(())
        })
    }

    pub fn export_local_backup(&self) -> MailResult<LocalBackup> {
        self.with_conn(|conn| {
            let mut tables = BTreeMap::new();
            for table in LOCAL_BACKUP_TABLES {
                tables.insert((*table).to_string(), export_backup_table(conn, table)?);
            }
            Ok(LocalBackup {
                schema_version: LOCAL_BACKUP_SCHEMA_VERSION,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                exported_at: Utc::now().to_rfc3339(),
                tables,
            })
        })
    }

    pub fn import_local_backup(&self, backup: &LocalBackup) -> MailResult<()> {
        validate_local_backup(backup)?;
        self.with_conn(|conn| {
            let result = (|| -> MailResult<()> {
                conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;")?;
                for table in LOCAL_BACKUP_TABLES.iter().rev() {
                    conn.execute(&format!("DELETE FROM {}", quote_identifier(table)), [])?;
                }
                for table in LOCAL_BACKUP_TABLES {
                    if let Some(rows) = backup.tables.get(*table) {
                        import_backup_table(conn, table, rows)?;
                    }
                }
                ensure_default_account_for_conn(conn)?;
                let foreign_key_violations: i64 =
                    conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                        row.get(0)
                    })?;
                if foreign_key_violations > 0 {
                    return Err(MailError::Imap(format!(
                        "备份恢复失败：检测到 {foreign_key_violations} 个外键不一致项。"
                    )));
                }
                conn.execute_batch(
                    "INSERT INTO message_search(message_search) VALUES('rebuild'); COMMIT;",
                )?;
                Ok(())
            })();

            if result.is_err() {
                let _ = conn.execute_batch("ROLLBACK;");
            }
            let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
            result?;
            rebuild_thread_keys_for_conn(conn)
        })
    }

    pub fn summarize_local_backup(
        backup: &LocalBackup,
        path: String,
        size_bytes: i64,
    ) -> LocalBackupSummary {
        LocalBackupSummary {
            path,
            exported_at: backup.exported_at.clone(),
            app_version: backup.app_version.clone(),
            schema_version: backup.schema_version,
            accounts: backup_table_count(backup, "accounts"),
            messages: backup_table_count(backup, "messages"),
            labels: backup_table_count(backup, "labels"),
            rules: backup_table_count(backup, "mail_rules"),
            outbox_items: backup_table_count(backup, "outbox_queue"),
            size_bytes,
            credentials_included: false,
        }
    }

    pub fn list_accounts(&self) -> MailResult<Vec<Account>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, is_default
                 FROM accounts ORDER BY is_default DESC, id",
            )?;
            let accounts = stmt
                .query_map([], map_account)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(accounts)
        })
    }

    pub fn get_account(&self) -> MailResult<Account> {
        self.get_account_by_id(None)
    }

    pub fn get_account_by_id(&self, account_id: Option<i64>) -> MailResult<Account> {
        self.with_conn(|conn| account_for_conn(conn, account_id))
    }

    pub fn get_account_by_id_optional(&self, account_id: Option<i64>) -> MailResult<Option<Account>> {
        self.with_conn(|conn| account_for_conn_optional(conn, account_id))
    }

    pub fn create_account(&self, input: AccountCreateInput) -> MailResult<Account> {
        self.with_conn(|conn| {
            let email = input.email.trim().to_lowercase();
            if email.is_empty() || !email.contains('@') {
                return Err(MailError::Imap("请输入有效邮箱地址。".to_string()));
            }
            let display_name = if input.display_name.trim().is_empty() {
                email.clone()
            } else {
                input.display_name.trim().to_string()
            };
            let is_default =
                conn.query_row("SELECT COUNT(*) = 0 FROM accounts", [], |row| row.get::<_, bool>(0))?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO accounts(email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, is_default, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    email,
                    display_name,
                    input.provider.trim(),
                    input.imap_host.trim(),
                    input.smtp_host.trim(),
                    normalize_incoming_protocol(&input.incoming_protocol),
                    normalize_auth_type(&input.auth_type),
                    normalize_sync_mode(&input.sync_mode),
                    bool_to_int(input.remote_images_allowed),
                    input.signature,
                    bool_to_int(is_default),
                    now
                ],
            )
            .map_err(|error| {
                if is_unique_constraint_error(&error) {
                    MailError::Imap("该邮箱账号已存在。".to_string())
                } else {
                    MailError::Database(error)
                }
            })?;
            let account_id = conn.last_insert_rowid();
            create_default_folders_for_account(conn, account_id)?;
            ensure_default_identity_for_account_conn(
                conn,
                account_id,
                &display_name,
                &email,
                &input.signature,
            )?;
            account_for_conn(conn, Some(account_id))
        })
    }

    pub fn set_default_account(&self, account_id: i64) -> MailResult<Account> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM accounts WHERE id = ?1",
                    params![account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(MailError::Imap("邮箱账号不存在或已被移除。".to_string()));
            }
            transaction.execute("UPDATE accounts SET is_default = 0", [])?;
            transaction.execute(
                "UPDATE accounts SET is_default = 1 WHERE id = ?1",
                params![account_id],
            )?;
            let account = account_for_conn(&transaction, Some(account_id))?;
            transaction.commit()?;
            Ok(account)
        })
    }

    pub fn delete_account(&self, account_id: i64) -> MailResult<Option<Account>> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM accounts WHERE id = ?1",
                    params![account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(MailError::Imap("邮箱账号不存在或已被移除。".to_string()));
            }

            transaction.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])?;
            ensure_default_account_for_conn(&transaction)?;
            let next_account = account_for_conn_optional(&transaction, None)?;
            transaction.commit()?;
            Ok(next_account)
        })
    }

    pub fn update_account_settings_for(
        &self,
        account_id: Option<i64>,
        input: AccountSettingsInput,
    ) -> MailResult<Account> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            conn.execute(
                "UPDATE accounts
                 SET display_name = ?1, provider = ?2, imap_host = ?3, smtp_host = ?4,
                     incoming_protocol = ?5, auth_type = ?6, sync_mode = ?7, remote_images_allowed = ?8, signature = ?9
                 WHERE id = ?10",
                params![
                    input.display_name.trim(),
                    input.provider.trim(),
                    input.imap_host.trim(),
                    input.smtp_host.trim(),
                    normalize_incoming_protocol(&input.incoming_protocol),
                    normalize_auth_type(&input.auth_type),
                    normalize_sync_mode(&input.sync_mode),
                    bool_to_int(input.remote_images_allowed),
                    input.signature,
                    account.id
                ],
            )?;
            upsert_account_default_identity_conn(
                conn,
                account.id,
                input.display_name.trim(),
                &account.email,
                &input.signature,
            )?;
            account_for_conn(conn, Some(account.id))
        })
    }

    pub fn list_identities_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<MailIdentity>> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            identities_for_account_conn(conn, account.id)
        })
    }

    pub fn upsert_identity(&self, input: MailIdentityInput) -> MailResult<MailIdentity> {
        self.with_conn(|conn| {
            let account =
                account_for_conn(conn, (input.account_id > 0).then_some(input.account_id))?;
            upsert_identity_conn(conn, &account, input)
        })
    }

    pub fn delete_identity(&self, identity_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let is_default: i64 = conn.query_row(
                "SELECT is_default FROM mail_identities WHERE id = ?1",
                params![identity_id],
                |row| row.get(0),
            )?;
            if is_default != 0 {
                return Err(MailError::Imap("默认发件身份不能删除。".to_string()));
            }
            conn.execute(
                "DELETE FROM mail_identities WHERE id = ?1",
                params![identity_id],
            )?;
            Ok(())
        })
    }

    pub fn list_folders_for_account(&self, account_id: Option<i64>) -> MailResult<Vec<Folder>> {
        self.with_conn(|conn| {
            if let Some(account_id) = account_id {
                let mut stmt = conn.prepare(
                    "
                    SELECT f.id, f.account_id, f.name, f.role,
                        COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
                    FROM folders f
                    LEFT JOIN messages m ON m.folder_id = f.id
                    WHERE f.account_id = ?1
                    GROUP BY f.id, f.account_id, f.name, f.role, f.sort_order
                    ORDER BY f.sort_order ASC
                    ",
                )?;
                let folders = stmt
                    .query_map(params![account_id], |row| {
                        Ok(Folder {
                            id: row.get(0)?,
                            account_id: Some(row.get(1)?),
                            name: row.get(2)?,
                            role: row.get(3)?,
                            unread_count: row.get(4)?,
                            is_virtual: false,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                return Ok(folders);
            }

            let mut stmt = conn.prepare(
                "
                SELECT f.role, MIN(f.sort_order) AS sort_order,
                    COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
                FROM folders f
                LEFT JOIN messages m ON m.folder_id = f.id
                WHERE f.role NOT LIKE 'custom:%'
                GROUP BY f.role
                ORDER BY sort_order ASC
                ",
            )?;
            let mut folders = stmt
                .query_map([], |row| {
                    let role: String = row.get(0)?;
                    Ok(Folder {
                        id: virtual_folder_id(&role),
                        account_id: None,
                        name: folder_name_for_role(&role).to_string(),
                        role,
                        unread_count: row.get(2)?,
                        is_virtual: true,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut custom_stmt = conn.prepare(
                "
                SELECT f.id, f.account_id, f.name, f.role,
                    COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
                FROM folders f
                LEFT JOIN messages m ON m.folder_id = f.id
                WHERE f.role LIKE 'custom:%'
                GROUP BY f.id, f.account_id, f.name, f.role, f.sort_order
                ORDER BY f.sort_order ASC, f.name ASC
                ",
            )?;
            let custom_folders = custom_stmt
                .query_map([], |row| {
                    Ok(Folder {
                        id: row.get(0)?,
                        account_id: Some(row.get(1)?),
                        name: row.get(2)?,
                        role: row.get(3)?,
                        unread_count: row.get(4)?,
                        is_virtual: false,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            folders.extend(custom_folders);
            Ok(folders)
        })
    }

    pub fn create_custom_folder(
        &self,
        account_id: Option<i64>,
        name: String,
    ) -> MailResult<Folder> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            let name = normalized_custom_folder_name(&name)?;
            ensure_custom_folder_name_available(conn, account.id, &name, None)?;
            let sort_order: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_order), 60) + 1 FROM folders WHERE account_id = ?1",
                params![account.id],
                |row| row.get(0),
            )?;
            let role = format!("custom:{}", Utc::now().timestamp_micros());
            conn.execute(
                "INSERT INTO folders(account_id, name, role, sort_order) VALUES (?1, ?2, ?3, ?4)",
                params![account.id, name, role, sort_order],
            )?;
            folder_for_conn(conn, conn.last_insert_rowid())
        })
    }

    pub fn rename_custom_folder(&self, folder_id: i64, name: String) -> MailResult<Folder> {
        self.with_conn(|conn| {
            let folder = folder_for_conn(conn, folder_id)?;
            if !is_custom_folder_role(&folder.role) {
                return Err(MailError::Imap(
                    "只能重命名自定义文件夹，系统文件夹不可重命名。".to_string(),
                ));
            }
            let account_id = folder
                .account_id
                .ok_or_else(|| MailError::MissingFolderRole(folder.role.clone()))?;
            let name = normalized_custom_folder_name(&name)?;
            ensure_custom_folder_name_available(conn, account_id, &name, Some(folder.id))?;
            conn.execute(
                "UPDATE folders SET name = ?1 WHERE id = ?2",
                params![name, folder_id],
            )?;
            folder_for_conn(conn, folder_id)
        })
    }

    pub fn delete_custom_folder(&self, folder_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let folder = folder_for_conn(conn, folder_id)?;
            if !is_custom_folder_role(&folder.role) {
                return Err(MailError::Imap(
                    "只能删除自定义文件夹，系统文件夹不可删除。".to_string(),
                ));
            }
            let account_id = folder
                .account_id
                .ok_or_else(|| MailError::MissingFolderRole(folder.role.clone()))?;
            let inbox_id = folder_id_for_account_role(conn, account_id, "inbox")?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE folder_id = ?2",
                params![inbox_id, folder_id],
            )?;
            conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])?;
            Ok(())
        })
    }

    pub fn list_labels(&self) -> MailResult<Vec<Label>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT l.id, l.name, l.color, COUNT(ml.message_id) AS message_count
                FROM labels l
                LEFT JOIN message_labels ml ON ml.label_id = l.id
                GROUP BY l.id, l.name, l.color
                ORDER BY l.name
                ",
            )?;
            let labels = stmt
                .query_map([], |row| {
                    Ok(Label {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        color: row.get(2)?,
                        message_count: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(labels)
        })
    }

    #[allow(dead_code)]
    pub fn list_messages_for_scope(
        &self,
        account_id: Option<i64>,
        folder_id: i64,
        query: Option<String>,
        filter: Option<String>,
        limit: i64,
    ) -> MailResult<Vec<Message>> {
        self.list_messages_for_scope_sorted(account_id, folder_id, query, filter, None, limit)
    }

    pub fn list_messages_for_scope_sorted(
        &self,
        account_id: Option<i64>,
        folder_id: i64,
        query: Option<String>,
        filter: Option<String>,
        sort: Option<String>,
        limit: i64,
    ) -> MailResult<Vec<Message>> {
        self.with_conn(|conn| {
            let limit = limit.clamp(1, 200);
            let search = query
                .map(|q| q.trim().to_string())
                .filter(|q| !q.is_empty());
            let filter = filter
                .map(|q| q.trim().to_string())
                .filter(|q| !q.is_empty())
                .unwrap_or_else(|| "all".to_string());

            let search_criteria = SearchCriteria::parse(search.as_deref());
            let mut scope_conditions = Vec::new();
            let mut query_params = Vec::new();
            if folder_id > 0 {
                scope_conditions.push("m.folder_id = ?".to_string());
                query_params.push(Value::Integer(folder_id));
            } else if folder_id < 0 {
                let role = role_for_virtual_folder_id(folder_id)
                    .ok_or_else(|| MailError::MissingFolderRole(folder_id.to_string()))?;
                scope_conditions.push("f.role = ?".to_string());
                query_params.push(Value::Text(role.to_string()));
            }
            if let Some(account_id) = account_id {
                scope_conditions.push("m.account_id = ?".to_string());
                query_params.push(Value::Integer(account_id));
            }
            let sql = build_message_query(
                &search_criteria,
                &filter,
                &scope_conditions.join(" AND "),
                sort.as_deref(),
            );
            query_params.extend(search_criteria.params().into_iter().map(Value::Text));
            query_params.push(Value::Integer(limit));
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params_from_iter(query_params), |row| {
                    let message_id: i64 = row.get(0)?;
                    Ok(Message {
                        id: message_id,
                        account_id: row.get(1)?,
                        account_email: row.get(2)?,
                        folder_id: row.get(3)?,
                        folder_role: row.get(4)?,
                        sender_name: row.get(5)?,
                        sender_email: row.get(6)?,
                        recipients: row.get(7)?,
                        cc: row.get(8)?,
                        bcc: row.get(9)?,
                        subject: row.get(10)?,
                        snippet: row.get(11)?,
                        body: row.get(12)?,
                        sanitized_html: row.get(13)?,
                        security_warnings: warning_lines_from_text(row.get(14)?),
                        received_at: row.get(15)?,
                        is_read: row.get::<_, i64>(16)? != 0,
                        is_starred: row.get::<_, i64>(17)? != 0,
                        has_attachments: row.get::<_, i64>(18)? != 0,
                        snoozed_until: row.get(19)?,
                        labels: labels_for_message(conn, message_id)?,
                        attachment_count: attachment_count_for_message(conn, message_id)?,
                        remote_mailbox: row.get(20)?,
                        remote_uid: row.get(21)?,
                        message_id_header: row.get(22)?,
                        in_reply_to_header: row.get(23)?,
                        references_header: row.get(24)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn list_provider_write_validation_messages(
        &self,
        account_id: i64,
        validation_id: String,
    ) -> MailResult<Vec<Message>> {
        self.with_conn(|conn| {
            let validation_id = validation_id.trim();
            if validation_id.is_empty() {
                return Ok(Vec::new());
            }
            let mut stmt = conn.prepare(
                "
                SELECT id
                FROM messages
                WHERE account_id = ?1
                  AND instr(lower(subject), lower(?2)) > 0
                ORDER BY received_at DESC, id DESC
                LIMIT 20
                ",
            )?;
            let message_ids = stmt
                .query_map(params![account_id, validation_id], |row| row.get(0))?
                .collect::<Result<Vec<i64>, _>>()?;
            message_ids
                .into_iter()
                .map(|message_id| message_for_conn(conn, message_id))
                .collect()
        })
    }

    pub fn list_thread_messages(
        &self,
        account_id: Option<i64>,
        thread_key: String,
        limit: i64,
    ) -> MailResult<Vec<Message>> {
        self.with_conn(|conn| {
            let limit = limit.clamp(1, 200);
            let mut scope_conditions = vec!["m.thread_key = ?".to_string()];
            let mut query_params = vec![Value::Text(thread_key.trim().to_string())];
            if let Some(account_id) = account_id {
                scope_conditions.push("m.account_id = ?".to_string());
                query_params.push(Value::Integer(account_id));
            }
            query_params.push(Value::Integer(limit));
            let sql = format!(
                "
                SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
                       m.cc, m.bcc, m.subject, m.snippet, m.body, m.sanitized_html, m.security_warnings,
                       m.received_at, m.is_read, m.is_starred, m.has_attachments,
                       m.snoozed_until, m.remote_mailbox, m.remote_uid,
                       m.message_id_header, m.in_reply_to_header, m.references_header
                FROM messages m
                JOIN accounts a ON a.id = m.account_id
                JOIN folders f ON f.id = m.folder_id
                WHERE {}
                ORDER BY m.received_at ASC
                LIMIT ?
                ",
                scope_conditions.join(" AND "),
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params_from_iter(query_params), |row| {
                    let message_id: i64 = row.get(0)?;
                    Ok(Message {
                        id: message_id,
                        account_id: row.get(1)?,
                        account_email: row.get(2)?,
                        folder_id: row.get(3)?,
                        folder_role: row.get(4)?,
                        sender_name: row.get(5)?,
                        sender_email: row.get(6)?,
                        recipients: row.get(7)?,
                        cc: row.get(8)?,
                        bcc: row.get(9)?,
                        subject: row.get(10)?,
                        snippet: row.get(11)?,
                        body: row.get(12)?,
                        sanitized_html: row.get(13)?,
                        security_warnings: warning_lines_from_text(row.get(14)?),
                        received_at: row.get(15)?,
                        is_read: row.get::<_, i64>(16)? != 0,
                        is_starred: row.get::<_, i64>(17)? != 0,
                        has_attachments: row.get::<_, i64>(18)? != 0,
                        snoozed_until: row.get(19)?,
                        labels: labels_for_message(conn, message_id)?,
                        attachment_count: attachment_count_for_message(conn, message_id)?,
                        remote_mailbox: row.get(20)?,
                        remote_uid: row.get(21)?,
                        message_id_header: row.get(22)?,
                        in_reply_to_header: row.get(23)?,
                        references_header: row.get(24)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }

    pub fn get_message_remote_ref(&self, message_id: i64) -> MailResult<(String, i64)> {
        let reference = self.get_message_remote_reference(message_id)?;
        Ok((reference.remote_mailbox, reference.remote_uid))
    }

    pub fn get_message_remote_reference(&self, message_id: i64) -> MailResult<MessageRemoteRef> {
        self.with_conn(|conn| message_remote_ref_for_conn(conn, message_id))
    }

    pub fn set_message_remote_ref(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE messages
                SET remote_mailbox = ?2, remote_uid = ?3
                WHERE id = ?1
                ",
                params![message_id, remote_mailbox.trim(), remote_uid.max(0)],
            )?;
            Ok(())
        })
    }

    pub fn set_message_remote_identity(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
        message_id_header: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let (subject, in_reply_to, references): (String, String, String) = conn.query_row(
                "
                SELECT subject, in_reply_to_header, references_header
                FROM messages
                WHERE id = ?1
                ",
                params![message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            let thread_key =
                thread_key_for_message(&subject, message_id_header, &in_reply_to, &references);
            conn.execute(
                "
                UPDATE messages
                SET remote_mailbox = ?2,
                    remote_uid = ?3,
                    message_id_header = ?4,
                    thread_key = ?5
                WHERE id = ?1
                ",
                params![
                    message_id,
                    remote_mailbox.trim(),
                    remote_uid.max(0),
                    message_id_header.trim(),
                    thread_key
                ],
            )?;
            Ok(())
        })
    }

    pub fn set_message_threading(
        &self,
        message_id: i64,
        threading: Option<MessageThreadingInput>,
    ) -> MailResult<()> {
        let Some(threading) = threading else {
            return Ok(());
        };
        let in_reply_to = normalize_thread_header_value(&threading.in_reply_to);
        let references = normalize_thread_header_value(&threading.references);
        self.with_conn(|conn| {
            let (subject, message_id_header): (String, String) = conn.query_row(
                "SELECT subject, message_id_header FROM messages WHERE id = ?1",
                params![message_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let thread_key =
                thread_key_for_message(&subject, &message_id_header, &in_reply_to, &references);
            conn.execute(
                "
                UPDATE messages
                SET in_reply_to_header = ?2,
                    references_header = ?3,
                    thread_key = ?4
                WHERE id = ?1
                ",
                params![message_id, in_reply_to, references, thread_key],
            )?;
            Ok(())
        })
    }

    pub fn get_message(&self, message_id: i64) -> MailResult<Message> {
        self.with_conn(|conn| message_for_conn(conn, message_id))
    }

    pub fn get_outbound_message(&self, message_id: i64) -> MailResult<OutboundMessage> {
        self.with_conn(|conn| outbound_message_for_conn(conn, message_id))
    }

    pub fn get_message_account(&self, message_id: i64) -> MailResult<Account> {
        self.with_conn(|conn| {
            conn.query_row(
                "
                SELECT a.id, a.email, a.display_name, a.provider, a.imap_host, a.smtp_host,
                       a.incoming_protocol, a.auth_type, a.sync_mode, a.remote_images_allowed,
                       a.signature, a.is_default
                FROM messages m
                JOIN accounts a ON a.id = m.account_id
                WHERE m.id = ?1
                ",
                params![message_id],
                map_account,
            )
            .map_err(Into::into)
        })
    }

    pub fn list_remote_image_trusts(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<RemoteImageTrust>> {
        self.with_conn(|conn| {
            let mut sql = String::from(
                "
                SELECT t.id, t.account_id, a.email, t.scope, t.value, t.created_at
                FROM remote_image_trusts t
                JOIN accounts a ON a.id = t.account_id
                ",
            );
            let trusts = if let Some(account_id) = account_id {
                sql.push_str("WHERE t.account_id = ?1 ORDER BY t.scope, t.value");
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt
                    .query_map(params![account_id], map_remote_image_trust)?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            } else {
                sql.push_str("ORDER BY a.email, t.scope, t.value");
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt
                    .query_map([], map_remote_image_trust)?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            Ok(trusts)
        })
    }

    pub fn upsert_remote_image_trust(
        &self,
        input: RemoteImageTrustInput,
    ) -> MailResult<RemoteImageTrust> {
        self.with_conn(|conn| {
            let scope = normalize_remote_image_trust_scope(&input.scope)?;
            let value = normalize_remote_image_trust_value(&scope, &input.value)?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "
                INSERT INTO remote_image_trusts(account_id, scope, value, created_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(account_id, scope, value) DO UPDATE SET created_at = created_at
                ",
                params![input.account_id, scope, value, now],
            )?;
            conn.query_row(
                "
                SELECT t.id, t.account_id, a.email, t.scope, t.value, t.created_at
                FROM remote_image_trusts t
                JOIN accounts a ON a.id = t.account_id
                WHERE t.account_id = ?1 AND t.scope = ?2 AND t.value = ?3
                ",
                params![input.account_id, scope, value],
                map_remote_image_trust,
            )
            .map_err(Into::into)
        })
    }

    pub fn delete_remote_image_trust(&self, trust_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM remote_image_trusts WHERE id = ?1",
                params![trust_id],
            )?;
            Ok(())
        })
    }

    pub fn message_with_remote_image_policy(&self, message_id: i64) -> MailResult<Message> {
        self.with_conn(|conn| {
            let mut message = message_for_conn(conn, message_id)?;
            if !should_allow_remote_images_for_message(conn, &message)? {
                return Ok(message);
            }
            if !looks_like_html_fragment(&message.body) {
                return Ok(message);
            }
            message.sanitized_html =
                crate::protocol::sanitize_html_with_remote_images(&message.body);
            message
                .security_warnings
                .retain(|warning| !warning.contains("远程图片"));
            Ok(message)
        })
    }

    pub fn update_message_body(
        &self,
        message_id: i64,
        body: &RemoteMessageBody,
    ) -> MailResult<Message> {
        self.with_conn(|conn| {
            let has_attachments = body.has_attachments || !body.attachments.is_empty();
            conn.execute(
                "
                UPDATE messages
                SET body = ?2, sanitized_html = ?3, security_warnings = ?4, snippet = ?5, has_attachments = ?6
                WHERE id = ?1
                ",
                params![
                    message_id,
                    body.body,
                    body.sanitized_html,
                    warning_lines_to_text(&body.security_warnings),
                    body.snippet,
                    bool_to_int(has_attachments)
                ],
            )?;
            conn.execute(
                "DELETE FROM attachments WHERE message_id = ?1",
                params![message_id],
            )?;
            for attachment in &body.attachments {
                conn.execute(
                    "INSERT INTO attachments(
                        message_id, filename, mime_type, size_bytes, is_downloaded,
                        local_path, content_id, is_inline
                     )
                     VALUES (?1, ?2, ?3, ?4, 0, '', ?5, ?6)",
                    params![
                        message_id,
                        attachment.filename,
                        attachment.mime_type,
                        attachment.size_bytes,
                        attachment.content_id,
                        bool_to_int(attachment.is_inline)
                    ],
                )?;
            }
            message_for_conn(conn, message_id)
        })
    }

    pub fn import_eml_message(&self, account_id: Option<i64>, raw: &str) -> MailResult<Message> {
        let imported = protocol::parse_imported_eml(raw);
        let (message_id, attachments) = self.with_conn(move |conn| {
            let account = account_for_conn(conn, account_id)?;
            let folder_id = folder_id_for_account_role(conn, account.id, "inbox")?;
            let subject = normalized_subject(&imported.subject);
            let thread_key = thread_key_for_message(
                &subject,
                &imported.message_id_header,
                &imported.in_reply_to_header,
                &imported.references_header,
            );
            conn.execute(
                "
                INSERT INTO messages(
                    account_id, folder_id, sender_name, sender_email, recipients, cc, bcc,
                    subject, snippet, body, sanitized_html, security_warnings, received_at,
                    is_read, is_starred, has_attachments, thread_key, message_id_header,
                    in_reply_to_header, references_header
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, 0, ?14, ?15, ?16, ?17, ?18)
                ",
                params![
                    account.id,
                    folder_id,
                    imported.sender_name,
                    imported.sender_email,
                    imported.recipients,
                    imported.cc,
                    imported.bcc,
                    subject,
                    imported.snippet,
                    imported.body,
                    imported.sanitized_html,
                    warning_lines_to_text(&imported.security_warnings),
                    imported.received_at,
                    bool_to_int(!imported.attachments.is_empty()),
                    thread_key,
                    imported.message_id_header,
                    imported.in_reply_to_header,
                    imported.references_header
                ],
            )?;
            let message_id = conn.last_insert_rowid();
            let mut attachment_rows = Vec::with_capacity(imported.attachments.len());
            for attachment in imported.attachments {
                conn.execute(
                    "INSERT INTO attachments(
                        message_id, filename, mime_type, size_bytes, is_downloaded,
                        local_path, content_id, is_inline
                     )
                     VALUES (?1, ?2, ?3, ?4, 0, '', ?5, ?6)",
                    params![
                        message_id,
                        &attachment.filename,
                        fallback_mime_type(&attachment.mime_type),
                        attachment.bytes.len().min(i64::MAX as usize) as i64,
                        attachment.content_id,
                        bool_to_int(attachment.is_inline)
                    ],
                )?;
                attachment_rows.push((conn.last_insert_rowid(), attachment));
            }
            upsert_contact(
                conn,
                &imported.sender_name,
                &imported.sender_email,
                &imported.received_at,
            )?;
            Ok((message_id, attachment_rows))
        })?;

        if !attachments.is_empty() {
            let dir = self.attachment_dir(message_id);
            let persist_result = (|| -> MailResult<()> {
                fs::create_dir_all(&dir)?;
                for (attachment_id, attachment) in attachments {
                    let filename = safe_attachment_filename(&attachment.filename);
                    let local_path = dir.join(format!("{attachment_id}-{filename}"));
                    fs::write(&local_path, &attachment.bytes)?;
                    self.mark_attachment_downloaded(
                        attachment_id,
                        &local_path.to_string_lossy(),
                        attachment.bytes.len().min(i64::MAX as usize) as i64,
                    )?;
                }
                Ok(())
            })();
            if let Err(error) = persist_result {
                let _ = fs::remove_dir_all(&dir);
                let _ = self.delete_message_permanently(message_id);
                return Err(error);
            }
        }

        self.get_message(message_id)
    }

    pub fn import_pop3_messages(
        &self,
        account_id: i64,
        messages: &[crate::pop3_probe::Pop3Message],
    ) -> MailResult<i64> {
        let mut attachment_rows = Vec::new();
        let mut imported_count = 0;
        self.with_conn(|conn| {
            let folder_id = folder_id_for_account_role(conn, account_id, "inbox")?;
            for pop_message in messages {
                let imported = protocol::parse_imported_eml(&pop_message.raw);
                let subject = normalized_subject(&imported.subject);
                let thread_key = thread_key_for_message(
                    &subject,
                    &imported.message_id_header,
                    &imported.in_reply_to_header,
                    &imported.references_header,
                );
                let updated = conn.execute(
                    "
                    UPDATE messages
                    SET folder_id = ?1,
                        subject = ?2,
                        snippet = ?3,
                        body = ?4,
                        sanitized_html = ?5,
                        security_warnings = ?6,
                        received_at = ?7,
                        has_attachments = ?8,
                        thread_key = ?9,
                        message_id_header = ?10,
                        in_reply_to_header = ?11,
                        references_header = ?12
                    WHERE account_id = ?13
                      AND remote_mailbox = 'POP3/INBOX'
                      AND remote_uid = ?14
                    ",
                    params![
                        folder_id,
                        subject,
                        imported.snippet,
                        imported.body,
                        imported.sanitized_html,
                        warning_lines_to_text(&imported.security_warnings),
                        imported.received_at,
                        bool_to_int(!imported.attachments.is_empty()),
                        thread_key,
                        imported.message_id_header,
                        imported.in_reply_to_header,
                        imported.references_header,
                        account_id,
                        pop_message.remote_uid
                    ],
                )?;
                if updated > 0 {
                    continue;
                }

                let changed = conn.execute(
                    "
                    INSERT OR IGNORE INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients, cc, bcc,
                        subject, snippet, body, sanitized_html, security_warnings, received_at,
                        is_read, is_starred, has_attachments, thread_key, remote_mailbox,
                        remote_uid, message_id_header, in_reply_to_header, references_header
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                            0, 0, ?14, ?15, 'POP3/INBOX', ?16, ?17, ?18, ?19)
                    ",
                    params![
                        account_id,
                        folder_id,
                        imported.sender_name,
                        imported.sender_email,
                        imported.recipients,
                        imported.cc,
                        imported.bcc,
                        subject,
                        imported.snippet,
                        imported.body,
                        imported.sanitized_html,
                        warning_lines_to_text(&imported.security_warnings),
                        imported.received_at,
                        bool_to_int(!imported.attachments.is_empty()),
                        thread_key,
                        pop_message.remote_uid,
                        imported.message_id_header,
                        imported.in_reply_to_header,
                        imported.references_header
                    ],
                )?;
                if changed == 0 {
                    continue;
                }

                let message_id = conn.last_insert_rowid();
                for attachment in imported.attachments {
                    conn.execute(
                        "INSERT INTO attachments(
                            message_id, filename, mime_type, size_bytes, is_downloaded,
                            local_path, content_id, is_inline
                         )
                         VALUES (?1, ?2, ?3, ?4, 0, '', ?5, ?6)",
                        params![
                            message_id,
                            &attachment.filename,
                            fallback_mime_type(&attachment.mime_type),
                            attachment.bytes.len().min(i64::MAX as usize) as i64,
                            attachment.content_id,
                            bool_to_int(attachment.is_inline)
                        ],
                    )?;
                    attachment_rows.push((message_id, conn.last_insert_rowid(), attachment));
                }
                apply_enabled_rules_for_message(conn, message_id)?;
                upsert_contact(
                    conn,
                    &imported.sender_name,
                    &imported.sender_email,
                    &imported.received_at,
                )?;
                imported_count += 1;
            }
            Ok(())
        })?;

        for (message_id, attachment_id, attachment) in attachment_rows {
            let dir = self.attachment_dir(message_id);
            fs::create_dir_all(&dir)?;
            let filename = safe_attachment_filename(&attachment.filename);
            let local_path = dir.join(format!("{attachment_id}-{filename}"));
            fs::write(&local_path, &attachment.bytes)?;
            self.mark_attachment_downloaded(
                attachment_id,
                &local_path.to_string_lossy(),
                attachment.bytes.len().min(i64::MAX as usize) as i64,
            )?;
        }

        Ok(imported_count)
    }

    pub fn list_attachments(&self, message_id: i64) -> MailResult<Vec<Attachment>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
                        local_path, content_id, is_inline
                 FROM attachments WHERE message_id = ?1 ORDER BY filename",
            )?;
            let attachments = stmt
                .query_map(params![message_id], |row| {
                    Ok(Attachment {
                        id: row.get(0)?,
                        message_id: row.get(1)?,
                        filename: row.get(2)?,
                        mime_type: row.get(3)?,
                        size_bytes: row.get(4)?,
                        is_downloaded: row.get::<_, i64>(5)? != 0,
                        local_path: row.get(6)?,
                        content_id: row.get(7)?,
                        is_inline: row.get::<_, i64>(8)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(attachments)
        })
    }

    pub fn get_attachment(&self, attachment_id: i64) -> MailResult<Attachment> {
        self.with_conn(|conn| attachment_for_conn(conn, attachment_id))
    }

    pub fn mark_attachment_downloaded(
        &self,
        attachment_id: i64,
        local_path: &str,
        size_bytes: i64,
    ) -> MailResult<Attachment> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE attachments
                SET is_downloaded = 1, local_path = ?2, size_bytes = ?3
                WHERE id = ?1
                ",
                params![attachment_id, local_path, size_bytes],
            )?;
            attachment_for_conn(conn, attachment_id)
        })
    }

    pub fn attachment_dir(&self, message_id: i64) -> PathBuf {
        self.data_dir
            .join("attachments")
            .join(message_id.to_string())
    }

    pub fn storage_usage(&self) -> MailResult<StorageUsage> {
        let attachment_root = self.data_dir.join("attachments");
        let (protected_paths, reclaimable_rows) = self.attachment_storage_index()?;
        let mut reclaimable_cache_bytes = 0_i64;
        let mut reclaimable_file_count = 0_i64;
        let mut local_attachment_bytes = 0_i64;
        let mut local_attachment_file_count = 0_i64;
        let mut partial_download_bytes = 0_i64;
        let mut partial_download_count = 0_i64;

        for (path, size_bytes) in collect_regular_files(&attachment_root)? {
            if protected_paths.contains(&path) {
                local_attachment_bytes += size_bytes;
                local_attachment_file_count += 1;
                continue;
            }
            reclaimable_cache_bytes += size_bytes;
            reclaimable_file_count += 1;
            if is_partial_attachment_path(&path) {
                partial_download_bytes += size_bytes;
                partial_download_count += 1;
            }
        }

        let database_bytes = database_storage_bytes(&self.database_path);
        Ok(StorageUsage {
            database_bytes,
            reclaimable_cache_bytes,
            reclaimable_file_count,
            cached_attachment_count: reclaimable_rows.len().min(i64::MAX as usize) as i64,
            local_attachment_bytes,
            local_attachment_file_count,
            partial_download_bytes,
            partial_download_count,
            total_managed_bytes: database_bytes
                .saturating_add(reclaimable_cache_bytes)
                .saturating_add(local_attachment_bytes),
        })
    }

    pub fn clear_reclaimable_attachment_cache(&self) -> MailResult<CacheClearResult> {
        let attachment_root = self.data_dir.join("attachments");
        let usage_before = self.storage_usage()?;
        let (protected_paths, reclaimable_rows) = self.attachment_storage_index()?;

        for (path, _) in collect_regular_files(&attachment_root)? {
            if !protected_paths.contains(&path) {
                fs::remove_file(path)?;
            }
        }

        if !reclaimable_rows.is_empty() {
            self.with_conn(|conn| {
                let transaction = conn.unchecked_transaction()?;
                for (attachment_id, _) in &reclaimable_rows {
                    transaction.execute(
                        "UPDATE attachments SET is_downloaded = 0, local_path = '' WHERE id = ?1",
                        params![attachment_id],
                    )?;
                }
                transaction.commit()?;
                Ok(())
            })?;
        }

        prune_empty_directories(&attachment_root, true)?;
        let storage = self.storage_usage()?;
        Ok(CacheClearResult {
            removed_file_count: usage_before.reclaimable_file_count,
            reset_attachment_count: reclaimable_rows.len().min(i64::MAX as usize) as i64,
            released_bytes: usage_before
                .reclaimable_cache_bytes
                .saturating_sub(storage.reclaimable_cache_bytes),
            storage,
        })
    }

    fn attachment_storage_index(&self) -> MailResult<AttachmentStorageIndex> {
        let attachment_root = self.data_dir.join("attachments");
        self.with_conn(|conn| {
            let mut statement = conn.prepare(
                "
                SELECT a.id, a.local_path, m.remote_mailbox, m.remote_uid
                FROM attachments a
                JOIN messages m ON m.id = a.message_id
                WHERE a.is_downloaded = 1 AND a.local_path <> ''
                ",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            let mut protected_paths = BTreeSet::new();
            let mut reclaimable_rows = Vec::new();
            for (attachment_id, local_path, remote_mailbox, remote_uid) in rows {
                let path = PathBuf::from(local_path);
                if !is_managed_attachment_path(&attachment_root, &path) {
                    continue;
                }
                if remote_uid > 0 && !remote_mailbox.trim().is_empty() {
                    reclaimable_rows.push((attachment_id, path));
                } else {
                    protected_paths.insert(path);
                }
            }
            Ok((protected_paths, reclaimable_rows))
        })
    }

    pub fn set_message_read(&self, message_id: i64, is_read: bool) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET is_read = ?1 WHERE id = ?2",
                params![bool_to_int(is_read), message_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_folder_read(
        &self,
        folder_id: i64,
        role: &str,
        is_virtual: bool,
    ) -> MailResult<Vec<UnreadMessageRemoteRef>> {
        self.with_conn(|conn| {
            if is_virtual && role.trim().is_empty() {
                return Err(MailError::Imap(
                    "虚拟文件夹缺少角色，无法批量标为已读。".to_string(),
                ));
            }

            let unread_messages = if is_virtual {
                let mut stmt = conn.prepare(
                    "
                    SELECT m.account_id, m.remote_mailbox, m.remote_uid
                    FROM messages m
                    JOIN folders f ON f.id = m.folder_id
                    WHERE m.is_read = 0 AND f.role = ?1
                    ORDER BY m.account_id ASC, m.remote_mailbox ASC, m.remote_uid ASC
                    ",
                )?;
                let rows = stmt
                    .query_map(params![role], |row| {
                        Ok(UnreadMessageRemoteRef {
                            account_id: row.get(0)?,
                            remote_mailbox: row.get(1)?,
                            remote_uid: row.get(2)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            } else {
                let mut stmt = conn.prepare(
                    "
                    SELECT account_id, remote_mailbox, remote_uid
                    FROM messages
                    WHERE is_read = 0 AND folder_id = ?1
                    ORDER BY remote_mailbox ASC, remote_uid ASC
                    ",
                )?;
                let rows = stmt
                    .query_map(params![folder_id], |row| {
                        Ok(UnreadMessageRemoteRef {
                            account_id: row.get(0)?,
                            remote_mailbox: row.get(1)?,
                            remote_uid: row.get(2)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };

            if unread_messages.is_empty() {
                return Ok(unread_messages);
            }

            if is_virtual {
                conn.execute(
                    "
                    UPDATE messages
                    SET is_read = 1
                    WHERE is_read = 0
                      AND folder_id IN (SELECT id FROM folders WHERE role = ?1)
                    ",
                    params![role],
                )?;
            } else {
                conn.execute(
                    "UPDATE messages SET is_read = 1 WHERE is_read = 0 AND folder_id = ?1",
                    params![folder_id],
                )?;
            }

            Ok(unread_messages)
        })
    }

    pub fn set_message_starred(&self, message_id: i64, is_starred: bool) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET is_starred = ?1 WHERE id = ?2",
                params![bool_to_int(is_starred), message_id],
            )?;
            Ok(())
        })
    }

    pub fn move_message_to_role(&self, message_id: i64, role: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            let folder_id = folder_id_for_message_role(conn, message_id, role)?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                params![folder_id, message_id],
            )?;
            Ok(())
        })
    }

    pub fn restore_message_to_inbox(&self, message_id: i64) -> MailResult<Message> {
        self.with_conn(|conn| {
            let folder_id = folder_id_for_message_role(conn, message_id, "inbox")?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                params![folder_id, message_id],
            )?;
            message_for_conn(conn, message_id)
        })
    }

    pub fn delete_message_permanently(&self, message_id: i64) -> MailResult<MessageRemoteRef> {
        self.with_conn(|conn| {
            let reference = message_remote_ref_for_conn(conn, message_id)?;
            conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])?;
            Ok(reference)
        })
    }

    pub fn empty_trash_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<(i64, Vec<MessageRemoteRef>)> {
        self.with_conn(|conn| {
            let references = trash_remote_refs_for_conn(conn, account_id)?;
            let deleted = if let Some(account) = account_id {
                conn.execute(
                    "
                    DELETE FROM messages
                    WHERE account_id = ?1
                      AND folder_id IN (
                        SELECT id FROM folders WHERE account_id = ?1 AND role = 'trash'
                      )
                    ",
                    params![account],
                )?
            } else {
                conn.execute(
                    "
                    DELETE FROM messages
                    WHERE folder_id IN (SELECT id FROM folders WHERE role = 'trash')
                    ",
                    [],
                )?
            };
            Ok((deleted as i64, references))
        })
    }

    pub fn snooze_message(&self, message_id: i64, snoozed_until: &str) -> MailResult<Message> {
        self.with_conn(|conn| {
            let folder_id = folder_id_for_message_role(conn, message_id, "snoozed")?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = ?2, is_read = 1 WHERE id = ?3",
                params![folder_id, snoozed_until.trim(), message_id],
            )?;
            message_for_conn(conn, message_id)
        })
    }

    pub fn unsnooze_message(&self, message_id: i64) -> MailResult<Message> {
        self.with_conn(|conn| {
            let folder_id = folder_id_for_message_role(conn, message_id, "inbox")?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                params![folder_id, message_id],
            )?;
            message_for_conn(conn, message_id)
        })
    }

    pub fn release_due_snoozed_messages(&self, now: &str) -> MailResult<Vec<Message>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT m.id, m.snoozed_until
                FROM messages m
                JOIN folders f ON f.id = m.folder_id
                WHERE f.role = 'snoozed' AND m.snoozed_until <> ''
                ",
            )?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let due_ids = due_snoozed_message_ids(now, rows);
            if due_ids.is_empty() {
                return Ok(Vec::new());
            }
            for message_id in &due_ids {
                let folder_id = folder_id_for_message_role(conn, *message_id, "inbox")?;
                conn.execute(
                    "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                    params![folder_id, message_id],
                )?;
            }
            due_ids
                .into_iter()
                .map(|message_id| message_for_conn(conn, message_id))
                .collect()
        })
    }

    #[cfg(test)]
    pub fn remote_mailbox_for_role(&self, role: &str) -> MailResult<Option<String>> {
        let account = self.get_account()?;
        self.remote_mailbox_for_account_role(account.id, role)
    }

    pub fn remote_mailbox_for_account_role(
        &self,
        account_id: i64,
        role: &str,
    ) -> MailResult<Option<String>> {
        self.with_conn(|conn| {
            conn.query_row(
                "
                SELECT m.remote_name
                FROM imap_mailboxes m
                LEFT JOIN folders f ON f.id = m.local_folder_id
                WHERE m.account_id = ?1
                  AND (m.local_role = ?2 OR f.role = ?2)
                ORDER BY
                    CASE
                        WHEN m.local_role = ?2 THEN 0
                        ELSE 1
                    END,
                    CASE
                        WHEN m.remote_name = 'INBOX' THEN 0
                        ELSE 1
                    END,
                    m.remote_name
                LIMIT 1
                ",
                params![account_id, role],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
        })
    }

    pub fn apply_label_to_message(&self, message_id: i64, label_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO message_labels(message_id, label_id) VALUES (?1, ?2)",
                params![message_id, label_id],
            )?;
            Ok(())
        })
    }

    pub fn remove_label_from_message(&self, message_id: i64, label_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM message_labels WHERE message_id = ?1 AND label_id = ?2",
                params![message_id, label_id],
            )?;
            Ok(())
        })
    }

    pub fn save_draft(&self, input: DraftInput) -> MailResult<i64> {
        if input.draft_id > 0 {
            return self.with_conn(|conn| update_draft_message_for_conn(conn, input));
        }
        self.create_outbound_message(input, "drafts")
    }

    pub fn send_message(&self, input: DraftInput) -> MailResult<i64> {
        self.create_outbound_message(input, "sent")
    }

    pub fn queue_outbox_message(&self, input: DraftInput) -> MailResult<OutboxItem> {
        self.with_conn(|conn| {
            let send_at = input.send_at.trim().to_string();
            let status = if send_at.is_empty() {
                "queued"
            } else {
                "scheduled"
            };
            let message_id = create_outbound_message_for_conn(conn, input, "outbox")?;
            let queued_at = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO outbox_queue(message_id, status, attempts, last_error, queued_at, next_attempt_at)
                 VALUES (?1, ?2, 0, '', ?3, ?4)",
                params![message_id, status, queued_at, send_at],
            )?;
            let id = conn.last_insert_rowid();
            get_outbox_item_for_conn(conn, id)
        })
    }

    pub fn get_stats_for_account(&self, account_id: Option<i64>) -> MailResult<MailStats> {
        self.with_conn(|conn| {
            let account_filter = if account_id.is_some() {
                " AND m.account_id = ?"
            } else {
                ""
            };
            let account_params = || {
                account_id
                    .map(Value::Integer)
                    .into_iter()
                    .collect::<Vec<_>>()
            };
            let total_messages = scalar_count_values(
                conn,
                &format!("SELECT COUNT(*) FROM messages m WHERE 1 = 1{account_filter}"),
                account_params(),
            )?;
            let unread_messages = scalar_count_values(
                conn,
                &format!("SELECT COUNT(*) FROM messages m WHERE m.is_read = 0{account_filter}"),
                account_params(),
            )?;
            let starred_messages = scalar_count_values(
                conn,
                &format!("SELECT COUNT(*) FROM messages m WHERE m.is_starred = 1{account_filter}"),
                account_params(),
            )?;
            let draft_messages = scalar_count_values(
                conn,
                &format!(
                    "SELECT COUNT(*)
                 FROM messages m JOIN folders f ON f.id = m.folder_id
                 WHERE f.role = 'drafts'{account_filter}"
                ),
                account_params(),
            )?;
            let attachment_messages = scalar_count_values(
                conn,
                &format!(
                    "SELECT COUNT(*) FROM messages m WHERE m.has_attachments = 1{account_filter}"
                ),
                account_params(),
            )?;
            Ok(MailStats {
                total_messages,
                unread_messages,
                starred_messages,
                draft_messages,
                attachment_messages,
            })
        })
    }

    pub fn run_sync_dry_run(&self, account_id: Option<i64>) -> MailResult<SyncRun> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            let started_at = Utc::now().to_rfc3339();
            let scanned_folders = conn.query_row(
                "
                SELECT CASE
                    WHEN COUNT(*) > 0 THEN COUNT(*)
                    ELSE (SELECT COUNT(*) FROM folders WHERE account_id = ?1)
                END
                FROM imap_mailboxes
                WHERE account_id = ?1
                ",
                params![account.id],
                |row| row.get(0),
            )?;
            let imported_messages = 0;
            let finished_at = Utc::now().to_rfc3339();
            let message = format!(
                "同步演练完成（{}）：已验证本地调度、远端文件夹映射和 UID 游标存储。",
                account.email
            );
            conn.execute(
                "INSERT INTO sync_runs(started_at, finished_at, status, scanned_folders, imported_messages, message)
                 VALUES (?1, ?2, 'dry_run', ?3, ?4, ?5)",
                params![
                    started_at,
                    finished_at,
                    scanned_folders,
                    imported_messages,
                    message
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(SyncRun {
                id,
                started_at,
                finished_at,
                status: "dry_run".to_string(),
                scanned_folders,
                imported_messages,
                message,
            })
        })
    }

    #[cfg(test)]
    pub fn save_imap_mailboxes(
        &self,
        folders: &[ImapFolderProbe],
    ) -> MailResult<Vec<ImapMailboxState>> {
        self.save_imap_mailboxes_for_account(None, folders)
    }

    pub fn save_imap_mailboxes_for_account(
        &self,
        account_id: Option<i64>,
        folders: &[ImapFolderProbe],
    ) -> MailResult<Vec<ImapMailboxState>> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            let last_seen_at = Utc::now().to_rfc3339();
            for folder in folders {
                conn.execute(
                    "
                    INSERT INTO imap_mailboxes(account_id, remote_name, delimiter, attributes, local_role, uid_validity, highest_uid, last_seen_at, last_sync_at)
                    VALUES (?1, ?2, ?3, ?4, ?5, '', 0, ?6, '')
                    ON CONFLICT(account_id, remote_name) DO UPDATE SET
                        delimiter = excluded.delimiter,
                        attributes = excluded.attributes,
                        local_role = excluded.local_role,
                        local_folder_id = CASE
                            WHEN excluded.local_role = 'custom' THEN imap_mailboxes.local_folder_id
                            ELSE NULL
                        END,
                        last_seen_at = excluded.last_seen_at
                    ",
                    params![
                        account.id,
                        folder.name.trim(),
                        folder.delimiter.trim(),
                        folder.attributes.join(", "),
                        infer_local_role(&folder.name, &folder.attributes),
                        last_seen_at
                    ],
                )?;
            }
            list_imap_mailboxes_for_conn(conn, Some(account.id))
        })
    }

    pub fn list_imap_mailboxes(&self) -> MailResult<Vec<ImapMailboxState>> {
        self.list_imap_mailboxes_for_account(None)
    }

    pub fn list_imap_mailboxes_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<ImapMailboxState>> {
        self.with_conn(|conn| list_imap_mailboxes_for_conn(conn, account_id))
    }

    pub fn map_imap_mailbox(
        &self,
        mailbox_id: i64,
        folder_id: Option<i64>,
    ) -> MailResult<ImapMailboxState> {
        self.with_conn(|conn| {
            let (account_id, local_role): (i64, String) = conn.query_row(
                "SELECT account_id, local_role FROM imap_mailboxes WHERE id = ?1",
                params![mailbox_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if local_role != "custom" {
                return Err(MailError::Imap(
                    "系统目录由服务商角色自动映射，不需要手动绑定。".to_string(),
                ));
            }

            if let Some(folder_id) = folder_id {
                let folder = folder_for_conn(conn, folder_id)?;
                if folder.account_id != Some(account_id) {
                    return Err(MailError::Imap(
                        "远端目录只能绑定到同一邮箱账号的本地文件夹。".to_string(),
                    ));
                }
                if !is_custom_folder_role(&folder.role) {
                    return Err(MailError::Imap(
                        "远端自定义目录只能绑定到本地自定义文件夹。".to_string(),
                    ));
                }
            }

            conn.execute(
                "UPDATE imap_mailboxes SET local_folder_id = ?2 WHERE id = ?1",
                params![mailbox_id, folder_id],
            )?;
            list_imap_mailboxes_for_conn(conn, Some(account_id))?
                .into_iter()
                .find(|mailbox| mailbox.id == mailbox_id)
                .ok_or_else(|| MailError::Imap("未找到远端目录映射。".to_string()))
        })
    }

    pub fn accounts_for_header_sync(&self, account_id: Option<i64>) -> MailResult<Vec<Account>> {
        self.with_conn(|conn| {
            if account_id.is_some() {
                return Ok(vec![account_for_conn(conn, account_id)?]);
            }
            let mut stmt = conn.prepare(
                "
                SELECT a.id, a.email, a.display_name, a.provider, a.imap_host, a.smtp_host,
                       a.incoming_protocol, a.auth_type, a.sync_mode, a.remote_images_allowed,
                       a.signature, a.is_default
                FROM accounts a
                LEFT JOIN imap_mailboxes m ON m.account_id = a.id
                GROUP BY a.id, a.email, a.display_name, a.provider, a.imap_host, a.smtp_host,
                         a.incoming_protocol, a.auth_type, a.sync_mode, a.remote_images_allowed,
                         a.signature, a.is_default
                ORDER BY
                    CASE WHEN COUNT(m.id) = 0 THEN 0 ELSE 1 END,
                    MIN(CASE WHEN m.last_sync_at = '' THEN '0000-00-00T00:00:00Z' ELSE m.last_sync_at END) ASC,
                    a.id ASC
                ",
            )?;
            let accounts = stmt
                .query_map([], map_account)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(accounts)
        })
    }

    pub fn header_sync_schedule_plan(
        &self,
        account_id: Option<i64>,
        max_accounts_per_batch: usize,
    ) -> MailResult<SyncSchedulePlan> {
        let accounts = self.accounts_for_header_sync(account_id)?;
        let max_accounts_per_batch = max_accounts_per_batch.max(1);
        let batch_accounts = accounts
            .iter()
            .take(max_accounts_per_batch)
            .cloned()
            .collect::<Vec<_>>();
        let delayed_accounts = accounts
            .iter()
            .skip(max_accounts_per_batch)
            .cloned()
            .collect::<Vec<_>>();
        let strategy = if account_id.is_some() {
            "单账号同步不分批。".to_string()
        } else {
            format!(
                "统一邮箱按待同步优先级串行限流；每轮最多同步 {} 个账号，其余账号留到下一轮。",
                max_accounts_per_batch
            )
        };
        Ok(SyncSchedulePlan {
            max_accounts_per_batch: max_accounts_per_batch as i64,
            total_accounts: accounts.len() as i64,
            batch_accounts,
            delayed_accounts,
            strategy,
        })
    }

    #[cfg(test)]
    pub fn import_imap_headers(
        &self,
        mailbox_id: i64,
        batch: &ImapHeaderBatch,
    ) -> MailResult<SyncRun> {
        self.with_conn(|conn| {
            let started_at = Utc::now().to_rfc3339();
            let imported_messages = import_imap_headers_for_conn(conn, mailbox_id, batch)?;
            let finished_at = Utc::now().to_rfc3339();
            let message = format!(
                "IMAP 邮件头同步完成：{} 扫描 {} 封，新增 {} 封。",
                batch.remote_name,
                batch.headers.len(),
                imported_messages
            );
            conn.execute(
                "INSERT INTO sync_runs(started_at, finished_at, status, scanned_folders, imported_messages, message)
                 VALUES (?1, ?2, 'imap_headers', 1, ?3, ?4)",
                params![started_at, finished_at, imported_messages, message],
            )?;
            let id = conn.last_insert_rowid();
            Ok(SyncRun {
                id,
                started_at,
                finished_at,
                status: "imap_headers".to_string(),
                scanned_folders: 1,
                imported_messages,
                message,
            })
        })
    }

    pub fn import_imap_headers_batch(
        &self,
        mailbox_id: i64,
        batch: &ImapHeaderBatch,
    ) -> MailResult<i64> {
        self.with_conn(|conn| import_imap_headers_for_conn(conn, mailbox_id, batch))
    }

    pub fn reconcile_imap_flag_snapshot(
        &self,
        mailbox_id: i64,
        snapshot: &ImapFlagSnapshot,
    ) -> MailResult<ImapReconcileResult> {
        self.with_conn(|conn| reconcile_imap_flag_snapshot_for_conn(conn, mailbox_id, snapshot))
    }

    pub fn list_sync_runs(&self) -> MailResult<Vec<SyncRun>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, started_at, finished_at, status, scanned_folders, imported_messages, message
                 FROM sync_runs ORDER BY started_at DESC LIMIT 10",
            )?;
            let runs = stmt
                .query_map([], |row| {
                    Ok(SyncRun {
                        id: row.get(0)?,
                        started_at: row.get(1)?,
                        finished_at: row.get(2)?,
                        status: row.get(3)?,
                        scanned_folders: row.get(4)?,
                        imported_messages: row.get(5)?,
                        message: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(runs)
        })
    }

    pub fn record_sync_run(
        &self,
        started_at: &str,
        finished_at: &str,
        status: &str,
        scanned_folders: i64,
        imported_messages: i64,
        message: &str,
    ) -> MailResult<SyncRun> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO sync_runs(started_at, finished_at, status, scanned_folders, imported_messages, message)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    started_at,
                    finished_at,
                    status,
                    scanned_folders,
                    imported_messages,
                    message
                ],
            )?;
            let id = conn.last_insert_rowid();
            Ok(SyncRun {
                id,
                started_at: started_at.to_string(),
                finished_at: finished_at.to_string(),
                status: status.to_string(),
                scanned_folders,
                imported_messages,
                message: message.to_string(),
            })
        })
    }

    pub fn list_contacts(&self) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts ORDER BY last_seen_at DESC, name LIMIT 100",
            )?;
            let contacts = stmt
                .query_map([], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }

    pub fn list_contact_merge_suggestions(&self) -> MailResult<Vec<ContactMergeSuggestion>> {
        let contacts = self.list_contacts()?;
        Ok(detect_contact_merge_suggestions(contacts))
    }

    pub fn list_all_contacts(&self) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts ORDER BY name COLLATE NOCASE, email COLLATE NOCASE",
            )?;
            let contacts = stmt
                .query_map([], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }

    pub fn import_contacts(&self, inputs: Vec<ContactCreateInput>) -> MailResult<(i64, i64)> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let now = Utc::now().to_rfc3339();
            let mut created = 0_i64;
            let mut updated = 0_i64;

            for input in inputs {
                let email = normalize_email(&input.email);
                if email.is_empty() {
                    continue;
                }
                let existing = transaction
                    .query_row(
                        "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                         FROM contacts WHERE lower(email) = lower(?1)",
                        params![email],
                        |row| {
                            Ok(Contact {
                                id: row.get(0)?,
                                name: row.get(1)?,
                                email: row.get(2)?,
                                aliases: contact_aliases_from_text(row.get(3)?),
                                vip: row.get::<_, i64>(4)? != 0,
                                message_count: row.get(5)?,
                                last_seen_at: row.get(6)?,
                            })
                        },
                    )
                    .optional()?;
                let imported_name = input.name.trim();

                if let Some(existing) = existing {
                    let mut aliases = existing.aliases.clone();
                    aliases.extend(input.aliases);
                    let aliases = normalize_contact_aliases(aliases, &existing.email);
                    let name = if (existing.name.trim().is_empty() || existing.name == existing.email)
                        && !imported_name.is_empty()
                    {
                        imported_name
                    } else {
                        existing.name.as_str()
                    };
                    transaction.execute(
                        "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1",
                        params![
                            existing.id,
                            name,
                            contact_aliases_to_text(&aliases),
                            if existing.vip || input.vip { 1 } else { 0 },
                        ],
                    )?;
                    updated += 1;
                } else {
                    let display_name = if imported_name.is_empty() {
                        email.as_str()
                    } else {
                        imported_name
                    };
                    let aliases = normalize_contact_aliases(input.aliases, &email);
                    transaction.execute(
                        "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                        params![
                            display_name,
                            email,
                            contact_aliases_to_text(&aliases),
                            if input.vip { 1 } else { 0 },
                            now,
                        ],
                    )?;
                    created += 1;
                }
            }

            transaction.commit()?;
            Ok((created, updated))
        })
    }

    pub fn create_contact(&self, input: ContactCreateInput) -> MailResult<Contact> {
        self.with_conn(|conn| {
            let email = normalize_email(&input.email);
            if email.is_empty() {
                return Err(MailError::Imap("联系人邮箱不能为空".to_string()));
            }
            let name = input.name.trim();
            let display_name = if name.is_empty() {
                email.as_str()
            } else {
                name
            };
            let aliases = normalize_contact_aliases(input.aliases, &email);
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![
                    display_name,
                    email,
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                    now,
                ],
            )?;
            get_contact_for_conn(conn, conn.last_insert_rowid())
        })
    }

    pub fn update_contact(&self, contact_id: i64, input: ContactInput) -> MailResult<Contact> {
        self.with_conn(|conn| {
            let existing = conn.query_row(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at FROM contacts WHERE id = ?1",
                params![contact_id],
                |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                },
            )?;
            let name = input.name.trim();
            let aliases = normalize_contact_aliases(input.aliases, &existing.email);
            conn.execute(
                "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1",
                params![
                    contact_id,
                    if name.is_empty() { existing.name.as_str() } else { name },
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                ],
            )?;
            Ok(Contact {
                aliases,
                vip: input.vip,
                name: if name.is_empty() { existing.name } else { name.to_string() },
                ..existing
            })
        })
    }

    pub fn delete_contact(&self, contact_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM contacts WHERE id = ?1", params![contact_id])?;
            Ok(())
        })
    }

    pub fn merge_contacts(
        &self,
        target_contact_id: i64,
        source_contact_id: i64,
    ) -> MailResult<Contact> {
        if target_contact_id == source_contact_id {
            return Err(MailError::Imap("请选择两个不同联系人进行合并".to_string()));
        }
        self.with_conn(|conn| {
            let target = get_contact_for_conn(conn, target_contact_id)?;
            let source = get_contact_for_conn(conn, source_contact_id)?;
            let mut aliases = target.aliases.clone();
            aliases.push(source.email.clone());
            aliases.extend(source.aliases.clone());
            let aliases = normalize_contact_aliases(aliases, &target.email);
            let name = if target.name.trim().is_empty() || target.name == target.email {
                source.name.as_str()
            } else {
                target.name.as_str()
            };
            let message_count = target.message_count + source.message_count;
            let last_seen_at = if source.last_seen_at > target.last_seen_at {
                source.last_seen_at.as_str()
            } else {
                target.last_seen_at.as_str()
            };
            conn.execute(
                "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4, message_count = ?5, last_seen_at = ?6 WHERE id = ?1",
                params![
                    target_contact_id,
                    name,
                    contact_aliases_to_text(&aliases),
                    if target.vip || source.vip { 1 } else { 0 },
                    message_count,
                    last_seen_at,
                ],
            )?;
            conn.execute("DELETE FROM contacts WHERE id = ?1", params![source_contact_id])?;
            get_contact_for_conn(conn, target_contact_id)
        })
    }

    pub fn list_rules(&self) -> MailResult<Vec<MailRule>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, condition, action, enabled FROM mail_rules ORDER BY id",
            )?;
            let rules = stmt
                .query_map([], |row| {
                    Ok(MailRule {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        condition: row.get(2)?,
                        action: row.get(3)?,
                        enabled: row.get::<_, i64>(4)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rules)
        })
    }

    pub fn upsert_rule(&self, rule_id: Option<i64>, input: MailRuleInput) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            let name = input.name.trim();
            let condition = input.condition.trim();
            let action = input.action.trim();
            if name.is_empty() || condition.is_empty() || action.is_empty() {
                return Err(crate::db::MailError::Imap(
                    "规则名称、条件和动作都不能为空。".to_string(),
                ));
            }
            let enabled = bool_to_int(input.enabled);
            let id = if let Some(id) = rule_id {
                conn.execute(
                    "
                    UPDATE mail_rules
                    SET name = ?2, condition = ?3, action = ?4, enabled = ?5
                    WHERE id = ?1
                    ",
                    params![id, name, condition, action, enabled],
                )?;
                id
            } else {
                conn.execute(
                    "
                    INSERT INTO mail_rules(name, condition, action, enabled)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                    params![name, condition, action, enabled],
                )?;
                conn.last_insert_rowid()
            };
            rule_for_conn(conn, id)
        })
    }

    pub fn set_rule_enabled(&self, rule_id: i64, enabled: bool) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE mail_rules SET enabled = ?2 WHERE id = ?1",
                params![rule_id, bool_to_int(enabled)],
            )?;
            rule_for_conn(conn, rule_id)
        })
    }

    pub fn delete_rule(&self, rule_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM mail_rules WHERE id = ?1", params![rule_id])?;
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub fn list_threads_for_scope(
        &self,
        account_id: Option<i64>,
        folder_id: Option<i64>,
        query: Option<String>,
        filter: Option<String>,
        limit: i64,
    ) -> MailResult<Vec<ThreadSummary>> {
        self.list_threads_for_scope_sorted(account_id, folder_id, query, filter, None, limit)
    }

    pub fn list_threads_for_scope_sorted(
        &self,
        account_id: Option<i64>,
        folder_id: Option<i64>,
        query: Option<String>,
        filter: Option<String>,
        sort: Option<String>,
        limit: i64,
    ) -> MailResult<Vec<ThreadSummary>> {
        self.with_conn(|conn| {
            let limit = limit.clamp(1, 200);
            let search = query
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let filter = filter
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "all".to_string());
            let search_criteria = SearchCriteria::parse(search.as_deref());
            let mut scope_conditions = Vec::new();
            let mut query_params = Vec::new();
            if let Some(folder_id) = folder_id {
                if folder_id > 0 {
                    scope_conditions.push("m.folder_id = ?".to_string());
                    query_params.push(Value::Integer(folder_id));
                } else if folder_id < 0 {
                    let role = role_for_virtual_folder_id(folder_id)
                        .ok_or_else(|| MailError::MissingFolderRole(folder_id.to_string()))?;
                    scope_conditions.push("f.role = ?".to_string());
                    query_params.push(Value::Text(role.to_string()));
                }
            }
            if let Some(account_id) = account_id {
                scope_conditions.push("m.account_id = ?".to_string());
                query_params.push(Value::Integer(account_id));
            }
            let scope_condition = if scope_conditions.is_empty() {
                "1 = 1".to_string()
            } else {
                scope_conditions.join(" AND ")
            };
            let filter_clause = build_message_filter_clause(&search_criteria, &filter);
            let order_clause = thread_order_clause(sort.as_deref());
            let sql = format!(
                "
                WITH scoped_messages AS (
                    SELECT m.id, m.account_id, m.thread_key, m.subject, m.sender_name,
                           m.received_at, m.is_read
                    FROM messages m
                    JOIN accounts a ON a.id = m.account_id
                    JOIN folders f ON f.id = m.folder_id
                    WHERE {scope_condition} {filter_clause}
                )
                SELECT scoped.thread_key,
                       COALESCE(
                           (
                               SELECT latest.subject
                               FROM scoped_messages latest
                               WHERE latest.thread_key = scoped.thread_key
                               ORDER BY latest.received_at DESC, latest.id DESC
                               LIMIT 1
                           ),
                           '(无主题)'
                       ) AS subject,
                       COUNT(*) AS message_count,
                       SUM(CASE WHEN scoped.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
                       MAX(scoped.received_at) AS latest_at,
                       GROUP_CONCAT(DISTINCT scoped.sender_name) AS participants,
                       MAX(
                           CASE WHEN EXISTS (
                               SELECT 1
                               FROM muted_threads muted
                               WHERE muted.account_id = scoped.account_id
                                 AND muted.thread_key = scoped.thread_key
                           ) THEN 1 ELSE 0 END
                       ) AS is_muted
                FROM scoped_messages scoped
                GROUP BY scoped.thread_key
                ORDER BY {order_clause}
                LIMIT ?
                ",
            );
            query_params.extend(search_criteria.params().into_iter().map(Value::Text));
            query_params.push(Value::Integer(limit));
            let mut stmt = conn.prepare(&sql)?;
            let threads = stmt
                .query_map(params_from_iter(query_params), |row| {
                    Ok(ThreadSummary {
                        thread_key: row.get(0)?,
                        subject: row.get(1)?,
                        message_count: row.get(2)?,
                        unread_count: row.get(3)?,
                        latest_at: row.get(4)?,
                        participants: row.get(5)?,
                        is_muted: row.get::<_, i64>(6)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(threads)
        })
    }

    pub fn set_threads_muted_for_messages(
        &self,
        message_ids: &[i64],
        muted: bool,
    ) -> MailResult<i64> {
        if message_ids.is_empty() {
            return Ok(0);
        }
        self.with_conn(|conn| {
            let placeholders = std::iter::repeat_n("?", message_ids.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "
                SELECT DISTINCT account_id, thread_key
                FROM messages
                WHERE id IN ({placeholders})
                  AND TRIM(thread_key) <> ''
                "
            );
            let values = message_ids
                .iter()
                .copied()
                .map(Value::Integer)
                .collect::<Vec<_>>();
            let scopes = {
                let mut stmt = conn.prepare(&sql)?;
                let rows = stmt.query_map(params_from_iter(values), |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let transaction = conn.unchecked_transaction()?;
            for (account_id, thread_key) in &scopes {
                if muted {
                    transaction.execute(
                        "
                        INSERT INTO muted_threads(account_id, thread_key, created_at)
                        VALUES (?1, ?2, ?3)
                        ON CONFLICT(account_id, thread_key) DO NOTHING
                        ",
                        params![account_id, thread_key, Utc::now().to_rfc3339()],
                    )?;
                } else {
                    transaction.execute(
                        "DELETE FROM muted_threads WHERE account_id = ?1 AND thread_key = ?2",
                        params![account_id, thread_key],
                    )?;
                }
            }
            transaction.commit()?;
            Ok(scopes.len() as i64)
        })
    }

    pub fn list_muted_thread_keys(&self, account_id: i64) -> MailResult<Vec<String>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT thread_key
                FROM muted_threads
                WHERE account_id = ?1
                ORDER BY thread_key ASC
                ",
            )?;
            let keys = stmt
                .query_map(params![account_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(keys)
        })
    }

    pub fn list_outbox(&self) -> MailResult<Vec<OutboxItem>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT q.id, q.message_id, m.recipients, m.subject, q.status, q.attempts,
                       q.last_error, q.queued_at, q.next_attempt_at
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                ORDER BY q.queued_at DESC
                LIMIT 50
                ",
            )?;
            let items = stmt
                .query_map([], map_outbox_item)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        })
    }

    pub fn enqueue_background_task(
        &self,
        input: BackgroundTaskInput,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let kind = normalize_background_task_kind(&input.kind);
            let source = normalize_background_task_source(&input.source);
            let active_task = conn
                .query_row(
                    "
                    SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
                    FROM background_tasks
                    WHERE kind = ?1 AND status IN ('queued', 'running')
                    ORDER BY created_at ASC
                    LIMIT 1
                    ",
                    params![kind],
                    map_background_task,
                )
                .optional()?;
            if let Some(task) = active_task {
                return Ok(task);
            }

            let created_at = Utc::now().to_rfc3339();
            let title = background_task_title(kind, source);
            conn.execute(
                "
                INSERT INTO background_tasks(kind, title, source, status, message, created_at)
                VALUES (?1, ?2, ?3, 'queued', '等待执行', ?4)
                ",
                params![kind, title, source, created_at],
            )?;
            get_background_task_for_conn(conn, conn.last_insert_rowid())
        })
    }

    pub fn list_background_tasks(&self) -> MailResult<Vec<BackgroundTask>> {
        self.with_conn(list_background_tasks_for_conn)
    }

    pub fn next_background_task(&self) -> MailResult<Option<BackgroundTask>> {
        self.with_conn(|conn| {
            conn.query_row(
                "
                SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
                FROM background_tasks
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                ",
                [],
                map_background_task,
            )
            .optional()
            .map_err(Into::into)
        })
    }

    pub fn mark_background_task_running(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let started_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'running', message = '执行中', started_at = ?1
                WHERE id = ?2
                ",
                params![started_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }

    pub fn complete_background_task(
        &self,
        task_id: i64,
        message: &str,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let finished_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'done', message = ?1, finished_at = ?2
                WHERE id = ?3
                ",
                params![message, finished_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }

    pub fn fail_background_task(&self, task_id: i64, message: &str) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let finished_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'failed', message = ?1, finished_at = ?2
                WHERE id = ?3
                ",
                params![message, finished_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }

    pub fn save_oauth_session(
        &self,
        mut report: OAuthStartReport,
        code_verifier: &str,
    ) -> MailResult<OAuthStartReport> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, None)?;
            let created_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                INSERT INTO oauth_sessions(
                    account_id, provider, authorization_url, redirect_uri, state,
                    code_challenge, code_verifier, scopes, status, created_at, message
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10)
                ",
                params![
                    account.id,
                    &report.provider,
                    &report.authorization_url,
                    &report.redirect_uri,
                    &report.state,
                    &report.code_challenge,
                    code_verifier,
                    report.scopes.join("\n"),
                    created_at,
                    &report.message
                ],
            )?;
            report.session_id = conn.last_insert_rowid();
            Ok(report)
        })
    }

    pub fn list_oauth_sessions(&self) -> MailResult<Vec<OAuthSession>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, provider, authorization_url, redirect_uri, state, code_challenge,
                       scopes, status, created_at, completed_at, message
                FROM oauth_sessions
                ORDER BY created_at DESC
                LIMIT 10
                ",
            )?;
            let sessions = stmt
                .query_map([], |row| {
                    let scopes: String = row.get(6)?;
                    Ok(OAuthSession {
                        id: row.get(0)?,
                        provider: row.get(1)?,
                        authorization_url: row.get(2)?,
                        redirect_uri: row.get(3)?,
                        state: row.get(4)?,
                        code_challenge: row.get(5)?,
                        scopes: scopes
                            .lines()
                            .map(str::trim)
                            .filter(|scope| !scope.is_empty())
                            .map(ToOwned::to_owned)
                            .collect(),
                        status: row.get(7)?,
                        created_at: row.get(8)?,
                        completed_at: row.get(9)?,
                        message: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(sessions)
        })
    }

    pub fn complete_oauth_callback(
        &self,
        state: &str,
        code: &str,
    ) -> MailResult<OAuthCallbackReport> {
        let state = state.trim();
        let code = code.trim();
        if state.is_empty() || code.is_empty() {
            return Err(crate::db::MailError::Imap(
                "OAuth2 回调必须包含 state 和 code。".to_string(),
            ));
        }

        self.with_conn(|conn| {
            let (id, provider, status): (i64, String, String) = conn.query_row(
                "SELECT id, provider, status FROM oauth_sessions WHERE state = ?1",
                params![state],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            if status != "pending" {
                return Err(crate::db::MailError::Imap(format!(
                    "OAuth2 会话状态为 {status}，不能重复处理回调。"
                )));
            }
            let now = Utc::now().to_rfc3339();
            let message = "OAuth2 授权码已接收；下一步执行 token 交换并写入系统 Keychain。";
            conn.execute(
                "
                UPDATE oauth_sessions
                SET authorization_code = ?2,
                    status = 'code_received',
                    completed_at = ?3,
                    message = ?4
                WHERE id = ?1
                ",
                params![id, code, now, message],
            )?;
            Ok(OAuthCallbackReport {
                session_id: id,
                provider,
                status: "code_received".to_string(),
                message: message.to_string(),
            })
        })
    }

    pub fn oauth_session_for_token_exchange(
        &self,
        session_id: i64,
    ) -> MailResult<OAuthTokenExchangeSession> {
        self.with_conn(|conn| {
            let session = conn.query_row(
                "
                SELECT s.id, a.email, s.provider, s.redirect_uri, s.code_verifier,
                       s.scopes, s.authorization_code, s.status
                FROM oauth_sessions s
                JOIN accounts a ON a.id = s.account_id
                WHERE s.id = ?1
                ",
                params![session_id],
                |row| {
                    let scopes: String = row.get(5)?;
                    Ok(OAuthTokenExchangeSession {
                        id: row.get(0)?,
                        account_email: row.get(1)?,
                        provider: row.get(2)?,
                        redirect_uri: row.get(3)?,
                        code_verifier: row.get(4)?,
                        scopes: scopes
                            .lines()
                            .map(str::trim)
                            .filter(|scope| !scope.is_empty())
                            .map(ToOwned::to_owned)
                            .collect(),
                        authorization_code: row.get(6)?,
                        status: row.get(7)?,
                    })
                },
            )?;
            if !matches!(
                session.status.as_str(),
                "code_received" | "token_exchange_failed"
            ) {
                return Err(crate::db::MailError::Imap(format!(
                    "OAuth2 会话状态为 {}，需要先记录授权码。",
                    session.status
                )));
            }
            if session.authorization_code.trim().is_empty() {
                return Err(crate::db::MailError::Imap(
                    "OAuth2 会话没有授权码，无法交换 token。".to_string(),
                ));
            }
            Ok(session)
        })
    }

    pub fn mark_oauth_token_stored(
        &self,
        session_id: i64,
        expires_at: &str,
    ) -> MailResult<OAuthTokenExchangeReport> {
        self.with_conn(|conn| {
            let (id, provider): (i64, String) = conn.query_row(
                "SELECT id, provider FROM oauth_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let now = Utc::now().to_rfc3339();
            let message = "OAuth2 token 已交换并保存到系统 Keychain。";
            conn.execute(
                "
                UPDATE oauth_sessions
                SET status = 'token_stored',
                    completed_at = ?2,
                    message = ?3
                WHERE id = ?1
                ",
                params![id, now, message],
            )?;
            Ok(OAuthTokenExchangeReport {
                session_id: id,
                provider,
                status: "token_stored".to_string(),
                expires_at: expires_at.to_string(),
                message: message.to_string(),
            })
        })
    }

    pub fn mark_oauth_token_exchange_failed(
        &self,
        session_id: i64,
        reason: &str,
    ) -> MailResult<OAuthTokenExchangeReport> {
        self.with_conn(|conn| {
            let (id, provider): (i64, String) = conn.query_row(
                "SELECT id, provider FROM oauth_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let now = Utc::now().to_rfc3339();
            let message = format!("OAuth2 token 交换失败：{reason}");
            conn.execute(
                "
                UPDATE oauth_sessions
                SET status = 'token_exchange_failed',
                    completed_at = ?2,
                    message = ?3
                WHERE id = ?1
                ",
                params![id, now, &message],
            )?;
            Ok(OAuthTokenExchangeReport {
                session_id: id,
                provider,
                status: "token_exchange_failed".to_string(),
                expires_at: String::new(),
                message,
            })
        })
    }

    pub fn pending_outbox_messages(&self) -> MailResult<Vec<OutboundMessage>> {
        self.pending_outbox_messages_due_at(&Utc::now().to_rfc3339())
    }

    pub fn pending_outbox_messages_due_at(&self, now: &str) -> MailResult<Vec<OutboundMessage>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT m.id, m.account_id, m.sender_name, m.sender_email,
                       COALESCE(mi.reply_to, ''), m.recipients, m.cc, m.bcc, m.subject, m.body,
                       m.sanitized_html, m.in_reply_to_header, m.references_header
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                LEFT JOIN mail_identities mi ON mi.account_id = m.account_id AND mi.email = m.sender_email
                WHERE q.status IN ('queued', 'retry', 'failed', 'scheduled')
                  AND (q.next_attempt_at = '' OR q.next_attempt_at <= ?1)
                ORDER BY q.queued_at ASC
                LIMIT 20
                ",
            )?;
            let messages = stmt
                .query_map(params![now.trim()], |row| {
                    let message_id = row.get(0)?;
                    Ok(OutboundMessage {
                        id: message_id,
                        account_id: row.get(1)?,
                        sender_name: row.get(2)?,
                        sender_email: row.get(3)?,
                        reply_to: row.get(4)?,
                        recipients: row.get(5)?,
                        cc: row.get(6)?,
                        bcc: row.get(7)?,
                        subject: row.get(8)?,
                        body: row.get(9)?,
                        html_body: row.get(10)?,
                        in_reply_to_header: row.get(11)?,
                        references_header: row.get(12)?,
                        attachments: attachments_for_message_conn(conn, message_id)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(messages)
        })
    }

    pub fn pending_remote_archive_messages(&self) -> MailResult<Vec<OutboundMessage>> {
        self.pending_remote_archive_messages_due_at(&Utc::now().to_rfc3339())
    }

    pub fn pending_remote_archive_messages_due_at(
        &self,
        now: &str,
    ) -> MailResult<Vec<OutboundMessage>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT m.id, m.account_id, m.sender_name, m.sender_email,
                       COALESCE(mi.reply_to, ''), m.recipients, m.cc, m.bcc, m.subject, m.body,
                       m.sanitized_html, m.in_reply_to_header, m.references_header
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                LEFT JOIN mail_identities mi ON mi.account_id = m.account_id AND mi.email = m.sender_email
                WHERE q.status = 'sent_remote_pending'
                  AND (q.next_attempt_at = '' OR q.next_attempt_at <= ?1)
                ORDER BY q.queued_at ASC
                LIMIT 20
                ",
            )?;
            let messages = stmt
                .query_map(params![now.trim()], |row| {
                    let message_id = row.get(0)?;
                    Ok(OutboundMessage {
                        id: message_id,
                        account_id: row.get(1)?,
                        sender_name: row.get(2)?,
                        sender_email: row.get(3)?,
                        reply_to: row.get(4)?,
                        recipients: row.get(5)?,
                        cc: row.get(6)?,
                        bcc: row.get(7)?,
                        subject: row.get(8)?,
                        body: row.get(9)?,
                        html_body: row.get(10)?,
                        in_reply_to_header: row.get(11)?,
                        references_header: row.get(12)?,
                        attachments: attachments_for_message_conn(conn, message_id)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(messages)
        })
    }

    pub fn cancel_outbox_item(&self, outbox_id: i64) -> MailResult<OutboxItem> {
        self.with_conn(|conn| {
            let (message_id, status): (i64, String) = conn.query_row(
                "SELECT message_id, status FROM outbox_queue WHERE id = ?1",
                params![outbox_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if matches!(
                status.as_str(),
                "sent" | "sent_remote_pending" | "sent_dry_run" | "cancelled"
            ) {
                return Err(crate::db::MailError::Imap(format!(
                    "当前状态为 {status}，不能撤回。"
                )));
            }
            let drafts_id = folder_id_for_message_role(conn, message_id, "drafts")?;
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'cancelled', last_error = '已撤回到草稿箱', next_attempt_at = ''
                WHERE id = ?1
                ",
                params![outbox_id],
            )?;
            conn.execute(
                "UPDATE messages SET folder_id = ?1 WHERE id = ?2",
                params![drafts_id, message_id],
            )?;
            get_outbox_item_for_conn(conn, outbox_id)
        })
    }

    pub fn mark_outbox_smtp_sent_pending_archive(
        &self,
        message_id: i64,
        message_id_header: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let sent_id = folder_id_for_message_role(conn, message_id, "sent")?;
            let (subject, in_reply_to, references): (String, String, String) = conn.query_row(
                "
                SELECT subject, in_reply_to_header, references_header
                FROM messages
                WHERE id = ?1
                ",
                params![message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            let thread_key =
                thread_key_for_message(&subject, message_id_header, &in_reply_to, &references);
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent_remote_pending',
                    attempts = attempts + 1,
                    last_error = '',
                    next_attempt_at = ''
                WHERE message_id = ?1
                ",
                params![message_id],
            )?;
            conn.execute(
                "
                UPDATE messages
                SET folder_id = ?1,
                    message_id_header = ?2,
                    thread_key = ?4
                WHERE id = ?3
                ",
                params![sent_id, message_id_header.trim(), message_id, thread_key],
            )?;
            Ok(())
        })
    }

    pub fn mark_outbox_remote_archived(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent',
                    last_error = '',
                    next_attempt_at = ''
                WHERE message_id = ?1
                ",
                params![message_id],
            )?;
            conn.execute(
                "
                UPDATE messages
                SET remote_mailbox = ?1,
                    remote_uid = ?2
                WHERE id = ?3
                ",
                params![remote_mailbox.trim(), remote_uid.max(0), message_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_outbox_remote_archive_failed(
        &self,
        message_id: i64,
        error: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let next_attempt_at = (Utc::now() + Duration::minutes(5)).to_rfc3339();
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent_remote_pending',
                    last_error = ?1,
                    next_attempt_at = ?2
                WHERE message_id = ?3
                ",
                params![error.trim(), next_attempt_at, message_id],
            )?;
            Ok(())
        })
    }

    pub fn mark_outbox_failed(&self, message_id: i64, error: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            let attempts = conn
                .query_row(
                    "SELECT attempts FROM outbox_queue WHERE message_id = ?1",
                    params![message_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            let next_attempt_number = attempts + 1;
            let next_attempt_at = (Utc::now()
                + Duration::minutes(outbox_retry_delay_minutes(next_attempt_number)))
            .to_rfc3339();
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'retry', attempts = attempts + 1, last_error = ?2, next_attempt_at = ?3
                WHERE message_id = ?1
                ",
                params![
                    message_id,
                    error.chars().take(500).collect::<String>(),
                    next_attempt_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn flush_outbox_dry_run(&self) -> MailResult<Vec<OutboxItem>> {
        self.with_conn(|conn| {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent_dry_run', attempts = attempts + 1, last_error = '', next_attempt_at = ''
                WHERE status IN ('queued', 'retry', 'failed', 'scheduled')
                  AND (next_attempt_at = '' OR next_attempt_at <= ?1)
                ",
                params![now],
            )?;
            conn.execute(
                "
                UPDATE messages
                SET folder_id = (
                    SELECT f.id
                    FROM folders f
                    WHERE f.account_id = messages.account_id AND f.role = 'sent'
                    LIMIT 1
                )
                WHERE id IN (SELECT message_id FROM outbox_queue WHERE status = 'sent_dry_run')
                ",
                [],
            )?;
            let mut stmt = conn.prepare(
                "
                SELECT q.id, q.message_id, m.recipients, m.subject, q.status, q.attempts,
                       q.last_error, q.queued_at, q.next_attempt_at
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                ORDER BY q.queued_at DESC
                LIMIT 50
                ",
            )?;
            let items = stmt
                .query_map([], map_outbox_item)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(items)
        })
    }

    fn create_outbound_message(&self, input: DraftInput, role: &str) -> MailResult<i64> {
        self.with_conn(|conn| create_outbound_message_for_conn(conn, input, role))
    }
}

fn migrate_legacy_database(data_dir: &Path, database_path: &Path) -> MailResult<()> {
    let mut candidates = vec![data_dir.join(LEGACY_DATABASE_FILENAME)];
    if let Some(base_dir) = data_dir.parent() {
        candidates.push(
            base_dir
                .join(LEGACY_APP_IDENTIFIER)
                .join(LEGACY_DATABASE_FILENAME),
        );
    }

    for legacy_path in candidates {
        if !legacy_path.exists() {
            continue;
        }
        copy_database_file(&legacy_path, database_path)?;
        for suffix in ["-wal", "-shm"] {
            let legacy_sidecar = path_with_suffix(&legacy_path, suffix);
            if legacy_sidecar.exists() {
                fs::copy(legacy_sidecar, path_with_suffix(database_path, suffix))?;
            }
        }
        break;
    }
    Ok(())
}

fn copy_database_file(source: &Path, destination: &Path) -> MailResult<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    Ok(())
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

fn create_outbound_message_for_conn(
    conn: &Connection,
    input: DraftInput,
    role: &str,
) -> MailResult<i64> {
    let account = account_for_conn(conn, (input.account_id > 0).then_some(input.account_id))?;
    let identity = identity_for_draft_conn(conn, &account, input.identity_id)?;
    let folder_id = folder_id_for_account_role(conn, account.id, role)?;
    let now = Utc::now().to_rfc3339();
    let subject = normalized_subject(&input.subject);
    let body = if input.body.trim().is_empty() && !identity.signature.trim().is_empty() {
        format!("\n\n{}", identity.signature)
    } else if !identity.signature.trim().is_empty()
        && !input.body.contains(identity.signature.trim())
    {
        format!("{}\n\n{}", input.body.trim_end(), identity.signature)
    } else {
        input.body
    };
    let html_body = html_body_with_signature(&input.html_body, &identity.signature);
    let sanitized_html = sanitize_outbound_html(&html_body);
    let snippet = snippet_from_body(&body);
    let outbound_attachments = input
        .attachments
        .iter()
        .filter(|attachment| !attachment.filename.trim().is_empty())
        .collect::<Vec<_>>();
    conn.execute(
        "INSERT INTO messages(account_id, folder_id, sender_name, sender_email, recipients, cc, bcc, subject, snippet, body, sanitized_html, received_at, is_read, is_starred, has_attachments, thread_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, 0, ?13, ?14)",
        params![
            account.id,
            folder_id,
            identity.name,
            identity.email,
            input.to.trim(),
            input.cc.trim(),
            input.bcc.trim(),
            subject,
            snippet,
            body,
            sanitized_html,
            now,
            bool_to_int(!outbound_attachments.is_empty()),
            thread_key_for_message(&subject, "", "", "")
        ],
    )?;
    let message_id = conn.last_insert_rowid();
    replace_outbound_attachments_for_conn(conn, message_id, &outbound_attachments)?;
    upsert_contact(conn, input.to.trim(), input.to.trim(), &now)?;
    Ok(message_id)
}

fn update_draft_message_for_conn(conn: &Connection, input: DraftInput) -> MailResult<i64> {
    let (existing_account_id, role): (i64, String) = conn.query_row(
        "
        SELECT m.account_id, f.role
        FROM messages m
        JOIN folders f ON f.id = m.folder_id
        WHERE m.id = ?1
        ",
        params![input.draft_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    if role != "drafts" {
        return Err(MailError::Imap("只能更新草稿箱中的草稿。".to_string()));
    }

    let account_id = if input.account_id > 0 {
        input.account_id
    } else {
        existing_account_id
    };
    let account = account_for_conn(conn, Some(account_id))?;
    let identity = identity_for_draft_conn(conn, &account, input.identity_id)?;
    let folder_id = folder_id_for_account_role(conn, account.id, "drafts")?;
    let now = Utc::now().to_rfc3339();
    let subject = normalized_subject(&input.subject);
    let body = if input.body.trim().is_empty() && !identity.signature.trim().is_empty() {
        format!("\n\n{}", identity.signature)
    } else if !identity.signature.trim().is_empty()
        && !input.body.contains(identity.signature.trim())
    {
        format!("{}\n\n{}", input.body.trim_end(), identity.signature)
    } else {
        input.body
    };
    let html_body = html_body_with_signature(&input.html_body, &identity.signature);
    let sanitized_html = sanitize_outbound_html(&html_body);
    let snippet = snippet_from_body(&body);
    let outbound_attachments = input
        .attachments
        .iter()
        .filter(|attachment| !attachment.filename.trim().is_empty())
        .collect::<Vec<_>>();

    conn.execute(
        "
        UPDATE messages
        SET account_id = ?1, folder_id = ?2, sender_name = ?3, sender_email = ?4,
            recipients = ?5, cc = ?6, bcc = ?7, subject = ?8, snippet = ?9,
            body = ?10, sanitized_html = ?11, received_at = ?12, has_attachments = ?13, thread_key = ?14
        WHERE id = ?15
        ",
        params![
            account.id,
            folder_id,
            identity.name,
            identity.email,
            input.to.trim(),
            input.cc.trim(),
            input.bcc.trim(),
            subject,
            snippet,
            body,
            sanitized_html,
            now,
            bool_to_int(!outbound_attachments.is_empty()),
            thread_key_for_message(&subject, "", "", ""),
            input.draft_id
        ],
    )?;
    replace_outbound_attachments_for_conn(conn, input.draft_id, &outbound_attachments)?;
    upsert_contact(conn, input.to.trim(), input.to.trim(), &now)?;
    Ok(input.draft_id)
}

fn replace_outbound_attachments_for_conn(
    conn: &Connection,
    message_id: i64,
    outbound_attachments: &[&OutboundAttachmentInput],
) -> MailResult<()> {
    conn.execute(
        "DELETE FROM attachments WHERE message_id = ?1",
        params![message_id],
    )?;
    for attachment in outbound_attachments {
        let local_path = attachment.local_path.trim();
        conn.execute(
            "INSERT INTO attachments(message_id, filename, mime_type, size_bytes, is_downloaded, local_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                message_id,
                attachment.filename.trim(),
                fallback_mime_type(&attachment.mime_type),
                attachment.size_bytes.max(0),
                bool_to_int(!local_path.is_empty()),
                local_path
            ],
        )?;
    }
    Ok(())
}

fn sanitize_outbound_html(html: &str) -> String {
    if html.trim().is_empty() {
        String::new()
    } else {
        protocol::sanitize_html(html)
    }
}

fn html_body_with_signature(html: &str, signature: &str) -> String {
    let html = html.trim();
    let signature = signature.trim();
    if html.is_empty() || signature.is_empty() || html.contains(signature) {
        return html.to_string();
    }
    format!(
        "{html}<br><br>{}",
        html_escape(signature).replace('\n', "<br>")
    )
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn fallback_mime_type(mime_type: &str) -> &str {
    let trimmed = mime_type.trim();
    if trimmed.is_empty() {
        "application/octet-stream"
    } else {
        trimmed
    }
}

fn safe_attachment_filename(filename: &str) -> String {
    let normalized = filename
        .trim()
        .chars()
        .map(|character| {
            if character.is_control() || matches!(character, '/' | '\\' | ':') {
                '_'
            } else {
                character
            }
        })
        .take(120)
        .collect::<String>();
    if normalized.trim_matches(['.', ' ']).is_empty() {
        "attachment".to_string()
    } else {
        normalized
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> MailResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?
        .iter()
        .any(|name| name == column);
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))?;
    }
    Ok(())
}

fn migrate_thread_keys_if_needed(conn: &Connection) -> MailResult<()> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version >= THREAD_KEY_SCHEMA_VERSION {
        return Ok(());
    }
    rebuild_thread_keys_for_conn(conn)?;
    conn.pragma_update(None, "user_version", THREAD_KEY_SCHEMA_VERSION)?;
    Ok(())
}

fn rebuild_thread_keys_for_conn(conn: &Connection) -> MailResult<()> {
    let messages = {
        let mut stmt = conn.prepare(
            "
            SELECT id, subject, message_id_header, in_reply_to_header, references_header, thread_key
            FROM messages
            ",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    conn.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;
    let migration_result = (|| -> MailResult<()> {
        let mut update = conn.prepare("UPDATE messages SET thread_key = ?2 WHERE id = ?1")?;
        for (id, subject, message_id, in_reply_to, references, current_key) in messages {
            let next_key = thread_key_for_message(&subject, &message_id, &in_reply_to, &references);
            if next_key != current_key {
                update.execute(params![id, next_key])?;
            }
        }
        Ok(())
    })();
    if let Err(error) = migration_result {
        let _ = conn.execute_batch("ROLLBACK");
        return Err(error);
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

fn export_backup_table(conn: &Connection, table: &str) -> MailResult<Vec<LocalBackupRow>> {
    let columns = table_columns(conn, table)?;
    let select_columns = columns
        .iter()
        .map(|column| quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {select_columns} FROM {} ORDER BY rowid",
        quote_identifier(table)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |row| {
            let mut item = LocalBackupRow::new();
            for (index, column) in columns.iter().enumerate() {
                item.insert(column.clone(), sql_value_to_json(row.get_ref(index)?));
            }
            Ok(item)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn import_backup_table(conn: &Connection, table: &str, rows: &[LocalBackupRow]) -> MailResult<()> {
    let columns = table_columns(conn, table)?;
    for row in rows {
        let mut insert_columns = Vec::new();
        let mut values = Vec::new();
        for column in &columns {
            if let Some(value) = row.get(column) {
                insert_columns.push(column.clone());
                values.push(json_to_sql_value(value));
            }
        }
        if insert_columns.is_empty() {
            continue;
        }
        let placeholders = std::iter::repeat_n("?", insert_columns.len())
            .collect::<Vec<_>>()
            .join(", ");
        let quoted_columns = insert_columns
            .iter()
            .map(|column| quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {} ({quoted_columns}) VALUES ({placeholders})",
            quote_identifier(table)
        );
        conn.execute(&sql, params_from_iter(values))?;
    }
    Ok(())
}

fn table_columns(conn: &Connection, table: &str) -> MailResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote_identifier(table)))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(MailError::from)?;
    Ok(columns)
}

fn sql_value_to_json(value: ValueRef<'_>) -> serde_json::Value {
    match value {
        ValueRef::Null => serde_json::Value::Null,
        ValueRef::Integer(value) => serde_json::Value::Number(value.into()),
        ValueRef::Real(value) => serde_json::Number::from_f64(value)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        ValueRef::Text(value) => serde_json::Value::String(String::from_utf8_lossy(value).into()),
        ValueRef::Blob(value) => serde_json::Value::String(String::from_utf8_lossy(value).into()),
    }
}

fn json_to_sql_value(value: &serde_json::Value) -> Value {
    match value {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(value) => Value::Integer(bool_to_int(*value)),
        serde_json::Value::Number(value) => value
            .as_i64()
            .map(Value::Integer)
            .or_else(|| value.as_f64().map(Value::Real))
            .unwrap_or(Value::Null),
        serde_json::Value::String(value) => Value::Text(value.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Value::Text(serde_json::to_string(value).unwrap_or_default())
        }
    }
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn validate_local_backup(backup: &LocalBackup) -> MailResult<()> {
    if backup.schema_version != LOCAL_BACKUP_SCHEMA_VERSION {
        return Err(MailError::Imap(format!(
            "备份版本 {} 与当前版本 {} 不兼容。",
            backup.schema_version, LOCAL_BACKUP_SCHEMA_VERSION
        )));
    }
    if backup_table_count(backup, "accounts") == 0 {
        return Err(MailError::Imap(
            "备份不包含账号配置，已取消恢复。".to_string(),
        ));
    }
    Ok(())
}

fn backup_table_count(backup: &LocalBackup, table: &str) -> i64 {
    backup
        .tables
        .get(table)
        .map(|rows| rows.len().min(i64::MAX as usize) as i64)
        .unwrap_or(0)
}

#[derive(Debug, Default)]
struct SearchCriteria {
    text: Option<String>,
    from: Option<String>,
    to: Option<String>,
    cc: Option<String>,
    bcc: Option<String>,
    subject: Option<String>,
    body: Option<String>,
    label: Option<String>,
    account: Option<String>,
    mailbox: Option<String>,
    filename: Option<String>,
    after: Option<String>,
    before: Option<String>,
    has_attachment: bool,
    is_unread: bool,
    is_read: bool,
    is_starred: bool,
}

impl SearchCriteria {
    fn parse(search: Option<&str>) -> Self {
        let mut criteria = Self::default();
        let Some(raw) = search else {
            return criteria;
        };
        let mut text_terms = Vec::new();
        for token in raw.split_whitespace() {
            if let Some(value) = token
                .strip_prefix("from:")
                .filter(|value| !value.is_empty())
            {
                criteria.from = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("to:").filter(|value| !value.is_empty())
            {
                criteria.to = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("cc:").filter(|value| !value.is_empty())
            {
                criteria.cc = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("bcc:").filter(|value| !value.is_empty())
            {
                criteria.bcc = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("subject:")
                .filter(|value| !value.is_empty())
            {
                criteria.subject = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("body:")
                .or_else(|| token.strip_prefix("content:"))
                .filter(|value| !value.is_empty())
            {
                criteria.body = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("label:")
                .filter(|value| !value.is_empty())
            {
                criteria.label = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("account:")
                .filter(|value| !value.is_empty())
            {
                criteria.account = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("mailbox:")
                .filter(|value| !value.is_empty())
            {
                criteria.mailbox = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("folder:")
                .filter(|value| !value.is_empty())
            {
                criteria.mailbox = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("filename:")
                .filter(|value| !value.is_empty())
            {
                criteria.filename = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("attachment:")
                .filter(|value| !value.is_empty())
            {
                criteria.filename = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("after:")
                .filter(|value| !value.is_empty())
            {
                criteria.after = Some(normalize_search_date_start(value));
            } else if let Some(value) = token
                .strip_prefix("before:")
                .filter(|value| !value.is_empty())
            {
                criteria.before = Some(normalize_search_date_end(value));
            } else if matches!(token, "has:attachment" | "has:attachments") {
                criteria.has_attachment = true;
            } else if token == "is:unread" {
                criteria.is_unread = true;
                criteria.is_read = false;
            } else if token == "is:read" {
                criteria.is_read = true;
                criteria.is_unread = false;
            } else if token == "is:starred" {
                criteria.is_starred = true;
            } else {
                text_terms.push(token);
            }
        }
        let text = text_terms.join(" ");
        if !text.trim().is_empty() {
            criteria.text = Some(text);
        }
        criteria
    }

    fn params(&self) -> Vec<String> {
        let mut params = Vec::new();
        if let Some(text) = &self.text {
            let value = if should_use_fts(text) {
                build_fts_query(text)
            } else {
                build_like_query(text)
            };
            let repeat = if should_use_fts(text) { 1 } else { 6 };
            params.extend(std::iter::repeat_n(value, repeat));
        }
        if let Some(from) = &self.from {
            let value = build_like_query(from);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(to) = &self.to {
            params.push(build_like_query(to));
        }
        if let Some(cc) = &self.cc {
            params.push(build_like_query(cc));
        }
        if let Some(bcc) = &self.bcc {
            params.push(build_like_query(bcc));
        }
        if let Some(subject) = &self.subject {
            params.push(build_like_query(subject));
        }
        if let Some(body) = &self.body {
            let value = build_like_query(body);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(label) = &self.label {
            params.push(build_like_query(label));
        }
        if let Some(account) = &self.account {
            let value = build_like_query(account);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(mailbox) = &self.mailbox {
            let value = build_like_query(mailbox);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(filename) = &self.filename {
            params.push(build_like_query(filename));
        }
        if let Some(after) = &self.after {
            params.push(after.clone());
        }
        if let Some(before) = &self.before {
            params.push(before.clone());
        }
        params
    }
}

fn build_message_query(
    search: &SearchCriteria,
    filter: &str,
    scope_condition: &str,
    sort: Option<&str>,
) -> String {
    let mut sql = String::from(
        "
        SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
               m.cc, m.bcc, m.subject, m.snippet, m.body, m.sanitized_html, m.security_warnings,
                       m.received_at, m.is_read, m.is_starred, m.has_attachments,
                       m.snoozed_until, m.remote_mailbox, m.remote_uid,
                       m.message_id_header, m.in_reply_to_header, m.references_header
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        JOIN folders f ON f.id = m.folder_id
        ",
    );
    sql.push_str("WHERE ");
    sql.push_str(scope_condition);
    sql.push(' ');
    sql.push_str(&build_message_filter_clause(search, filter));
    sql.push_str("ORDER BY ");
    sql.push_str(message_order_clause(sort));
    sql.push_str(" LIMIT ?");
    sql
}

fn normalized_list_sort(sort: Option<&str>) -> &'static str {
    match sort.map(str::trim) {
        Some("oldest") => "oldest",
        Some("sender") => "sender",
        Some("subject") => "subject",
        _ => "newest",
    }
}

fn message_order_clause(sort: Option<&str>) -> &'static str {
    match normalized_list_sort(sort) {
        "oldest" => "m.received_at ASC, m.id ASC",
        "sender" => {
            "lower(m.sender_name) ASC, lower(m.sender_email) ASC, m.received_at DESC, m.id DESC"
        }
        "subject" => "lower(m.subject) ASC, m.received_at DESC, m.id DESC",
        _ => "m.received_at DESC, m.id DESC",
    }
}

fn thread_order_clause(sort: Option<&str>) -> &'static str {
    match normalized_list_sort(sort) {
        "oldest" => "latest_at ASC, scoped.thread_key ASC",
        "sender" => "lower(participants) ASC, latest_at DESC, scoped.thread_key ASC",
        "subject" => "lower(subject) ASC, latest_at DESC, scoped.thread_key ASC",
        _ => "latest_at DESC, scoped.thread_key ASC",
    }
}

fn build_message_filter_clause(search: &SearchCriteria, filter: &str) -> String {
    let mut sql = String::new();
    if let Some(term) = &search.text {
        if should_use_fts(term) {
            sql.push_str(
                "AND m.id IN (
                    SELECT rowid FROM message_search WHERE message_search MATCH ?
                ) ",
            );
        } else {
            sql.push_str(
                "AND (
                    m.subject LIKE ? ESCAPE '\\'
                    OR m.sender_name LIKE ? ESCAPE '\\'
                    OR m.sender_email LIKE ? ESCAPE '\\'
                    OR m.recipients LIKE ? ESCAPE '\\'
                    OR m.snippet LIKE ? ESCAPE '\\'
                    OR m.body LIKE ? ESCAPE '\\'
                ) ",
            );
        }
    }
    if search.from.is_some() {
        sql.push_str(
            "AND (m.sender_name LIKE ? ESCAPE '\\' OR m.sender_email LIKE ? ESCAPE '\\') ",
        );
    }
    if search.to.is_some() {
        sql.push_str("AND m.recipients LIKE ? ESCAPE '\\' ");
    }
    if search.cc.is_some() {
        sql.push_str("AND m.cc LIKE ? ESCAPE '\\' ");
    }
    if search.bcc.is_some() {
        sql.push_str("AND m.bcc LIKE ? ESCAPE '\\' ");
    }
    if search.subject.is_some() {
        sql.push_str("AND m.subject LIKE ? ESCAPE '\\' ");
    }
    if search.body.is_some() {
        sql.push_str("AND (m.body LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\') ");
    }
    if search.label.is_some() {
        sql.push_str(
            "AND EXISTS (
                SELECT 1
                FROM message_labels ml
                JOIN labels l ON l.id = ml.label_id
                WHERE ml.message_id = m.id AND l.name LIKE ? ESCAPE '\\'
            ) ",
        );
    }
    if search.account.is_some() {
        sql.push_str("AND (a.email LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\') ");
    }
    if search.mailbox.is_some() {
        sql.push_str("AND (m.remote_mailbox LIKE ? ESCAPE '\\' OR f.name LIKE ? ESCAPE '\\') ");
    }
    if search.filename.is_some() {
        sql.push_str(
            "AND EXISTS (
                SELECT 1
                FROM attachments att
                WHERE att.message_id = m.id AND att.filename LIKE ? ESCAPE '\\'
            ) ",
        );
    }
    if search.after.is_some() {
        sql.push_str("AND m.received_at >= ? ");
    }
    if search.before.is_some() {
        sql.push_str("AND m.received_at <= ? ");
    }
    if search.has_attachment {
        sql.push_str("AND m.has_attachments = 1 ");
    }
    if search.is_unread {
        sql.push_str("AND m.is_read = 0 ");
    }
    if search.is_read {
        sql.push_str("AND m.is_read = 1 ");
    }
    if search.is_starred {
        sql.push_str("AND m.is_starred = 1 ");
    }
    match filter {
        "unread" => sql.push_str("AND m.is_read = 0 "),
        "starred" => sql.push_str("AND m.is_starred = 1 "),
        "attachments" => sql.push_str("AND m.has_attachments = 1 "),
        _ => {}
    }
    sql
}

fn should_use_fts(term: &str) -> bool {
    term.is_ascii() && !term.trim().is_empty()
}

fn build_fts_query(term: &str) -> String {
    term.split_whitespace()
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_like_query(term: &str) -> String {
    let escaped = term
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn normalize_search_date_start(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') {
        format!("{trimmed}T00:00:00")
    } else {
        trimmed.to_string()
    }
}

fn normalize_search_date_end(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') {
        format!("{trimmed}T23:59:59")
    } else {
        trimmed.to_string()
    }
}

fn warning_lines_to_text(warnings: &[String]) -> String {
    warnings
        .iter()
        .map(|warning| warning.trim())
        .filter(|warning| !warning.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn warning_lines_from_text(raw: String) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|warning| !warning.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn contact_aliases_to_text(aliases: &[String]) -> String {
    aliases
        .iter()
        .map(|alias| alias.trim().to_ascii_lowercase())
        .filter(|alias| !alias.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn contact_aliases_from_text(raw: String) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|alias| !alias.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn normalize_contact_aliases(aliases: Vec<String>, primary_email: &str) -> Vec<String> {
    let primary = primary_email.trim().to_ascii_lowercase();
    let mut normalized = Vec::new();
    for alias in aliases {
        let value = alias.trim().to_ascii_lowercase();
        if value.is_empty() || value == primary || normalized.iter().any(|item| item == &value) {
            continue;
        }
        normalized.push(value);
    }
    normalized
}

fn contact_identity_keys(contact: &Contact) -> Vec<String> {
    let mut keys = vec![normalize_email(&contact.email)];
    keys.extend(contact.aliases.iter().map(|alias| normalize_email(alias)));
    keys.extend(
        contact
            .name
            .split(|character: char| !character.is_ascii_alphanumeric())
            .map(str::trim)
            .filter(|part| part.len() >= 4)
            .map(|part| part.to_ascii_lowercase()),
    );
    let domain = contact.email.split('@').nth(1).unwrap_or("").trim();
    if !domain.is_empty() {
        let name_key = contact.name.trim().to_ascii_lowercase();
        if !name_key.is_empty() && name_key != normalize_email(&contact.email) {
            keys.push(format!("{name_key}@{domain}"));
        }
    }
    let mut unique = Vec::new();
    for key in keys {
        if !key.is_empty() && !unique.iter().any(|item| item == &key) {
            unique.push(key);
        }
    }
    unique
}

fn contact_suggestion_reason(shared_keys: &[String]) -> String {
    if shared_keys.iter().any(|key| key.contains('@')) {
        "邮箱或别名重叠".to_string()
    } else {
        "名称相近，建议检查是否同一联系人".to_string()
    }
}

fn detect_contact_merge_suggestions(mut contacts: Vec<Contact>) -> Vec<ContactMergeSuggestion> {
    contacts.sort_by(|left, right| {
        right
            .message_count
            .cmp(&left.message_count)
            .then_with(|| right.last_seen_at.cmp(&left.last_seen_at))
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut suggestions = Vec::new();
    for left_index in 0..contacts.len() {
        let left = &contacts[left_index];
        let left_keys = contact_identity_keys(left);
        for right in contacts.iter().skip(left_index + 1) {
            let right_keys = contact_identity_keys(right);
            let shared_keys = left_keys
                .iter()
                .filter(|key| right_keys.iter().any(|right_key| right_key == *key))
                .take(4)
                .cloned()
                .collect::<Vec<_>>();
            if shared_keys.is_empty() {
                continue;
            }
            suggestions.push(ContactMergeSuggestion {
                target: left.clone(),
                source: right.clone(),
                reason: contact_suggestion_reason(&shared_keys),
                shared_keys,
            });
            if suggestions.len() >= 8 {
                return suggestions;
            }
        }
    }
    suggestions
}

fn get_contact_for_conn(conn: &Connection, contact_id: i64) -> MailResult<Contact> {
    conn.query_row(
        "SELECT id, name, email, aliases, vip, message_count, last_seen_at FROM contacts WHERE id = ?1",
        params![contact_id],
        |row| {
            Ok(Contact {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                aliases: contact_aliases_from_text(row.get(3)?),
                vip: row.get::<_, i64>(4)? != 0,
                message_count: row.get(5)?,
                last_seen_at: row.get(6)?,
            })
        },
    )
    .map_err(Into::into)
}

fn normalize_remote_image_trust_scope(scope: &str) -> MailResult<String> {
    match scope.trim().to_ascii_lowercase().as_str() {
        "sender" => Ok("sender".to_string()),
        "domain" => Ok("domain".to_string()),
        _ => Err(MailError::Imap(
            "远程图片信任范围必须是 sender 或 domain。".to_string(),
        )),
    }
}

fn normalize_remote_image_trust_value(scope: &str, value: &str) -> MailResult<String> {
    let normalized = value.trim().trim_start_matches('@').to_ascii_lowercase();
    let valid = match scope {
        "sender" => normalized.contains('@') && !normalized.ends_with('@'),
        "domain" => normalized.contains('.') && !normalized.contains('@'),
        _ => false,
    };
    if valid {
        Ok(normalized)
    } else {
        Err(MailError::Imap(
            "远程图片信任值必须是完整邮箱地址或域名。".to_string(),
        ))
    }
}

fn map_remote_image_trust(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteImageTrust> {
    Ok(RemoteImageTrust {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_email: row.get(2)?,
        scope: row.get(3)?,
        value: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn should_allow_remote_images_for_message(
    conn: &Connection,
    message: &Message,
) -> MailResult<bool> {
    let account = account_for_conn(conn, Some(message.account_id))?;
    if account.remote_images_allowed {
        return Ok(true);
    }
    let sender = message.sender_email.trim().to_ascii_lowercase();
    let domain = sender
        .split_once('@')
        .map(|(_, domain)| domain.trim().trim_start_matches('@').to_ascii_lowercase())
        .unwrap_or_default();
    if sender.is_empty() || domain.is_empty() {
        return Ok(false);
    }
    let exists: Option<i64> = conn
        .query_row(
            "
            SELECT id FROM remote_image_trusts
            WHERE account_id = ?1
              AND ((scope = 'sender' AND value = ?2) OR (scope = 'domain' AND value = ?3))
            LIMIT 1
            ",
            params![message.account_id, sender, domain],
            |row| row.get(0),
        )
        .optional()?;
    Ok(exists.is_some())
}

fn looks_like_html_fragment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "<html", "<body", "<div", "<p", "<table", "<a ", "<img", "<span",
    ]
    .iter()
    .any(|tag| lower.contains(tag))
}

fn normalize_auth_type(auth_type: &str) -> &str {
    match auth_type.trim() {
        "oauth2" => "oauth2",
        _ => "password",
    }
}

fn normalize_incoming_protocol(incoming_protocol: &str) -> &str {
    match incoming_protocol.trim().to_ascii_lowercase().as_str() {
        "pop3" => "pop3",
        _ => "imap",
    }
}

fn normalize_sync_mode(sync_mode: &str) -> &str {
    match sync_mode.trim() {
        "15min" => "15min",
        "push" => "push",
        _ => "manual",
    }
}

fn is_unique_constraint_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || code.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        provider: row.get(3)?,
        imap_host: row.get(4)?,
        smtp_host: row.get(5)?,
        incoming_protocol: row.get(6)?,
        auth_type: row.get(7)?,
        sync_mode: row.get(8)?,
        remote_images_allowed: row.get::<_, i64>(9)? != 0,
        signature: row.get(10)?,
        is_default: row.get::<_, i64>(11)? != 0,
    })
}

fn normalize_identity_email(value: &str) -> MailResult<String> {
    let email = value.trim().to_ascii_lowercase();
    if email.is_empty() || !email.contains('@') || email.ends_with('@') {
        return Err(MailError::Imap("请输入有效发件身份邮箱。".to_string()));
    }
    Ok(email)
}

fn map_mail_identity(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailIdentity> {
    Ok(MailIdentity {
        id: row.get(0)?,
        account_id: row.get(1)?,
        name: row.get(2)?,
        email: row.get(3)?,
        reply_to: row.get(4)?,
        signature: row.get(5)?,
        is_default: row.get::<_, i64>(6)? != 0,
    })
}

fn identities_for_account_conn(
    conn: &Connection,
    account_id: i64,
) -> MailResult<Vec<MailIdentity>> {
    ensure_default_identity_for_account_from_db_conn(conn, account_id)?;
    let mut stmt = conn.prepare(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE account_id = ?1
        ORDER BY is_default DESC, id ASC
        ",
    )?;
    let identities = stmt
        .query_map(params![account_id], map_mail_identity)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(identities)
}

fn ensure_default_identities_for_conn(conn: &Connection) -> MailResult<()> {
    let mut stmt = conn.prepare("SELECT id FROM accounts ORDER BY id")?;
    let account_ids = stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for account_id in account_ids {
        ensure_default_identity_for_account_from_db_conn(conn, account_id)?;
    }
    Ok(())
}

fn ensure_default_identity_for_account_from_db_conn(
    conn: &Connection,
    account_id: i64,
) -> MailResult<()> {
    let account = account_for_conn(conn, Some(account_id))?;
    ensure_default_identity_for_account_conn(
        conn,
        account.id,
        &account.display_name,
        &account.email,
        &account.signature,
    )
}

fn ensure_default_identity_for_account_conn(
    conn: &Connection,
    account_id: i64,
    name: &str,
    email: &str,
    signature: &str,
) -> MailResult<()> {
    let email = normalize_identity_email(email)?;
    let name = if name.trim().is_empty() {
        email.clone()
    } else {
        name.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "
        INSERT OR IGNORE INTO mail_identities(account_id, name, email, reply_to, signature, is_default, created_at)
        VALUES (?1, ?2, ?3, '', ?4, 1, ?5)
        ",
        params![account_id, name, email, signature, now],
    )?;
    let default_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM mail_identities WHERE account_id = ?1 AND is_default = 1",
        params![account_id],
        |row| row.get(0),
    )?;
    if default_count == 0 {
        conn.execute(
            "
            UPDATE mail_identities
            SET is_default = 1
            WHERE id = (
                SELECT id FROM mail_identities WHERE account_id = ?1 ORDER BY id ASC LIMIT 1
            )
            ",
            params![account_id],
        )?;
    }
    Ok(())
}

fn upsert_account_default_identity_conn(
    conn: &Connection,
    account_id: i64,
    name: &str,
    email: &str,
    signature: &str,
) -> MailResult<()> {
    let email = normalize_identity_email(email)?;
    ensure_default_identity_for_account_conn(conn, account_id, name, &email, signature)?;
    conn.execute(
        "UPDATE mail_identities SET is_default = 0 WHERE account_id = ?1",
        params![account_id],
    )?;
    conn.execute(
        "
        UPDATE mail_identities
        SET name = ?1, signature = ?2, is_default = 1
        WHERE account_id = ?3 AND email = ?4
        ",
        params![name.trim(), signature, account_id, email],
    )?;
    Ok(())
}

fn upsert_identity_conn(
    conn: &Connection,
    account: &Account,
    input: MailIdentityInput,
) -> MailResult<MailIdentity> {
    let email = normalize_identity_email(&input.email)?;
    let name = if input.name.trim().is_empty() {
        email.clone()
    } else {
        input.name.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    if input.is_default {
        conn.execute(
            "UPDATE mail_identities SET is_default = 0 WHERE account_id = ?1",
            params![account.id],
        )?;
    }
    if input.id > 0 {
        conn.execute(
            "
            UPDATE mail_identities
            SET name = ?1, email = ?2, reply_to = ?3, signature = ?4, is_default = ?5
            WHERE id = ?6 AND account_id = ?7
            ",
            params![
                name,
                email,
                input.reply_to.trim(),
                input.signature,
                bool_to_int(input.is_default),
                input.id,
                account.id
            ],
        )?;
        return identity_for_id_conn(conn, input.id);
    }
    conn.execute(
        "
        INSERT INTO mail_identities(account_id, name, email, reply_to, signature, is_default, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(account_id, email) DO UPDATE SET
          name = excluded.name,
          reply_to = excluded.reply_to,
          signature = excluded.signature,
          is_default = excluded.is_default
        ",
        params![
            account.id,
            name,
            email,
            input.reply_to.trim(),
            input.signature,
            bool_to_int(input.is_default),
            now
        ],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM mail_identities WHERE account_id = ?1 AND email = ?2",
        params![account.id, normalize_identity_email(&input.email)?],
        |row| row.get(0),
    )?;
    if input.is_default {
        conn.execute(
            "UPDATE mail_identities SET is_default = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE account_id = ?2",
            params![id, account.id],
        )?;
    }
    identity_for_id_conn(conn, id)
}

fn identity_for_id_conn(conn: &Connection, id: i64) -> MailResult<MailIdentity> {
    conn.query_row(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE id = ?1
        ",
        params![id],
        map_mail_identity,
    )
    .map_err(Into::into)
}

fn identity_for_draft_conn(
    conn: &Connection,
    account: &Account,
    identity_id: i64,
) -> MailResult<MailIdentity> {
    ensure_default_identity_for_account_from_db_conn(conn, account.id)?;
    if identity_id > 0 {
        return conn
            .query_row(
                "
                SELECT id, account_id, name, email, reply_to, signature, is_default
                FROM mail_identities
                WHERE id = ?1 AND account_id = ?2
                ",
                params![identity_id, account.id],
                map_mail_identity,
            )
            .map_err(Into::into);
    }
    conn.query_row(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE account_id = ?1
        ORDER BY is_default DESC, id ASC
        LIMIT 1
        ",
        params![account.id],
        map_mail_identity,
    )
    .map_err(Into::into)
}

fn message_for_conn(conn: &Connection, message_id: i64) -> MailResult<Message> {
    conn.query_row(
        "
        SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
               m.cc, m.bcc, m.subject, m.snippet, m.body, m.sanitized_html, m.security_warnings,
               m.received_at, m.is_read, m.is_starred, m.has_attachments,
               m.snoozed_until, m.remote_mailbox, m.remote_uid,
               m.message_id_header, m.in_reply_to_header, m.references_header
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        JOIN folders f ON f.id = m.folder_id
        WHERE m.id = ?1
        ",
        params![message_id],
        |row| {
            Ok(Message {
                id: row.get(0)?,
                account_id: row.get(1)?,
                account_email: row.get(2)?,
                folder_id: row.get(3)?,
                folder_role: row.get(4)?,
                sender_name: row.get(5)?,
                sender_email: row.get(6)?,
                recipients: row.get(7)?,
                cc: row.get(8)?,
                bcc: row.get(9)?,
                subject: row.get(10)?,
                snippet: row.get(11)?,
                body: row.get(12)?,
                sanitized_html: row.get(13)?,
                security_warnings: warning_lines_from_text(row.get(14)?),
                received_at: row.get(15)?,
                is_read: row.get::<_, i64>(16)? != 0,
                is_starred: row.get::<_, i64>(17)? != 0,
                has_attachments: row.get::<_, i64>(18)? != 0,
                snoozed_until: row.get(19)?,
                labels: labels_for_message(conn, message_id)?,
                attachment_count: attachment_count_for_message(conn, message_id)?,
                remote_mailbox: row.get(20)?,
                remote_uid: row.get(21)?,
                message_id_header: row.get(22)?,
                in_reply_to_header: row.get(23)?,
                references_header: row.get(24)?,
            })
        },
    )
    .map_err(Into::into)
}

fn message_remote_ref_for_conn(conn: &Connection, message_id: i64) -> MailResult<MessageRemoteRef> {
    conn.query_row(
        "
        SELECT account_id, remote_mailbox, remote_uid, message_id_header
        FROM messages
        WHERE id = ?1
        ",
        params![message_id],
        |row| {
            Ok(MessageRemoteRef {
                account_id: row.get(0)?,
                remote_mailbox: row.get(1)?,
                remote_uid: row.get(2)?,
                message_id_header: row.get(3)?,
            })
        },
    )
    .map_err(Into::into)
}

fn outbound_message_for_conn(conn: &Connection, message_id: i64) -> MailResult<OutboundMessage> {
    conn.query_row(
        "
        SELECT m.id, m.account_id, m.sender_name, m.sender_email,
               COALESCE(mi.reply_to, ''), m.recipients, m.cc, m.bcc, m.subject, m.body,
               m.sanitized_html, m.in_reply_to_header, m.references_header
        FROM messages m
        LEFT JOIN mail_identities mi ON mi.account_id = m.account_id AND mi.email = m.sender_email
        WHERE m.id = ?1
        ",
        params![message_id],
        |row| {
            let id = row.get(0)?;
            Ok(OutboundMessage {
                id,
                account_id: row.get(1)?,
                sender_name: row.get(2)?,
                sender_email: row.get(3)?,
                reply_to: row.get(4)?,
                recipients: row.get(5)?,
                cc: row.get(6)?,
                bcc: row.get(7)?,
                subject: row.get(8)?,
                body: row.get(9)?,
                html_body: row.get(10)?,
                in_reply_to_header: row.get(11)?,
                references_header: row.get(12)?,
                attachments: attachments_for_message_conn(conn, id)?,
            })
        },
    )
    .map_err(Into::into)
}

fn trash_remote_refs_for_conn(
    conn: &Connection,
    account_id: Option<i64>,
) -> MailResult<Vec<MessageRemoteRef>> {
    if let Some(account_id) = account_id {
        let mut stmt = conn.prepare(
            "
            SELECT m.account_id, m.remote_mailbox, m.remote_uid, m.message_id_header
            FROM messages m
            JOIN folders f ON f.id = m.folder_id
            WHERE m.account_id = ?1 AND f.role = 'trash'
            ORDER BY m.remote_mailbox ASC, m.remote_uid ASC, m.id ASC
            ",
        )?;
        let rows = stmt
            .query_map(params![account_id], |row| {
                Ok(MessageRemoteRef {
                    account_id: row.get(0)?,
                    remote_mailbox: row.get(1)?,
                    remote_uid: row.get(2)?,
                    message_id_header: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    } else {
        let mut stmt = conn.prepare(
            "
            SELECT m.account_id, m.remote_mailbox, m.remote_uid, m.message_id_header
            FROM messages m
            JOIN folders f ON f.id = m.folder_id
            WHERE f.role = 'trash'
            ORDER BY m.account_id ASC, m.remote_mailbox ASC, m.remote_uid ASC, m.id ASC
            ",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(MessageRemoteRef {
                    account_id: row.get(0)?,
                    remote_mailbox: row.get(1)?,
                    remote_uid: row.get(2)?,
                    message_id_header: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
}

fn due_snoozed_message_ids(now: &str, rows: Vec<(i64, String)>) -> Vec<i64> {
    let Ok(now) = DateTime::parse_from_rfc3339(now.trim()).map(|value| value.with_timezone(&Utc))
    else {
        return Vec::new();
    };
    rows.into_iter()
        .filter_map(|(message_id, snoozed_until)| {
            DateTime::parse_from_rfc3339(snoozed_until.trim())
                .ok()
                .filter(|due_at| due_at.with_timezone(&Utc) <= now)
                .map(|_| message_id)
        })
        .collect()
}

fn account_for_conn(conn: &Connection, account_id: Option<i64>) -> MailResult<Account> {
    account_for_conn_optional(conn, account_id)?
        .ok_or_else(|| MailError::Imap("没有可用邮箱账号。".to_string()))
}

fn account_for_conn_optional(conn: &Connection, account_id: Option<i64>) -> MailResult<Option<Account>> {
    if let Some(account_id) = account_id {
        return conn
            .query_row(
                "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, is_default
                 FROM accounts WHERE id = ?1",
                params![account_id],
                map_account,
            )
            .optional()
            .map_err(Into::into);
    }

    conn.query_row(
        "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, is_default
         FROM accounts ORDER BY is_default DESC, id LIMIT 1",
        [],
        map_account,
    )
    .optional()
    .map_err(Into::into)
}

fn ensure_default_account_for_conn(conn: &Connection) -> MailResult<()> {
    let preferred_account_id = conn
        .query_row(
            "SELECT id FROM accounts ORDER BY is_default DESC, id LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    let Some(preferred_account_id) = preferred_account_id else {
        return Ok(());
    };
    conn.execute("UPDATE accounts SET is_default = 0", [])?;
    conn.execute(
        "UPDATE accounts SET is_default = 1 WHERE id = ?1",
        params![preferred_account_id],
    )?;
    Ok(())
}

fn upsert_contact(conn: &Connection, name: &str, email: &str, seen_at: &str) -> MailResult<()> {
    if email.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO contacts(name, email, message_count, last_seen_at)
        VALUES (?1, ?2, 1, ?3)
        ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
            message_count = contacts.message_count + 1,
            last_seen_at = excluded.last_seen_at
        ",
        params![name.trim(), email.trim(), seen_at],
    )?;
    Ok(())
}

fn get_outbox_item_for_conn(conn: &Connection, id: i64) -> MailResult<OutboxItem> {
    conn.query_row(
        "
        SELECT q.id, q.message_id, m.recipients, m.subject, q.status, q.attempts,
               q.last_error, q.queued_at, q.next_attempt_at
        FROM outbox_queue q
        JOIN messages m ON m.id = q.message_id
        WHERE q.id = ?1
        ",
        params![id],
        map_outbox_item,
    )
    .map_err(Into::into)
}

fn map_outbox_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
    Ok(OutboxItem {
        id: row.get(0)?,
        message_id: row.get(1)?,
        recipients: row.get(2)?,
        subject: row.get(3)?,
        status: row.get(4)?,
        attempts: row.get(5)?,
        last_error: row.get(6)?,
        queued_at: row.get(7)?,
        next_attempt_at: row.get(8)?,
    })
}

fn outbox_retry_delay_minutes(next_attempt_number: i64) -> i64 {
    match next_attempt_number {
        0 | 1 => 1,
        2 => 5,
        3 => 15,
        4 => 60,
        _ => 240,
    }
}

fn get_background_task_for_conn(conn: &Connection, id: i64) -> MailResult<BackgroundTask> {
    conn.query_row(
        "
        SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
        FROM background_tasks
        WHERE id = ?1
        ",
        params![id],
        map_background_task,
    )
    .map_err(Into::into)
}

fn list_background_tasks_for_conn(conn: &Connection) -> MailResult<Vec<BackgroundTask>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
        FROM background_tasks
        ORDER BY created_at DESC
        LIMIT 10
        ",
    )?;
    let tasks = stmt
        .query_map([], map_background_task)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tasks)
}

fn map_background_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundTask> {
    Ok(BackgroundTask {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        source: row.get(3)?,
        status: row.get(4)?,
        message: row.get(5)?,
        created_at: row.get(6)?,
        started_at: row.get(7)?,
        finished_at: row.get(8)?,
    })
}

fn normalize_background_task_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "outbox-dry-run" => "outbox-dry-run",
        "outbox-smtp" => "outbox-smtp",
        _ => "sync",
    }
}

fn normalize_background_task_source(source: &str) -> &'static str {
    match source.trim() {
        "timer" => "timer",
        _ => "manual",
    }
}

fn background_task_title(kind: &str, source: &str) -> &'static str {
    match (kind, source) {
        ("sync", "timer") => "定时同步邮件头",
        ("sync", _) => "同步邮件头",
        ("outbox-smtp", _) => "真实发送发件箱",
        ("outbox-dry-run", _) => "发件箱发送演练",
        _ => "后台任务",
    }
}

fn folder_id_for_role(conn: &Connection, role: &str) -> MailResult<i64> {
    let account = account_for_conn(conn, None)?;
    folder_id_for_account_role(conn, account.id, role)
}

fn create_default_folders_for_account(conn: &Connection, account_id: i64) -> MailResult<()> {
    for (name, role, sort_order) in [
        ("收件箱", "inbox", 10),
        ("已发送", "sent", 20),
        ("草稿", "drafts", 30),
        ("发件箱", "outbox", 35),
        ("稍后处理", "snoozed", 36),
        ("归档", "archive", 40),
        ("废纸篓", "trash", 50),
        ("垃圾邮件", "spam", 60),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO folders(account_id, name, role, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![account_id, name, role, sort_order],
        )?;
    }
    Ok(())
}

fn folder_id_for_account_role(conn: &Connection, account_id: i64, role: &str) -> MailResult<i64> {
    conn.query_row(
        "SELECT id FROM folders WHERE account_id = ?1 AND role = ?2 LIMIT 1",
        params![account_id, role],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| MailError::MissingFolderRole(role.to_string()))
}

fn folder_id_for_message_role(conn: &Connection, message_id: i64, role: &str) -> MailResult<i64> {
    let account_id: i64 = conn.query_row(
        "SELECT account_id FROM messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    )?;
    folder_id_for_account_role(conn, account_id, role)
}

fn folder_for_conn(conn: &Connection, folder_id: i64) -> MailResult<Folder> {
    conn.query_row(
        "
        SELECT f.id, f.account_id, f.name, f.role,
            COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
        FROM folders f
        LEFT JOIN messages m ON m.folder_id = f.id
        WHERE f.id = ?1
        GROUP BY f.id, f.account_id, f.name, f.role
        ",
        params![folder_id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                account_id: Some(row.get(1)?),
                name: row.get(2)?,
                role: row.get(3)?,
                unread_count: row.get(4)?,
                is_virtual: false,
            })
        },
    )
    .map_err(Into::into)
}

fn normalized_custom_folder_name(name: &str) -> MailResult<String> {
    let normalized = name.trim();
    if normalized.is_empty() {
        return Err(MailError::Imap("请输入自定义文件夹名称。".to_string()));
    }
    if normalized.chars().count() > 48 {
        return Err(MailError::Imap(
            "文件夹名称不能超过 48 个字符。".to_string(),
        ));
    }
    Ok(normalized.to_string())
}

fn ensure_custom_folder_name_available(
    conn: &Connection,
    account_id: i64,
    name: &str,
    current_folder_id: Option<i64>,
) -> MailResult<()> {
    let existing: Option<i64> = conn
        .query_row(
            "
            SELECT id FROM folders
            WHERE account_id = ?1 AND LOWER(name) = LOWER(?2)
            LIMIT 1
            ",
            params![account_id, name],
            |row| row.get(0),
        )
        .optional()?;
    if existing.is_some_and(|id| Some(id) != current_folder_id) {
        return Err(MailError::Imap("同名文件夹已存在。".to_string()));
    }
    Ok(())
}

fn is_custom_folder_role(role: &str) -> bool {
    role.starts_with("custom:")
}

fn virtual_folder_id(role: &str) -> i64 {
    match role {
        "inbox" => -1,
        "sent" => -2,
        "drafts" => -3,
        "archive" => -4,
        "trash" => -5,
        "spam" => -6,
        "custom" => -7,
        "outbox" => -8,
        "snoozed" => -9,
        _ => -99,
    }
}

fn role_for_virtual_folder_id(folder_id: i64) -> Option<&'static str> {
    match folder_id {
        -1 => Some("inbox"),
        -2 => Some("sent"),
        -3 => Some("drafts"),
        -4 => Some("archive"),
        -5 => Some("trash"),
        -6 => Some("spam"),
        -7 => Some("custom"),
        -8 => Some("outbox"),
        -9 => Some("snoozed"),
        _ => None,
    }
}

fn folder_name_for_role(role: &str) -> &str {
    match role {
        "inbox" => "统一收件箱",
        "sent" => "全部已发送",
        "drafts" => "全部草稿",
        "archive" => "全部归档",
        "trash" => "全部废纸篓",
        "spam" => "全部垃圾邮件",
        "outbox" => "全部发件箱",
        "snoozed" => "全部稍后处理",
        _ => "全部自定义文件夹",
    }
}

fn list_imap_mailboxes_for_conn(
    conn: &Connection,
    account_id: Option<i64>,
) -> MailResult<Vec<ImapMailboxState>> {
    let account_filter = if account_id.is_some() {
        "WHERE m.account_id = ? "
    } else {
        ""
    };
    let mut stmt = conn.prepare(&format!(
        "
        SELECT m.id, m.account_id, a.email, m.remote_name, m.delimiter, m.attributes,
               m.local_role, m.local_folder_id, COALESCE(f.name, ''),
               m.uid_validity, m.highest_uid, m.lowest_uid, m.history_complete,
               m.history_last_sync_at, m.last_seen_at, m.last_sync_at
        FROM imap_mailboxes m
        JOIN accounts a ON a.id = m.account_id
        LEFT JOIN folders f ON f.id = m.local_folder_id
        {account_filter}
        ORDER BY
            CASE WHEN m.last_sync_at = '' THEN 0 ELSE 1 END,
            m.last_sync_at ASC,
            a.id ASC,
            CASE local_role
                WHEN 'inbox' THEN 1
                WHEN 'sent' THEN 2
                WHEN 'drafts' THEN 3
                WHEN 'archive' THEN 4
                WHEN 'trash' THEN 5
                WHEN 'spam' THEN 6
                ELSE 20
            END,
            m.remote_name
        LIMIT 200
        ",
    ))?;
    let params = account_id
        .map(Value::Integer)
        .into_iter()
        .collect::<Vec<_>>();
    let rows = stmt
        .query_map(params_from_iter(params), |row| {
            Ok(ImapMailboxState {
                id: row.get(0)?,
                account_id: row.get(1)?,
                account_email: row.get(2)?,
                remote_name: row.get(3)?,
                delimiter: row.get(4)?,
                attributes: row.get(5)?,
                local_role: row.get(6)?,
                local_folder_id: row.get(7)?,
                local_folder_name: row.get(8)?,
                uid_validity: row.get(9)?,
                highest_uid: row.get(10)?,
                lowest_uid: row.get(11)?,
                history_complete: row.get::<_, i64>(12)? != 0,
                history_last_sync_at: row.get(13)?,
                last_seen_at: row.get(14)?,
                last_sync_at: row.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn import_imap_headers_for_conn(
    conn: &Connection,
    mailbox_id: i64,
    batch: &ImapHeaderBatch,
) -> MailResult<i64> {
    let (account_id, local_role, local_folder_id): (i64, String, Option<i64>) = conn.query_row(
        "SELECT account_id, local_role, local_folder_id FROM imap_mailboxes WHERE id = ?1",
        params![mailbox_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let folder_id = if local_role == "custom" {
        let folder_id = local_folder_id.ok_or_else(|| {
            MailError::Imap(
                "远端自定义目录尚未建立本地映射，已跳过导入以避免误归入收件箱。".to_string(),
            )
        })?;
        let folder = folder_for_conn(conn, folder_id)?;
        if folder.account_id != Some(account_id) || !is_custom_folder_role(&folder.role) {
            return Err(MailError::Imap(
                "远端自定义目录的本地映射无效，请重新选择文件夹。".to_string(),
            ));
        }
        folder_id
    } else {
        folder_id_for_account_role(conn, account_id, &local_role)?
    };
    let mut imported_messages = 0;

    if batch.cursor_reset {
        conn.execute(
            "
            DELETE FROM messages
            WHERE account_id = ?1
              AND remote_mailbox = ?2
              AND remote_uid > 0
            ",
            params![account_id, batch.remote_name],
        )?;
    }

    for header in &batch.headers {
        let thread_key = thread_key_for_message(
            &header.subject,
            &header.message_id,
            &header.in_reply_to,
            &header.references,
        );
        if !header.message_id.trim().is_empty() {
            let rebound = conn.execute(
                "
                UPDATE messages
                SET folder_id = ?1,
                    remote_mailbox = ?2,
                    remote_uid = ?3,
                    message_id_header = ?5,
                    in_reply_to_header = ?8,
                    references_header = ?9,
                    thread_key = ?10,
                    is_read = ?6,
                    is_starred = ?7
                WHERE id = (
                    SELECT id
                    FROM messages
                    WHERE account_id = ?4
                      AND remote_mailbox = ?2
                      AND remote_uid = 0
                      AND message_id_header = ?5
                    ORDER BY id ASC
                    LIMIT 1
                )
                ",
                params![
                    folder_id,
                    batch.remote_name,
                    header.remote_uid,
                    account_id,
                    header.message_id,
                    bool_to_int(header.is_read),
                    bool_to_int(header.is_starred),
                    header.in_reply_to,
                    header.references,
                    thread_key
                ],
            )?;
            if rebound > 0 {
                continue;
            }
        }

        let updated = conn.execute(
            "
            UPDATE messages
            SET folder_id = ?1,
                is_read = ?2,
                is_starred = ?3,
                message_id_header = ?7,
                in_reply_to_header = ?8,
                references_header = ?9,
                thread_key = ?10
            WHERE account_id = ?4
              AND remote_mailbox = ?5
              AND remote_uid = ?6
            ",
            params![
                folder_id,
                bool_to_int(header.is_read),
                bool_to_int(header.is_starred),
                account_id,
                batch.remote_name,
                header.remote_uid,
                header.message_id,
                header.in_reply_to,
                header.references,
                thread_key
            ],
        )?;
        if updated > 0 {
            continue;
        }

        let changed = conn.execute(
            "
            INSERT OR IGNORE INTO messages(
                account_id, folder_id, sender_name, sender_email, recipients, subject,
                snippet, body, received_at, is_read, is_starred, has_attachments,
                thread_key, remote_mailbox, remote_uid, message_id_header,
                in_reply_to_header, references_header
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, ?9, ?10, 0, ?11, ?12, ?13, ?14, ?15, ?16)
            ",
            params![
                account_id,
                folder_id,
                header.sender_name,
                header.sender_email,
                header.recipients,
                header.subject,
                header.snippet,
                header.received_at,
                bool_to_int(header.is_read),
                bool_to_int(header.is_starred),
                thread_key,
                batch.remote_name,
                header.remote_uid,
                header.message_id,
                header.in_reply_to,
                header.references
            ],
        )?;
        if changed > 0 {
            let message_id = conn.last_insert_rowid();
            apply_enabled_rules_for_message(conn, message_id)?;
        }
        imported_messages += changed as i64;
    }

    conn.execute(
        "
        UPDATE imap_mailboxes
        SET uid_validity = ?2,
            highest_uid = CASE
                WHEN ?7 = 1 THEN ?3
                ELSE MAX(highest_uid, ?3)
            END,
            lowest_uid = CASE
                WHEN ?7 = 1 THEN ?4
                WHEN ?4 <= 0 THEN lowest_uid
                WHEN lowest_uid <= 0 THEN ?4
                ELSE MIN(lowest_uid, ?4)
            END,
            history_complete = ?5,
            history_last_sync_at = CASE
                WHEN ?6 = 1 THEN ?8
                ELSE history_last_sync_at
            END,
            last_sync_at = ?8
        WHERE id = ?1
        ",
        params![
            mailbox_id,
            batch.uid_validity,
            batch.highest_uid,
            batch.lowest_uid,
            bool_to_int(batch.history_complete),
            bool_to_int(batch.history_scanned),
            bool_to_int(batch.cursor_reset),
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(imported_messages)
}

fn reconcile_imap_flag_snapshot_for_conn(
    conn: &Connection,
    mailbox_id: i64,
    snapshot: &ImapFlagSnapshot,
) -> MailResult<ImapReconcileResult> {
    let (account_id, remote_name): (i64, String) = conn.query_row(
        "SELECT account_id, remote_name FROM imap_mailboxes WHERE id = ?1",
        params![mailbox_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let mut updated_messages = 0_i64;
    let remote_uids = snapshot
        .states
        .iter()
        .map(|state| state.remote_uid)
        .filter(|uid| *uid > 0)
        .collect::<BTreeSet<_>>();

    for state in &snapshot.states {
        updated_messages += conn.execute(
            "
            UPDATE messages
            SET is_read = ?1,
                is_starred = ?2
            WHERE account_id = ?3
              AND remote_mailbox = ?4
              AND remote_uid = ?5
              AND (is_read <> ?1 OR is_starred <> ?2)
            ",
            params![
                bool_to_int(state.is_read),
                bool_to_int(state.is_starred),
                account_id,
                remote_name,
                state.remote_uid
            ],
        )? as i64;
    }

    let should_scan_local = snapshot.complete || snapshot.floor_uid > 0;
    let mut removed_messages = 0_i64;
    if should_scan_local {
        let mut stmt = if snapshot.complete {
            conn.prepare(
                "
                SELECT id, remote_uid
                FROM messages
                WHERE account_id = ?1
                  AND remote_mailbox = ?2
                  AND remote_uid > 0
                ",
            )?
        } else {
            conn.prepare(
                "
                SELECT id, remote_uid
                FROM messages
                WHERE account_id = ?1
                  AND remote_mailbox = ?2
                  AND remote_uid >= ?3
                ",
            )?
        };
        let local_rows = if snapshot.complete {
            stmt.query_map(params![account_id, remote_name], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map(
                params![account_id, remote_name, snapshot.floor_uid],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )?
            .collect::<Result<Vec<_>, _>>()?
        };
        for (message_id, remote_uid) in local_rows {
            if !remote_uids.contains(&remote_uid) {
                removed_messages +=
                    conn.execute("DELETE FROM messages WHERE id = ?1", params![message_id])? as i64;
            }
        }
    }

    Ok(ImapReconcileResult {
        updated_messages,
        removed_messages,
    })
}

fn infer_local_role(remote_name: &str, attributes: &[String]) -> String {
    let normalized = remote_name.to_ascii_lowercase();
    let joined_attributes = attributes.join(" ").to_ascii_lowercase();
    if normalized == "inbox" || joined_attributes.contains("inbox") {
        "inbox"
    } else if joined_attributes.contains("sent")
        || normalized.contains("sent")
        || normalized.contains("已发送")
    {
        "sent"
    } else if joined_attributes.contains("draft")
        || normalized.contains("draft")
        || normalized.contains("草稿")
    {
        "drafts"
    } else if joined_attributes.contains("trash")
        || normalized.contains("trash")
        || normalized.contains("deleted")
        || normalized.contains("废纸")
    {
        "trash"
    } else if joined_attributes.contains("junk")
        || normalized.contains("spam")
        || normalized.contains("junk")
        || normalized.contains("垃圾")
    {
        "spam"
    } else if joined_attributes.contains("archive")
        || normalized.contains("archive")
        || normalized.contains("归档")
    {
        "archive"
    } else {
        "custom"
    }
    .to_string()
}

fn labels_for_message(conn: &Connection, message_id: i64) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "
        SELECT l.name
        FROM labels l
        JOIN message_labels ml ON ml.label_id = l.id
        WHERE ml.message_id = ?1
        ORDER BY l.name
        ",
    )?;
    let labels = stmt
        .query_map(params![message_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(labels)
}

fn rule_for_conn(conn: &Connection, rule_id: i64) -> MailResult<MailRule> {
    conn.query_row(
        "SELECT id, name, condition, action, enabled FROM mail_rules WHERE id = ?1",
        params![rule_id],
        |row| {
            Ok(MailRule {
                id: row.get(0)?,
                name: row.get(1)?,
                condition: row.get(2)?,
                action: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
            })
        },
    )
    .map_err(Into::into)
}

fn apply_enabled_rules_for_message(conn: &Connection, message_id: i64) -> MailResult<i64> {
    let message = message_for_conn(conn, message_id)?;
    let mut stmt =
        conn.prepare("SELECT condition, action FROM mail_rules WHERE enabled = 1 ORDER BY id")?;
    let rules = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut applied = 0;
    for (condition, action) in rules {
        if rule_matches_message(&condition, &message) {
            let (action_count, should_stop) = apply_rule_actions(conn, message_id, &action)?;
            applied += action_count;
            if should_stop {
                break;
            }
        }
    }
    Ok(applied)
}

fn rule_matches_message(condition: &str, message: &Message) -> bool {
    let normalized = condition.trim().to_lowercase();
    let Some((field, needle)) = normalized.split_once(" contains ") else {
        return false;
    };
    let haystack = match field.trim() {
        "from" | "sender" => format!("{} {}", message.sender_name, message.sender_email),
        "subject" => message.subject.clone(),
        "body" => format!("{} {}", message.snippet, message.body),
        "to" | "recipients" => message.recipients.clone(),
        _ => return false,
    }
    .to_lowercase();
    haystack.contains(needle.trim())
}

fn apply_rule_actions(
    conn: &Connection,
    message_id: i64,
    actions: &str,
) -> MailResult<(i64, bool)> {
    let mut applied = 0;
    let mut should_stop = false;
    for action in actions
        .split(';')
        .map(str::trim)
        .filter(|action| !action.is_empty())
    {
        if matches!(action.to_lowercase().as_str(), "stop" | "stop processing") {
            should_stop = true;
            continue;
        }
        applied += apply_rule_action(conn, message_id, action)?;
    }
    Ok((applied, should_stop))
}

fn apply_rule_action(conn: &Connection, message_id: i64, action: &str) -> MailResult<i64> {
    let trimmed = action.trim();
    let normalized = trimmed.to_lowercase();
    if let Some(label_name) = normalized
        .strip_prefix("apply label ")
        .and_then(|_| trimmed.get("apply label ".len()..))
    {
        let label_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM labels WHERE lower(name) = lower(?1) LIMIT 1",
                params![label_name.trim()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(label_id) = label_id {
            conn.execute(
                "INSERT OR IGNORE INTO message_labels(message_id, label_id) VALUES (?1, ?2)",
                params![message_id, label_id],
            )?;
            return Ok(1);
        }
        return Ok(0);
    }
    if let Some(role) = normalized.strip_prefix("move to ") {
        let folder_id = folder_id_for_message_role(conn, message_id, role.trim())?;
        conn.execute(
            "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
            params![folder_id, message_id],
        )?;
        return Ok(1);
    }
    if normalized == "mark read" || normalized == "mark as read" {
        conn.execute(
            "UPDATE messages SET is_read = 1 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "mark unread" || normalized == "mark as unread" {
        conn.execute(
            "UPDATE messages SET is_read = 0 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "star" || normalized == "mark starred" {
        conn.execute(
            "UPDATE messages SET is_starred = 1 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "unstar" || normalized == "clear star" || normalized == "mark unstarred" {
        conn.execute(
            "UPDATE messages SET is_starred = 0 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    Ok(0)
}

fn attachment_count_for_message(conn: &Connection, message_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM attachments WHERE message_id = ?1",
        params![message_id],
        |row| row.get(0),
    )
}

fn attachments_for_message_conn(
    conn: &Connection,
    message_id: i64,
) -> rusqlite::Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
                local_path, content_id, is_inline
         FROM attachments WHERE message_id = ?1 ORDER BY filename",
    )?;
    let attachments = stmt
        .query_map(params![message_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                message_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size_bytes: row.get(4)?,
                is_downloaded: row.get::<_, i64>(5)? != 0,
                local_path: row.get(6)?,
                content_id: row.get(7)?,
                is_inline: row.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(attachments)
}

fn attachment_for_conn(conn: &Connection, attachment_id: i64) -> MailResult<Attachment> {
    conn.query_row(
        "
        SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
               local_path, content_id, is_inline
        FROM attachments
        WHERE id = ?1
        ",
        params![attachment_id],
        |row| {
            Ok(Attachment {
                id: row.get(0)?,
                message_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size_bytes: row.get(4)?,
                is_downloaded: row.get::<_, i64>(5)? != 0,
                local_path: row.get(6)?,
                content_id: row.get(7)?,
                is_inline: row.get::<_, i64>(8)? != 0,
            })
        },
    )
    .map_err(Into::into)
}

fn scalar_count_values(conn: &Connection, sql: &str, values: Vec<Value>) -> MailResult<i64> {
    conn.query_row(sql, params_from_iter(values), |row| row.get(0))
        .map_err(Into::into)
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn normalized_subject(subject: &str) -> String {
    if subject.trim().is_empty() {
        "(无主题)".to_string()
    } else {
        subject.trim().to_string()
    }
}

fn normalized_thread_subject(subject: &str) -> String {
    let mut normalized = normalized_subject(subject);
    loop {
        let lower = normalized.to_lowercase();
        let prefix = [
            "re:",
            "re：",
            "fwd:",
            "fwd：",
            "fw:",
            "fw：",
            "回复:",
            "回复：",
            "转发:",
            "转发：",
        ]
        .into_iter()
        .find(|prefix| lower.starts_with(prefix));
        let Some(prefix) = prefix else {
            break;
        };
        normalized = normalized[prefix.len()..].trim_start().to_string();
        if normalized.is_empty() {
            return "(无主题)".to_string();
        }
    }
    normalized
}

fn first_message_id(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .map(|token| token.trim_matches([',', ';']))
        .find(|token| {
            token.len() > 2
                && token.starts_with('<')
                && token.ends_with('>')
                && !token.contains(['\r', '\n'])
        })
        .map(|token| token.to_ascii_lowercase())
}

fn thread_key_for_message(
    subject: &str,
    message_id_header: &str,
    in_reply_to_header: &str,
    references_header: &str,
) -> String {
    first_message_id(references_header)
        .or_else(|| first_message_id(in_reply_to_header))
        .or_else(|| first_message_id(message_id_header))
        .map(|message_id| format!("msgid:{message_id}"))
        .unwrap_or_else(|| {
            format!(
                "subject:{}",
                normalized_thread_subject(subject).to_lowercase()
            )
        })
}

fn normalize_thread_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn snippet_from_body(body: &str) -> String {
    body.lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

fn database_storage_bytes(database_path: &Path) -> i64 {
    [
        database_path.to_path_buf(),
        path_with_suffix(database_path, "-wal"),
        path_with_suffix(database_path, "-shm"),
    ]
    .iter()
    .filter_map(|path| fs::metadata(path).ok())
    .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
    .fold(0_i64, i64::saturating_add)
}

fn is_managed_attachment_path(root: &Path, path: &Path) -> bool {
    path.is_absolute()
        && path.starts_with(root)
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}

fn is_partial_attachment_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("download" | "decoded")
    )
}

fn collect_regular_files(root: &Path) -> MailResult<Vec<(PathBuf, i64)>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_regular_files_into(root, &mut files)?;
    Ok(files)
}

fn collect_regular_files_into(root: &Path, files: &mut Vec<(PathBuf, i64)>) -> MailResult<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_regular_files_into(&path, files)?;
        } else if file_type.is_file() {
            files.push((path, entry.metadata()?.len().min(i64::MAX as u64) as i64));
        }
    }
    Ok(())
}

fn prune_empty_directories(root: &Path, preserve_root: bool) -> MailResult<bool> {
    if !root.exists() {
        return Ok(true);
    }
    let mut empty = true;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || file_type.is_file() {
            empty = false;
            continue;
        }
        if file_type.is_dir() && !prune_empty_directories(&entry.path(), false)? {
            empty = false;
        }
    }
    if empty && !preserve_root {
        fs::remove_dir(root)?;
    }
    Ok(empty)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_store() -> MailStore {
        let unique = TEST_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let data_dir = std::env::temp_dir().join(format!(
            "better-email-test-{}-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap(),
            unique
        ));
        fs::create_dir_all(&data_dir).expect("test data dir created");
        let path = data_dir.join(DATABASE_FILENAME);
        MailStore::open_at(path).expect("test store opens")
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
            "m.received_at ASC, m.id ASC"
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
        assert!(body_matches
            .iter()
            .any(|message| message.body.contains("SQLite FTS5")));
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
        assert_eq!(released.len(), 1);
        assert_eq!(released[0].id, due);
        assert_eq!(released[0].folder_role, "inbox");
        assert!(released[0].snoozed_until.is_empty());

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
    fn draft_and_sent_messages_are_saved_to_expected_folders() {
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
        let sent = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "sent")
            .unwrap();
        assert!(store
            .list_messages_for_scope(None, drafts.id, Some("Hello".to_string()), None, 10)
            .unwrap()
            .iter()
            .any(|message| message.id == draft_id));
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
        assert!(outbox_message.body.contains("Support signature"));

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
        let drafts = store
            .list_folders_for_account(Some(account.id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let saved_draft = store
            .list_messages_for_scope(None, drafts.id, Some("HTML Draft".to_string()), None, 10)
            .unwrap()
            .into_iter()
            .find(|message| message.id == draft_id)
            .unwrap();
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

        let drafts = store
            .list_folders_for_account(Some(store.get_account().unwrap().id))
            .unwrap()
            .into_iter()
            .find(|folder| folder.role == "drafts")
            .unwrap();
        let saved_draft = store
            .list_messages_for_scope(
                None,
                drafts.id,
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
                    sync_mode: "15min".to_string(),
                    remote_images_allowed: true,
                    signature: "Regards".to_string(),
                },
            )
            .unwrap();
        assert_eq!(account.display_name, "New Name");
        assert_eq!(account.auth_type, "oauth2");
        assert!(account.remote_images_allowed);
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
            let store = MailStore::open_at(path.clone()).expect("test store opens");
            let account = store.get_account().expect("seed account exists");
            assert!(store.delete_account(account.id).unwrap().is_none());
            assert!(store.list_accounts().unwrap().is_empty());
        }

        let reopened = MailStore::open_at(path).expect("empty account store reopens");
        assert!(reopened.list_accounts().unwrap().is_empty());
        assert!(reopened.get_account_by_id_optional(None).unwrap().is_none());
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
            store.import_imap_headers_batch(mailbox.id, &batch).unwrap(),
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
            store.import_imap_headers_batch(mailbox.id, &batch).unwrap(),
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
                .unwrap(),
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
            store.import_imap_headers_batch(mailbox.id, &batch).unwrap(),
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
                .unwrap(),
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
    fn contact_merge_suggestions_find_alias_and_name_matches() {
        let store = test_store();
        let target = store
            .list_contacts()
            .unwrap()
            .into_iter()
            .find(|contact| contact.email == "ada@example.com")
            .unwrap();
        let duplicate = store
            .create_contact(ContactCreateInput {
                name: "Ada".to_string(),
                email: "ada.duplicate@example.com".to_string(),
                aliases: vec!["ada@example.com".to_string()],
                vip: false,
            })
            .unwrap();

        let suggestions = store.list_contact_merge_suggestions().unwrap();
        let suggestion = suggestions
            .iter()
            .find(|suggestion| {
                (suggestion.target.id == target.id && suggestion.source.id == duplicate.id)
                    || (suggestion.target.id == duplicate.id && suggestion.source.id == target.id)
            })
            .unwrap();
        assert!(suggestion
            .shared_keys
            .contains(&"ada@example.com".to_string()));
        assert_eq!(suggestion.reason, "邮箱或别名重叠");
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
            })
            .unwrap();
        let duplicate_sync = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "sync".to_string(),
                source: "timer".to_string(),
            })
            .unwrap();
        assert_eq!(first_sync.id, duplicate_sync.id);
        assert_eq!(first_sync.status, "queued");

        let outbox_task = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "outbox-smtp".to_string(),
                source: "manual".to_string(),
            })
            .unwrap();
        assert_ne!(first_sync.id, outbox_task.id);
        let duplicate_outbox = store
            .enqueue_background_task(BackgroundTaskInput {
                kind: "outbox-smtp".to_string(),
                source: "timer".to_string(),
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
            .fail_background_task(outbox_task.id, "SMTP 失败")
            .unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.message, "SMTP 失败");

        let tasks = store.list_background_tasks().unwrap();
        assert!(tasks.iter().any(|task| task.id == completed.id));
        assert!(tasks.iter().any(|task| task.id == failed.id));
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

        let imported = store.import_eml_message(None, raw).unwrap();
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
        let local_message = store.import_eml_message(None, local_raw).unwrap();
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
}
