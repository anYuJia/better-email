use super::*;
use super::accounts::account_for_conn;
use super::contacts_rules::apply_enabled_rules_for_message;
use super::folders::{folder_for_conn, folder_id_for_account_role, is_custom_folder_role};
use super::accounts::map_account;
use super::messages::{bool_to_int, thread_key_for_message};

impl MailStore {
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
                       a.signature, a.cross_account_risk_warning,
                       a.block_external_mailboxes, a.intercept_https_links, a.auto_download_attachments, a.is_default
                FROM accounts a
                LEFT JOIN imap_mailboxes m ON m.account_id = a.id
                GROUP BY a.id, a.email, a.display_name, a.provider, a.imap_host, a.smtp_host,
                         a.incoming_protocol, a.auth_type, a.sync_mode, a.remote_images_allowed,
                         a.signature, a.cross_account_risk_warning,
                         a.block_external_mailboxes, a.intercept_https_links, a.auto_download_attachments, a.is_default
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
}

pub(super) fn list_imap_mailboxes_for_conn(
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
pub(super) fn import_imap_headers_for_conn(
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
pub(super) fn reconcile_imap_flag_snapshot_for_conn(
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
pub(super) fn infer_local_role(remote_name: &str, attributes: &[String]) -> String {
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

