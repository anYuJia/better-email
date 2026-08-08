use super::accounts::account_for_conn;
use super::*;

impl MailStore {
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
}

pub(super) fn folder_id_for_role(conn: &Connection, role: &str) -> MailResult<i64> {
    let account = account_for_conn(conn, None)?;
    folder_id_for_account_role(conn, account.id, role)
}
pub(super) fn create_default_folders_for_account(
    conn: &Connection,
    account_id: i64,
) -> MailResult<()> {
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
pub(super) fn folder_id_for_account_role(
    conn: &Connection,
    account_id: i64,
    role: &str,
) -> MailResult<i64> {
    conn.query_row(
        "SELECT id FROM folders WHERE account_id = ?1 AND role = ?2 LIMIT 1",
        params![account_id, role],
        |row| row.get(0),
    )
    .optional()?
    .ok_or_else(|| MailError::MissingFolderRole(role.to_string()))
}
pub(super) fn folder_id_for_message_role(
    conn: &Connection,
    message_id: i64,
    role: &str,
) -> MailResult<i64> {
    let account_id: i64 = conn.query_row(
        "SELECT account_id FROM messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    )?;
    folder_id_for_account_role(conn, account_id, role)
}
pub(super) fn folder_for_conn(conn: &Connection, folder_id: i64) -> MailResult<Folder> {
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
pub(super) fn normalized_custom_folder_name(name: &str) -> MailResult<String> {
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
pub(super) fn ensure_custom_folder_name_available(
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
pub(super) fn is_custom_folder_role(role: &str) -> bool {
    role.starts_with("custom:")
}
pub(super) fn virtual_folder_id(role: &str) -> i64 {
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
pub(super) fn role_for_virtual_folder_id(folder_id: i64) -> Option<&'static str> {
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
pub(super) fn folder_name_for_role(role: &str) -> &str {
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
