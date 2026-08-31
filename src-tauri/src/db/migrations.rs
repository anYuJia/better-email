use super::accounts::ensure_default_account_for_conn;
use super::accounts::ensure_default_identities_for_conn;
use super::*;

impl MailStore {
    pub(super) fn migrate(&self) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = 5000;
                PRAGMA synchronous = NORMAL;
                PRAGMA wal_autocheckpoint = 1000;

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
                    auto_download_attachments INTEGER NOT NULL DEFAULT 0,
                    fetch_history_attachments INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS account_credentials (
                    account_email TEXT PRIMARY KEY,
                    secret TEXT NOT NULL,
                    updated_at TEXT NOT NULL
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
                    content_sha256 TEXT NOT NULL DEFAULT '',
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
                    new_messages INTEGER NOT NULL DEFAULT 0,
                    message TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL,
                    aliases TEXT NOT NULL DEFAULT '',
                    vip INTEGER NOT NULL DEFAULT 0,
                    message_count INTEGER NOT NULL DEFAULT 0,
                    last_seen_at TEXT NOT NULL,
                    UNIQUE(account_id, email)
                );

                CREATE TABLE IF NOT EXISTS contact_sent_messages (
                    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    email TEXT NOT NULL,
                    scanned_at TEXT NOT NULL,
                    PRIMARY KEY (message_id, email)
                );

                CREATE TABLE IF NOT EXISTS contact_sync_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    initial_scan_completed INTEGER NOT NULL DEFAULT 0,
                    last_scanned_at TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS mail_rules (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id) ON DELETE CASCADE,
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

