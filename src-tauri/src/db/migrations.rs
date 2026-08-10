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
                CREATE TABLE IF NOT EXISTS contact_import_batches (
                    id INTEGER PRIMARY KEY,
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

                CREATE INDEX IF NOT EXISTS idx_messages_folder_time ON messages(folder_id, received_at DESC);
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
pub(super) fn migrate_thread_keys_if_needed(conn: &Connection) -> MailResult<()> {
    let current_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if current_version >= THREAD_KEY_SCHEMA_VERSION {
        return Ok(());
    }
    rebuild_thread_keys_for_conn(conn)?;
    conn.pragma_update(None, "user_version", THREAD_KEY_SCHEMA_VERSION)?;
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
