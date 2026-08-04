use super::*;
use super::accounts::ensure_default_account_for_conn;
use super::messages::bool_to_int;
use super::migrations::rebuild_thread_keys_for_conn;

impl MailStore {
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
}

pub(super) fn export_backup_table(conn: &Connection, table: &str) -> MailResult<Vec<LocalBackupRow>> {
    let columns = table_columns(conn, table)?;
    let filtered_columns: Vec<String> = columns
        .into_iter()
        .filter(|col| col != "secret" && col != "authorization_code")
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
pub(super) fn import_backup_table(conn: &Connection, table: &str, rows: &[LocalBackupRow]) -> MailResult<()> {
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
pub(super) fn validate_local_backup(backup: &LocalBackup) -> MailResult<()> {
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
pub(super) fn backup_table_count(backup: &LocalBackup, table: &str) -> i64 {
    backup
        .tables
        .get(table)
        .map(|rows| rows.len().min(i64::MAX as usize) as i64)
        .unwrap_or(0)
}

