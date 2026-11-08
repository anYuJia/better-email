use super::accounts::ensure_default_account_for_conn;
use super::messages::bool_to_int;
use super::migrations::rebuild_thread_keys_in_transaction;
use super::*;

impl MailStore {
    pub fn export_local_backup(&self) -> MailResult<LocalBackup> {
        self.with_conn(|conn| {
            let mut tables = BTreeMap::new();
            for table in LOCAL_BACKUP_TABLES {
                tables.insert((*table).to_string(), export_backup_table(conn, table)?);
            }
            let backup = LocalBackup {
                schema_version: LOCAL_BACKUP_SCHEMA_VERSION,
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                exported_at: Utc::now().to_rfc3339(),
                tables,
            };
            validate_local_backup(&backup)?;
            Ok(backup)
        })
    }
    pub fn import_local_backup(&self, backup: &LocalBackup) -> MailResult<()> {
        validate_local_backup(backup)?;
        let _restore_guard = RESTORE_GATE
            .write()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        self.with_conn(|conn| {
            let result = (|| -> MailResult<()> {
                conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;")?;
                // The restore gate excludes live send workers. Any remaining
                // sending row is stale; normalize it inside this transaction so
                // deletion triggers permit restore and rollback is still atomic.
                conn.execute("UPDATE outbox_queue SET status='send_unknown' WHERE status='sending'", [])?;
                // Keep credentials only when their previously trusted endpoint is unchanged.
                conn.execute_batch("CREATE TEMP TABLE restore_credential_accounts AS SELECT email, auth_type, incoming_protocol, imap_host, smtp_host FROM accounts;")?;
                for table in LOCAL_BACKUP_TABLES.iter().rev() {
                    conn.execute(&format!("DELETE FROM {}", quote_identifier(table)), [])?;
                }
                for table in LOCAL_BACKUP_TABLES {
                    if let Some(rows) = backup.tables.get(*table) {
                        import_backup_table(conn, table, rows)?;
                    }
                }
                // A backup can predate successful delivery. Never automatically
                // replay an old queued/retry/scheduled message after restoration.
                // Keep duplicate fingerprints distinguishable while retaining their
                // shared identity for the duplicate-submission guard.
                conn.execute_batch("UPDATE outbox_queue AS q SET submission_fingerprint=q.submission_fingerprint || ':restored:' || q.id
                    WHERE q.status IN ('queued','retry','scheduled') AND q.submission_fingerprint<>''
                      AND EXISTS (SELECT 1 FROM outbox_queue other
                        WHERE other.id<>q.id AND other.submission_fingerprint=q.submission_fingerprint
                          AND (other.status IN ('sending','send_unknown')
                            OR (other.status IN ('queued','retry','scheduled') AND other.id<q.id)));
                    UPDATE outbox_queue SET status='send_unknown', next_attempt_at='',
                      last_error='恢复的备份可能早于实际发送，请先核对已发送文件夹或收件人，再决定如何处理。'
                    WHERE status IN ('queued','retry','scheduled','sending');")?;
                conn.execute_batch("DELETE FROM account_credentials WHERE EXISTS (
                    SELECT 1 FROM accounts a WHERE lower(a.email)=lower(account_credentials.account_email)
                      AND NOT EXISTS (SELECT 1 FROM restore_credential_accounts old
                        WHERE lower(old.email)=lower(a.email) AND old.auth_type=a.auth_type
                          AND old.incoming_protocol=a.incoming_protocol
                          AND old.imap_host=a.imap_host AND old.smtp_host=a.smtp_host)
                ); DROP TABLE restore_credential_accounts;")?;
                // Older backups have no MIME section field; re-fetch structure
                // instead of guessing when duplicate attachment names exist.
                conn.execute("UPDATE messages SET attachment_metadata_synced=0 WHERE remote_uid>0 AND remote_mailbox<>'' AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id=messages.id AND a.remote_part_path='')", [])?;
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
                if !backup.tables.contains_key("contact_sent_messages") {
                    super::contacts_rules::rebuild_contact_observations_for_legacy_backup(conn)?;
                }
                rebuild_thread_keys_in_transaction(conn)?;
                conn.execute_batch(
                    "INSERT INTO message_search(message_search) VALUES('rebuild'); COMMIT;",
                )?;
                RESTORE_GENERATION.fetch_add(1, Ordering::Release);
                Ok(())
            })();

            if result.is_err() {
                let _ = conn.execute_batch("ROLLBACK;");
            }
            let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
            result
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
}

pub(super) fn export_backup_table(
    conn: &Connection,
    table: &str,
) -> MailResult<Vec<LocalBackupRow>> {
    let columns = table_columns(conn, table)?;
    let filtered_columns: Vec<String> = columns
        .into_iter()
        .filter(|col| col != "secret" && col != "authorization_code" && col != "code_verifier")
        .collect();
    let select_columns = filtered_columns
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
            for (index, column) in filtered_columns.iter().enumerate() {
                item.insert(column.clone(), sql_value_to_json(row.get_ref(index)?));
            }
            Ok(item)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
pub(super) fn import_backup_table(
    conn: &Connection,
    table: &str,
    rows: &[LocalBackupRow],
) -> MailResult<()> {
    let columns = table_columns(conn, table)?;
    for row in rows {
        // 不可信备份的安全化：messages 的 sanitized_html/security_warnings 必须
        // 对备份正文和 HTML 重新清洗并生成警告，绝不直接信任备份字段；attachments 的
        // local_path/is_downloaded 一律清空，防止借附件路径读取任意文件。
        let mut normalized = row.clone();
        if table == "messages" {
            let body = row
                .get("body")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let backed_html = row
                .get("sanitized_html")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            let (sanitized_html, security_warnings) = recompute_message_security(body, backed_html);
            normalized.insert("sanitizer_version".into(), serde_json::json!(1));
            normalized.insert(
                "sanitized_html".into(),
                serde_json::Value::String(sanitized_html),
            );
            normalized.insert(
                "security_warnings".into(),
                serde_json::Value::String(security_warnings),
            );
        } else if table == "attachments" {
            normalized.insert(
                "local_path".into(),
                serde_json::Value::String(String::new()),
            );
            normalized.insert("is_downloaded".into(), serde_json::Value::Number(0.into()));
        }
        if matches!(table, "contacts" | "mail_rules") && !normalized.contains_key("account_id") {
            let default_account_id: i64 = conn.query_row(
                "SELECT id FROM accounts ORDER BY is_default DESC, id LIMIT 1",
                [],
                |row| row.get(0),
            )?;
            normalized.insert(
                "account_id".into(),
                serde_json::Value::Number(default_account_id.into()),
            );
        }
        let mut insert_columns = Vec::new();
        let mut values = Vec::new();
        for column in &columns {
            if let Some(value) = normalized.get(column) {
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

/// 对备份中的正文和 HTML 重新清洗，并重建安全提示。
fn recompute_message_security(body: &str, backed_html: &str) -> (String, String) {
    // HTML in a backup is untrusted, but it may be the only copy of the
    // formatting of an outbound draft. Re-sanitize it instead of discarding it.
    let safe_html = crate::protocol::sanitize_html(backed_html);
    let sanitized_html = if safe_html.is_empty() {
        crate::protocol::sanitize_html(body)
    } else {
        safe_html
    };
    let mut warnings = Vec::new();
    for source in [body, backed_html] {
        if source.to_ascii_lowercase().contains("<script") {
            warnings.push("HTML 正文包含 script 标签，渲染前必须清洗。".to_string());
        }
        if crate::protocol::html_has_remote_images(source) {
            warnings.push("检测到远程图片，应默认阻止自动加载。".to_string());
        }
        warnings.extend(crate::protocol::link_risk_warnings(source));
    }
    warnings.sort();
    warnings.dedup();
    (
        sanitized_html,
        super::messages::warning_lines_to_text(&warnings),
    )
}

pub(super) fn table_columns(conn: &Connection, table: &str) -> MailResult<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", quote_identifier(table)))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(MailError::from)?;
    Ok(columns)
}
pub(super) fn sql_value_to_json(value: ValueRef<'_>) -> serde_json::Value {
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
pub(super) fn json_to_sql_value(value: &serde_json::Value) -> Value {
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
pub(super) fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
/// 备份行数与字符串长度上限，防止不可信备份导致资源耗尽。
const MAX_BACKUP_ROWS_PER_TABLE: usize = 200_000;
// Each message/contact import can have multiple associated observations.
const MAX_BACKUP_RELATION_ROWS: usize = 2_000_000;
const MAX_BACKUP_STRING_CHARS: usize = 1_000_000;

pub(super) fn validate_local_backup(backup: &LocalBackup) -> MailResult<()> {
    if backup.schema_version != LOCAL_BACKUP_SCHEMA_VERSION {
        return Err(MailError::Imap(format!(
            "备份版本 {} 与当前版本 {} 不兼容。",
            backup.schema_version, LOCAL_BACKUP_SCHEMA_VERSION
        )));
    }
    if backup.tables.len() > LOCAL_BACKUP_TABLES.len() {
        return Err(MailError::Imap(format!(
            "备份包含 {} 张表，超过支持的表数量（{}）。",
            backup.tables.len(),
            LOCAL_BACKUP_TABLES.len()
        )));
    }
    for (table, rows) in &backup.tables {
        let limit = if matches!(
            table.as_str(),
            "contact_sent_messages" | "contact_import_entries"
        ) {
            MAX_BACKUP_RELATION_ROWS
        } else {
            MAX_BACKUP_ROWS_PER_TABLE
        };
        if rows.len() > limit {
            return Err(MailError::Imap(format!(
                "备份表 {table} 包含 {} 行，超过上限 {limit} 行，已取消操作。",
                rows.len()
            )));
        }
        for row in rows {
            for value in row.values() {
                if let serde_json::Value::String(text) = value {
                    if text.chars().count() > MAX_BACKUP_STRING_CHARS {
                        return Err(MailError::Imap(format!(
                            "备份表 {table} 中存在超长字符串（{} 字符 > {MAX_BACKUP_STRING_CHARS}），已取消恢复。",
                            text.chars().count()
                        )));
                    }
                }
            }
        }
    }
    if backup_table_count(backup, "accounts") == 0 {
        return Err(MailError::Imap(
            "备份不包含账号配置，已取消恢复。".to_string(),
        ));
    }
    Ok(())
}
pub(super) fn backup_table_count(backup: &LocalBackup, table: &str) -> i64 {
    backup
        .tables
        .get(table)
        .map(|rows| rows.len().min(i64::MAX as usize) as i64)
        .unwrap_or(0)
}