                CREATE TABLE IF NOT EXISTS ai_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    enabled INTEGER NOT NULL DEFAULT 0,
                    service_type TEXT NOT NULL DEFAULT 'mock',
                    endpoint TEXT NOT NULL DEFAULT '',
                    api_key TEXT NOT NULL DEFAULT '',
                    model TEXT NOT NULL DEFAULT '',
                    timeout_seconds INTEGER NOT NULL DEFAULT 30,
                    privacy_acknowledged INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS app_settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    default_download_dir TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS contact_import_batches (
                    id INTEGER PRIMARY KEY,
                    account_id INTEGER NOT NULL DEFAULT 1 REFERENCES accounts(id) ON DELETE CASCADE,
                    file_name TEXT NOT NULL,
                    total_count INTEGER NOT NULL,
                    created_count INTEGER NOT NULL,
                    merged_count INTEGER NOT NULL,
                    skipped_count INTEGER NOT NULL,
                    scope TEXT NOT NULL DEFAULT 'global',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS contact_import_entries (
                    id INTEGER PRIMARY KEY,
                    batch_id INTEGER NOT NULL REFERENCES contact_import_batches(id) ON DELETE CASCADE,
                    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
                    email TEXT NOT NULL,
                    action TEXT NOT NULL
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

                CREATE TABLE IF NOT EXISTS pending_remote_writes (
                    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL,
                    value TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (message_id, kind)
                );

                CREATE TABLE IF NOT EXISTS outbound_attachment_auths (
                    id INTEGER PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    size_bytes INTEGER NOT NULL,
                    content_sha256 TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL
                );
                ",
            )?;

            add_column_if_missing(conn, "accounts", "imap_host", "TEXT NOT NULL DEFAULT ''")?;
            add_column_if_missing(
                conn,
                "outbound_attachment_auths",
                "content_sha256",
                "TEXT NOT NULL DEFAULT ''",
            )?;
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
                "cross_account_risk_warning",
                "INTEGER NOT NULL DEFAULT 1",
            )?;
            add_column_if_missing(
                conn,
                "accounts",
                "block_external_mailboxes",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "accounts",
                "intercept_https_links",
                "INTEGER NOT NULL DEFAULT 1",
            )?;
            add_column_if_missing(
                conn,
                "accounts",
                "auto_download_attachments",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "accounts",
                "fetch_history_attachments",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "accounts",
                "warn_external_senders",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            {
                // 首次登录引导只面向「新完成登录」的账号：
                // 存量账号在升级后视为已完成引导，避免老用户被强制引导。
                let mut stmt = conn.prepare("PRAGMA table_info(accounts)")?;
                let existed = stmt
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?
                    .iter()
                    .any(|name| name == "onboarding_completed");
                drop(stmt);
                add_column_if_missing(
                    conn,
                    "accounts",
                    "onboarding_completed",
                    "INTEGER NOT NULL DEFAULT 0",
                )?;
                if !existed {
                    conn.execute("UPDATE accounts SET onboarding_completed = 1", [])?;
                }
            }
            add_column_if_missing(
                conn,
                "accounts",
                "is_default",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "account_credentials",
                "updated_at",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "background_tasks",
                "account_id",
                "INTEGER REFERENCES accounts(id) ON DELETE CASCADE",
            )?;
            add_column_if_missing(
                conn,
                "background_tasks",
                "cancel_requested",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "background_tasks",
                "progress",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            // 应用重启恢复：运行中的任务不可能继续，标记为失败以便重试；
            // 排队中的任务保留，由前端启动时重新 drain。
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'failed', message = '应用重启时中断，可重试'
                WHERE status = 'running'
                ",
                [],
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
            add_column_if_missing(
                conn,
                "ai_settings",
                "mcp_enabled",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            add_column_if_missing(
                conn,
                "ai_settings",
                "mcp_endpoint",
                "TEXT NOT NULL DEFAULT ''",
            )?;
            add_column_if_missing(
                conn,
                "ai_settings",
                "mcp_api_key",
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
                "content_sha256",
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
                "mail_rules",
                "account_id",
                "INTEGER REFERENCES accounts(id) ON DELETE CASCADE",
            )?;
            ensure_account_scoped_rules(conn)?;
            add_column_if_missing(
                conn,
                "contact_import_batches",
                "account_id",
                "INTEGER REFERENCES accounts(id) ON DELETE CASCADE",
            )?;
            ensure_account_scoped_import_batches(conn)?;
            migrate_account_scoped_contacts_if_needed(conn)?;
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
            // 兼容列必须在建索引、触发器与 FTS 外部内容表之前补齐：
            // 旧库缺 remote_uid/remote_mailbox 等列时，若先建依赖这些列的
            // 数据库对象会导致启动永久失败。此处统一在列补齐后创建。
            conn.execute_batch(
                "
                CREATE INDEX IF NOT EXISTS idx_messages_folder_time ON messages(folder_id, received_at DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_time_instant
                    ON messages(julianday(received_at) DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_account_time_instant
                    ON messages(account_id, julianday(received_at) DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_folder_time_instant
                    ON messages(folder_id, julianday(received_at) DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_thread_latest
                    ON messages(thread_key, received_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_account_thread_latest
                    ON messages(account_id, thread_key, received_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(folder_id, is_read);
                CREATE INDEX IF NOT EXISTS idx_messages_subject_like ON messages(subject);
                CREATE INDEX IF NOT EXISTS idx_messages_sender_like ON messages(sender_name, sender_email);
                CREATE INDEX IF NOT EXISTS idx_messages_recipients_like ON messages(recipients);
                CREATE INDEX IF NOT EXISTS idx_messages_snippet_like ON messages(snippet);
                CREATE INDEX IF NOT EXISTS idx_muted_threads_key ON muted_threads(thread_key);
                CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels(label_id);
                CREATE INDEX IF NOT EXISTS idx_mail_identities_account ON mail_identities(account_id, is_default DESC);
                CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
                CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_contacts_account_email ON contacts(account_id, email);
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
                CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages
                WHEN old.subject IS NOT new.subject
                  OR old.sender_name IS NOT new.sender_name
                  OR old.sender_email IS NOT new.sender_email
                  OR old.recipients IS NOT new.recipients
                  OR old.snippet IS NOT new.snippet
                  OR old.body IS NOT new.body
                BEGIN
                    INSERT INTO message_search(message_search, rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES('delete', old.id, old.subject, old.sender_name, old.sender_email, old.recipients, old.snippet, old.body);
                    INSERT INTO message_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
                    VALUES (new.id, new.subject, new.sender_name, new.sender_email, new.recipients, new.snippet, new.body);
                END;
                ",
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
            migrate_fts_update_trigger_if_needed(conn)?;
            ensure_default_identities_for_conn(conn)?;
            add_column_if_missing(
                conn,
                "sync_runs",
                "new_messages",
                "INTEGER NOT NULL DEFAULT 0",
            )?;
            Ok(())
        })
    }
}

pub(super) fn migrate_legacy_database(data_dir: &Path, database_path: &Path) -> MailResult<()> {
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
pub(super) fn copy_database_file(source: &Path, destination: &Path) -> MailResult<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    Ok(())
}
pub(super) fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}
pub(super) fn add_column_if_missing(
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

fn table_has_column(conn: &Connection, table: &str, column: &str) -> MailResult<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns.iter().any(|name| name == column))
}

fn default_account_id_optional(conn: &Connection) -> MailResult<Option<i64>> {
    conn.query_row(
        "SELECT id FROM accounts ORDER BY is_default DESC, id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// 为旧数据库中的规则补齐账号归属。规则没有复杂外键关系，只需补列并把
/// 历史全局规则归到默认账号；新建规则由命令层显式写入账号 ID。
fn ensure_account_scoped_rules(conn: &Connection) -> MailResult<()> {
    if !table_has_column(conn, "mail_rules", "account_id")? {
        return Ok(());
    }
    let Some(account_id) = default_account_id_optional(conn)? else {
        // A brand-new database is migrated before demo data is seeded, so there
        // is intentionally no account at this point.
        return Ok(());
    };
    conn.execute(
        "UPDATE mail_rules
         SET account_id = ?1
         WHERE account_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM accounts WHERE accounts.id = mail_rules.account_id)",
        params![account_id],
    )?;
    Ok(())
}

fn ensure_account_scoped_import_batches(conn: &Connection) -> MailResult<()> {
    if !table_has_column(conn, "contact_import_batches", "account_id")? {
        return Ok(());
    }
    let Some(account_id) = default_account_id_optional(conn)? else {
        return Ok(());
    };
    conn.execute(
        "UPDATE contact_import_batches
         SET account_id = ?1
         WHERE account_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM accounts WHERE accounts.id = contact_import_batches.account_id)",
        params![account_id],
    )?;
    Ok(())
}

/// 联系人旧表使用 email 全局唯一，无法通过简单 ADD COLUMN 实现账号隔离。
/// 这里重建表并根据已发送邮件的 account_id 复制历史联系人；没有关联邮件的
/// 手动/导入联系人归入默认账号。旧联系人 ID 会保留给第一个账号，保证导入
/// 撤销记录仍然有效，额外账号使用新的自增 ID。
fn migrate_account_scoped_contacts_if_needed(conn: &Connection) -> MailResult<()> {
    if table_has_column(conn, "contacts", "account_id")? {
        return Ok(());
    }

    let Some(default_account_id) = default_account_id_optional(conn)? else {
        // A brand-new database is migrated before demo data is seeded. There is
        // no legacy contact to migrate until an account exists.
        return Ok(());
    };
    let legacy_contacts = {
        let mut stmt = conn.prepare(
            "SELECT id, name, email, aliases, vip, message_count, last_seen_at FROM contacts ORDER BY id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
    };

    conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE TRANSACTION;")?;
    let result = (|| -> MailResult<()> {
        conn.execute_batch(
            "
            CREATE TABLE contacts_account_scoped_new (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                aliases TEXT NOT NULL DEFAULT '',
                vip INTEGER NOT NULL DEFAULT 0,
                message_count INTEGER NOT NULL DEFAULT 0,
                last_seen_at TEXT NOT NULL,
                UNIQUE(account_id, email)
            );
            CREATE TABLE contact_import_entries_account_scoped_new (
                id INTEGER PRIMARY KEY,
                batch_id INTEGER NOT NULL REFERENCES contact_import_batches(id) ON DELETE CASCADE,
                contact_id INTEGER REFERENCES contacts_account_scoped_new(id) ON DELETE CASCADE,
                email TEXT NOT NULL,
                action TEXT NOT NULL
            );
            INSERT INTO contact_import_entries_account_scoped_new(id, batch_id, contact_id, email, action)
                SELECT id, batch_id, contact_id, email, action FROM contact_import_entries;
            ",
        )?;

        for (contact_id, name, email, aliases, vip, message_count, last_seen_at) in legacy_contacts
        {
            let account_ids = {
                let mut stmt = conn.prepare(
                    "SELECT DISTINCT m.account_id
                     FROM contact_sent_messages sent
                     JOIN messages m ON m.id = sent.message_id
                     WHERE lower(sent.email) = lower(?1)
                     ORDER BY m.account_id",
                )?;
                let rows = stmt.query_map(params![email.as_str()], |row| row.get::<_, i64>(0))?;
                rows.collect::<Result<Vec<_>, _>>()?
            };
            let account_ids = if account_ids.is_empty() {
                vec![default_account_id]
            } else {
                account_ids
            };

            for (index, account_id) in account_ids.iter().enumerate() {
                let (derived_count, derived_last_seen): (i64, String) = conn.query_row(
                    "SELECT COUNT(DISTINCT sent.message_id), COALESCE(MAX(m.received_at), '')
                     FROM contact_sent_messages sent
                     JOIN messages m ON m.id = sent.message_id
                     WHERE m.account_id = ?1 AND lower(sent.email) = lower(?2)",
                    params![account_id, email.as_str()],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                let scoped_count = if derived_count > 0 || account_ids.len() > 1 {
                    derived_count
                } else {
                    message_count
                };
                let scoped_last_seen = if derived_last_seen.is_empty() {
                    last_seen_at.as_str()
                } else {
                    derived_last_seen.as_str()
                };
                let preserved_id = (index == 0).then_some(contact_id);
                conn.execute(
                    "INSERT INTO contacts_account_scoped_new(
                        id, account_id, name, email, aliases, vip, message_count, last_seen_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        preserved_id,
                        account_id,
                        name.as_str(),
                        email.as_str(),
                        aliases.as_str(),
                        vip,
                        scoped_count,
                        scoped_last_seen,
                    ],
                )?;
            }
        }

        conn.execute_batch(
            "
            DROP TABLE contact_import_entries;
            DROP TABLE contacts;
            ALTER TABLE contacts_account_scoped_new RENAME TO contacts;
            ALTER TABLE contact_import_entries_account_scoped_new RENAME TO contact_import_entries;
            ",
        )?;
        Ok(())
    })();

    if result.is_err() {
        let _ = conn.execute_batch("ROLLBACK;");
    } else {
        conn.execute_batch("COMMIT;")?;
    }
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
    result
}

pub(super) fn migrate_thread_keys_if_needed(conn: &Connection) -> MailResult<()> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version >= THREAD_KEY_SCHEMA_VERSION {
        return Ok(());
    }
    rebuild_thread_keys_for_conn(conn)?;
    conn.pragma_update(None, "user_version", THREAD_KEY_SCHEMA_VERSION)?;
    Ok(())
}

/// 把 messages_au 触发器升级为「仅在 FTS 索引字段变化时重建」的版本。
///
/// 旧版本对任何 UPDATE（标记已读、星标、移动文件夹等）都会完整删除并重建
/// FTS 索引。只改 `CREATE TRIGGER IF NOT EXISTS` 的文本对已有数据库不生效
/// （触发器已存在会跳过），因此必须先 DROP 再重建，并依赖 user_version 让
/// 迁移只执行一次，确保升级后真实生效。
pub(super) fn migrate_fts_update_trigger_if_needed(conn: &Connection) -> MailResult<()> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version >= FTS_UPDATE_TRIGGER_SCHEMA_VERSION {
        return Ok(());
    }
    conn.execute_batch(
        "
        DROP TRIGGER IF EXISTS messages_au;
        CREATE TRIGGER messages_au AFTER UPDATE ON messages
        WHEN old.subject IS NOT new.subject
          OR old.sender_name IS NOT new.sender_name
          OR old.sender_email IS NOT new.sender_email
          OR old.recipients IS NOT new.recipients
          OR old.snippet IS NOT new.snippet
          OR old.body IS NOT new.body
        BEGIN
            INSERT INTO message_search(message_search, rowid, subject, sender_name, sender_email, recipients, snippet, body)
            VALUES('delete', old.id, old.subject, old.sender_name, old.sender_email, old.recipients, old.snippet, old.body);
            INSERT INTO message_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
            VALUES (new.id, new.subject, new.sender_name, new.sender_email, new.recipients, new.snippet, new.body);
        END;
        ",
    )?;
    conn.pragma_update(None, "user_version", FTS_UPDATE_TRIGGER_SCHEMA_VERSION)?;
    Ok(())
}
pub(super) fn rebuild_thread_keys_for_conn(conn: &Connection) -> MailResult<()> {
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
