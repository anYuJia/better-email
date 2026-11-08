use super::accounts::{account_for_conn, identity_for_draft_conn};
use super::attachments::attachments_for_message_conn;
use super::folders::{folder_id_for_account_role, folder_id_for_message_role};
use super::messages::{bool_to_int, normalized_subject, snippet_from_body};
use super::*;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::sync::OnceLock;

type LeaseKey = (PathBuf, i64);
static ACTIVE_LEASES: OnceLock<Mutex<BTreeMap<LeaseKey, usize>>> = OnceLock::new();

pub struct OutboxLeaseGuard {
    key: LeaseKey,
}

impl Drop for OutboxLeaseGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_LEASES.get_or_init(Mutex::default).lock() {
            if let Some(count) = active.get_mut(&self.key) {
                *count -= 1;
                if *count == 0 {
                    active.remove(&self.key);
                }
            }
        }
    }
}

impl MailStore {
    pub(super) fn has_active_outbox_lease(&self, message_id: i64) -> MailResult<bool> {
        let key = (fs::canonicalize(&self.database_path)?, message_id);
        let active = ACTIVE_LEASES
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        Ok(active.contains_key(&key))
    }

    /// A live network operation cannot be recovered as an interrupted worker
    /// just because a large transfer takes longer than its crash-recovery lease.
    pub fn hold_outbox_lease(&self, message_id: i64) -> MailResult<OutboxLeaseGuard> {
        let key = (fs::canonicalize(&self.database_path)?, message_id);
        let mut active = ACTIVE_LEASES
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        *active.entry(key.clone()).or_default() += 1;
        Ok(OutboxLeaseGuard { key })
    }

    /// Coordinate cache cleanup with starting a writer; checking a lease and
    /// unlinking in separate critical sections could remove an active partial.
    pub(super) fn remove_attachment_cache_file_if_inactive(
        &self,
        message_id: i64,
        path: &Path,
    ) -> MailResult<()> {
        let key = (fs::canonicalize(&self.database_path)?, message_id);
        let active = ACTIVE_LEASES
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        if !active.contains_key(&key) {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    }

    pub(super) fn prune_attachment_cache_directories_if_idle(&self, root: &Path) -> MailResult<()> {
        let database = fs::canonicalize(&self.database_path)?;
        let active = ACTIVE_LEASES
            .get_or_init(Mutex::default)
            .lock()
            .map_err(|_| MailError::DatabaseLockPoisoned)?;
        if !active.keys().any(|(path, _)| *path == database) {
            super::attachments::prune_empty_directories(root, true)?;
        }
        Ok(())
    }

    /// Persist the exact bytes already verified for this submission before SMTP
    /// starts. The reader and any later archive retry then share a durable,
    /// authorized copy, without depending on temporary composer files.
    pub fn persist_sent_attachment_bytes(
        &self,
        message: &OutboundMessage,
        attachment_bytes: &[Vec<u8>],
    ) -> MailResult<()> {
        if message.attachments.len() != attachment_bytes.len() {
            return Err(MailError::SmtpPermanent(
                "附件内容与发送记录不一致，尚未发送。".into(),
            ));
        }
        if message.attachments.is_empty() {
            return Ok(());
        }
        let _lease = self.hold_outbox_lease(message.id)?;
        let directory = self.attachment_dir(message.id);
        fs::create_dir_all(&directory)?;
        let directory = fs::canonicalize(directory)?;
        if !directory.starts_with(fs::canonicalize(self.attachment_root())?) {
            return Err(MailError::SmtpPermanent(
                "已发送附件目录无效，尚未发送。".into(),
            ));
        }
        let mut created = Vec::new();
        let result = (|| {
            let mut prepared = Vec::new();
            for (attachment, bytes) in message.attachments.iter().zip(attachment_bytes) {
                if attachment.message_id != message.id
                    || attachment.size_bytes != bytes.len() as i64
                {
                    return Err(MailError::SmtpPermanent(
                        "附件内容与发送记录不一致，尚未发送。".into(),
                    ));
                }
                let digest = Sha256::digest(bytes)
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                let source = PathBuf::from(&attachment.local_path);
                let path = if source.parent() == Some(directory.as_path())
                    && fs::symlink_metadata(&source).is_ok_and(|meta| meta.is_file())
                {
                    // The caller has just read and verified these exact bytes.
                    source
                } else {
                    let path = directory.join(format!(
                        "{}-{}-{}",
                        attachment.id,
                        uuid::Uuid::new_v4(),
                        safe_attachment_filename(&attachment.filename)
                    ));
                    let mut options = fs::OpenOptions::new();
                    options.write(true).create_new(true);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        options.mode(0o600);
                    }
                    let mut file = options.open(&path)?;
                    created.push(path.clone());
                    file.write_all(bytes)?;
                    file.sync_all()?;
                    path
                };
                prepared.push((attachment, path, digest));
            }
            self.with_conn(|conn| {
                let transaction = conn.unchecked_transaction()?;
                for (attachment, path, digest) in &prepared {
                    let path = path.to_string_lossy();
                    let updated = transaction.execute(
                        "UPDATE attachments SET local_path=?1, is_downloaded=1, content_sha256=?2
                         WHERE id=?3 AND message_id=?4 AND local_path=?5 AND size_bytes=?6",
                        params![path.as_ref(), digest, attachment.id, message.id, attachment.local_path, attachment.size_bytes],
                    )?;
                    if updated != 1 {
                        return Err(MailError::Cancelled);
                    }
                    transaction.execute(
                        "INSERT INTO outbound_attachment_auths(canonical_path,size_bytes,content_sha256,created_at)
                         VALUES (?1,?2,?3,?4) ON CONFLICT(canonical_path) DO UPDATE SET
                         size_bytes=excluded.size_bytes,content_sha256=excluded.content_sha256,created_at=excluded.created_at",
                        params![path.as_ref(), attachment.size_bytes, digest, Utc::now().to_rfc3339()],
                    )?;
                }
                transaction.commit()?;
                Ok(())
            })
        })();
        if result.is_err() {
            for path in created {
                let _ = fs::remove_file(path);
            }
        }
        result
    }
    pub fn list_outbox(&self) -> MailResult<Vec<OutboxItem>> {
        self.recover_outbox_leases_at(&Utc::now().to_rfc3339())?;
        self.with_conn(list_outbox_for_conn)
    }

    pub fn prepare_outbox_send(&self, input: DraftInput) -> MailResult<i64> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let account = account_for_conn(&transaction, (input.account_id > 0).then_some(input.account_id))?;
            let identity = identity_for_draft_conn(&transaction, &account, input.identity_id)?;
            let payload = serde_json::json!({
                "account": account.id, "sender": identity.email, "to": input.to.trim(),
                "cc": input.cc.trim(), "bcc": input.bcc.trim(), "subject": input.subject.trim(),
                "body": input.body, "html": input.html_body, "attachments": input.attachments,
            });
            let fingerprint = Sha256::digest(payload.to_string().as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            let previous = transaction.query_row(
                "SELECT id, status FROM outbox_queue WHERE (submission_fingerprint = ?1 OR substr(submission_fingerprint, 1, length(?1) + 10) = ?1 || ':restored:') AND status IN ('sending', 'send_unknown')",
                params![fingerprint],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            ).optional()?;
            if let Some((outbox_id, status)) = previous {
                let detail = format!("相同邮件已有未结束的发送记录（发件箱 #{outbox_id}），请先在发件箱核对结果，不要重复提交。");
                return Err(if status == "send_unknown" {
                    MailError::SmtpOutcomeUnknown(detail)
                } else {
                    MailError::Smtp(detail)
                });
            }
            let message_id = create_outbound_message_for_conn(&transaction, input, "outbox")?;
            let now = Utc::now();
            transaction.execute(
                "INSERT INTO outbox_queue(message_id, status, attempts, last_error, queued_at, next_attempt_at, submission_fingerprint)
                 VALUES (?1, 'sending', 0, '', ?2, ?3, ?4)",
                params![message_id, now.to_rfc3339(), (now + Duration::minutes(5)).to_rfc3339(), fingerprint],
            )?;
            transaction.commit()?;
            Ok(message_id)
        })
    }

    pub fn claim_outbox_message(&self, message_id: i64) -> MailResult<bool> {
        self.with_conn(|conn| {
            let now = Utc::now();
            let changed = conn.execute(
                "UPDATE outbox_queue SET status = 'sending', last_error = '', next_attempt_at = ?3
                 WHERE message_id = ?1 AND status IN ('queued', 'retry', 'scheduled')
                   AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?2))
                   AND EXISTS (
                       SELECT 1 FROM messages m JOIN folders f ON f.id = m.folder_id
                       WHERE m.id = ?1 AND f.role = 'outbox'
                   )",
                params![
                    message_id,
                    now.to_rfc3339(),
                    (now + Duration::minutes(5)).to_rfc3339()
                ],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn claim_outbox_archive(&self, message_id: i64) -> MailResult<bool> {
        self.with_conn(|conn| {
            let now = Utc::now();
            let changed = conn.execute(
                "UPDATE outbox_queue SET status = 'archiving', next_attempt_at = ?3
                 WHERE message_id = ?1 AND status = 'sent_remote_pending'
                   AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?2))",
                params![
                    message_id,
                    now.to_rfc3339(),
                    (now + Duration::minutes(5)).to_rfc3339()
                ],
            )?;
            Ok(changed == 1)
        })
    }

    pub fn recover_outbox_leases_at(&self, now: &str) -> MailResult<usize> {
        let database_path = fs::canonicalize(&self.database_path)?;
        self.with_conn(|conn| {
            let active = ACTIVE_LEASES.get_or_init(Mutex::default).lock()
                .map_err(|_| MailError::DatabaseLockPoisoned)?;
            let active_ids = active.keys().filter_map(|(path, id)| (path == &database_path).then_some(*id)).collect::<Vec<_>>();
            let placeholders = active_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            let exclusion = if active_ids.is_empty() { String::new() } else { format!(" AND message_id NOT IN ({placeholders})") };
            let parameters = std::iter::once(Value::Text(now.to_string())).chain(active_ids.into_iter().map(Value::Integer)).collect::<Vec<_>>();
            let sending = conn.execute(
                &format!("UPDATE outbox_queue SET status = 'send_unknown', next_attempt_at = '',
                    last_error = '上次发送已中断，结果未确认。已停止自动重发，请先检查已发送文件夹或向收件人确认。'
                 WHERE status = 'sending' AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?1)){exclusion}"),
                params_from_iter(parameters.iter()),
            )?;
            let archiving = conn.execute(
                &format!("UPDATE outbox_queue SET status = 'sent_remote_pending', next_attempt_at = '',
                    last_error = 'SMTP 已发送；上次留档中断，仅重试已发送副本，不会再次发送。'
                 WHERE status = 'archiving' AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?1)){exclusion}"),
                params_from_iter(parameters.iter()),
            )?;
            Ok(sending + archiving)
        })
    }

    pub fn mark_outbox_outcome_unknown(&self, message_id: i64, error: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE outbox_queue SET status = 'send_unknown', attempts = attempts + 1,
                    last_error = ?2, next_attempt_at = ''
                 WHERE message_id = ?1 AND status IN ('sending', 'send_unknown')",
                params![message_id, error.chars().take(500).collect::<String>()],
            )?;
            Ok(())
        })
    }

    pub fn cancel_claimed_outbox_message(&self, message_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let changed = transaction.execute(
                "UPDATE outbox_queue SET status = 'cancelled', last_error = '发送前已取消，邮件保留在草稿箱', next_attempt_at = ''
                 WHERE message_id = ?1 AND status = 'sending'",
                params![message_id],
            )?;
            if changed == 1 {
                let drafts_id = folder_id_for_message_role(&transaction, message_id, "drafts")?;
                transaction.execute("UPDATE messages SET folder_id = ?1 WHERE id = ?2", params![drafts_id, message_id])?;
            }
            transaction.commit()?;
            Ok(())
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
                       m.sanitized_html, m.in_reply_to_header, m.references_header, m.message_id_header
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                LEFT JOIN mail_identities mi ON mi.account_id = m.account_id AND mi.email = m.sender_email
                WHERE q.status IN ('queued', 'retry', 'scheduled')
                  AND (q.next_attempt_at = '' OR julianday(q.next_attempt_at) <= julianday(?1))
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
                        message_id_header: row.get(13)?,
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
                       m.sanitized_html, m.in_reply_to_header, m.references_header, m.message_id_header
                FROM outbox_queue q
                JOIN messages m ON m.id = q.message_id
                LEFT JOIN mail_identities mi ON mi.account_id = m.account_id AND mi.email = m.sender_email
                WHERE q.status = 'sent_remote_pending'
                  AND (q.next_attempt_at = '' OR julianday(q.next_attempt_at) <= julianday(?1))
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
                        message_id_header: row.get(13)?,
                        attachments: attachments_for_message_conn(conn, message_id)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(messages)
        })
    }
    pub fn release_due_outbox_items(&self) -> MailResult<Vec<OutboxItem>> {
        self.with_conn(|conn| {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'queued',
                    last_error = '已到发送时间，等待手动点击真实发送。',
                    next_attempt_at = ''
                WHERE status = 'scheduled'
                  AND next_attempt_at != ''
                  AND julianday(next_attempt_at) <= julianday(?1)
                ",
                params![now],
            )?;
            list_outbox_for_conn(conn)
        })
    }
    pub fn cancel_outbox_item(&self, outbox_id: i64) -> MailResult<OutboxItem> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let (message_id, status): (i64, String) = transaction.query_row(
                "SELECT message_id, status FROM outbox_queue WHERE id = ?1",
                params![outbox_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            if !matches!(status.as_str(), "queued" | "retry" | "scheduled" | "failed") {
                return Err(MailError::Smtp(
                    "邮件已开始发送、已发送或发送结果未确认，不能保证撤销。请先核对发送结果。".to_string(),
                ));
            }
            let drafts_id = folder_id_for_message_role(&transaction, message_id, "drafts")?;
            transaction.execute(
                "UPDATE outbox_queue SET status = 'cancelled', last_error = '已撤回到草稿箱', next_attempt_at = ''
                 WHERE id = ?1 AND status IN ('queued', 'retry', 'scheduled', 'failed')",
                params![outbox_id],
            )?;
            transaction.execute("UPDATE messages SET folder_id = ?1 WHERE id = ?2", params![drafts_id, message_id])?;
            let item = get_outbox_item_for_conn(&transaction, outbox_id)?;
            transaction.commit()?;
            Ok(item)
        })
    }
    pub fn resolve_outbox_outcome(
        &self,
        outbox_id: i64,
        delivered: bool,
    ) -> MailResult<OutboxItem> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let item = get_outbox_item_for_conn(&transaction, outbox_id)?;
            if item.status != "send_unknown" {
                return Err(MailError::Smtp("该邮件不处于发送结果待确认状态，请刷新后重试".to_string()));
            }
            let role = if delivered { "sent" } else { "drafts" };
            let folder_id = folder_id_for_message_role(&transaction, item.message_id, role)?;
            let message = outbound_message_for_conn(&transaction, item.message_id)?;
            let header = crate::smtp::outbound_message_id(&message);
            let thread_key = thread_key_for_message(&message.subject, &header, &message.in_reply_to_header, &message.references_header);
            transaction.execute(
                "UPDATE outbox_queue SET status = ?2, last_error = ?3, next_attempt_at = ?4 WHERE id = ?1 AND status = 'send_unknown'",
                params![outbox_id,
                    if delivered { "sent_remote_pending" } else { "cancelled" },
                    if delivered { "用户已核对确认发送成功，等待保存远端副本" } else { "用户已核对确认未发送，已转回草稿；不会自动重发" },
                    if delivered { Utc::now().to_rfc3339() } else { String::new() }],
            )?;
            if delivered {
                transaction.execute(
                    "UPDATE messages SET folder_id = ?1, message_id_header = ?2, thread_key = ?3 WHERE id = ?4",
                    params![folder_id, header, thread_key, item.message_id],
                )?;
            } else {
                transaction.execute("UPDATE messages SET folder_id = ?1 WHERE id = ?2", params![folder_id, item.message_id])?;
            }
            let updated = get_outbox_item_for_conn(&transaction, outbox_id)?;
            transaction.commit()?;
            Ok(updated)
        })
    }

    pub fn mark_outbox_smtp_sent_pending_archive(
        &self,
        message_id: i64,
        message_id_header: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let conn = &transaction;
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
            transaction.commit()?;
            Ok(())
        })
    }
    pub fn mark_outbox_remote_archived(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
        remote_uid_validity: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let conn = &transaction;
            let affected = conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent',
                    last_error = '',
                    next_attempt_at = ''
                WHERE message_id = ?1 AND status IN ('sent_remote_pending', 'archiving')
                ",
                params![message_id],
            )?;
            if affected == 1 {
                conn.execute(
                    "
                UPDATE messages
                SET remote_mailbox = ?1,
                    remote_uid = ?2,
                    remote_uid_validity = ?4
                WHERE id = ?3
                ",
                    params![
                        remote_mailbox.trim(),
                        remote_uid.max(0),
                        message_id,
                        remote_uid_validity
                    ],
                )?;
            }
            transaction.commit()?;
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
                WHERE message_id = ?3 AND status IN ('sent_remote_pending', 'archiving')
                ",
                params![
                    error.trim().chars().take(500).collect::<String>(),
                    next_attempt_at,
                    message_id
                ],
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
                WHERE message_id = ?1 AND status IN ('queued', 'retry', 'scheduled', 'sending', 'failed')
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
    pub fn mark_outbox_blocked(&self, message_id: i64, error: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'failed',
                    attempts = attempts + 1,
                    last_error = ?2,
                    next_attempt_at = ''
                WHERE message_id = ?1 AND status IN ('queued', 'retry', 'scheduled', 'sending', 'failed')
                ",
                params![message_id, error.chars().take(500).collect::<String>(),],
            )?;
            Ok(())
        })
    }
    pub fn flush_outbox_dry_run(&self) -> MailResult<Vec<OutboxItem>> {
        self.with_conn(|conn| {
            let transaction = rusqlite::Transaction::new_unchecked(
                conn,
                rusqlite::TransactionBehavior::Immediate,
            )?;
            let now = Utc::now().to_rfc3339();
            transaction.execute(
                "
                UPDATE messages
                SET folder_id = (
                    SELECT f.id
                    FROM folders f
                    WHERE f.account_id = messages.account_id AND f.role = 'sent'
                    LIMIT 1
                )
                WHERE id IN (
                    SELECT message_id FROM outbox_queue
                    WHERE status IN ('queued', 'retry', 'scheduled')
                      AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?1))
                )
                ",
                params![now],
            )?;
            transaction.execute(
                "
                UPDATE outbox_queue
                SET status = 'sent_dry_run', attempts = attempts + 1, last_error = '', next_attempt_at = ''
                WHERE status IN ('queued', 'retry', 'scheduled')
                  AND (next_attempt_at = '' OR julianday(next_attempt_at) <= julianday(?1))
                ",
                params![now],
            )?;
            let items = list_outbox_for_conn(&transaction)?;
            transaction.commit()?;
            Ok(items)
        })
    }
    pub(super) fn create_outbound_message(&self, input: DraftInput, role: &str) -> MailResult<i64> {
        self.with_conn(|conn| create_outbound_message_for_conn(conn, input, role))
    }
}

pub(super) fn create_outbound_message_for_conn(
    conn: &Connection,
    input: DraftInput,
    role: &str,
) -> MailResult<i64> {
    reject_empty_attachment_names(&input.attachments)?;
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
    let outbound_attachments = input.attachments.iter().collect::<Vec<_>>();
    conn.execute(
        "INSERT INTO messages(account_id, folder_id, sender_name, sender_email, recipients, cc, bcc, subject, snippet, body, sanitized_html, received_at, is_read, is_starred, has_attachments, thread_key, message_id_header)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 1, 0, ?13, ?14, ?15)",
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
            format!("<better-email-{}@better-email.local>", uuid::Uuid::new_v4())
        ],
    )?;
    let message_id = conn.last_insert_rowid();
    replace_outbound_attachments_for_conn(conn, message_id, &outbound_attachments)?;
    Ok(message_id)
}
pub(super) fn update_draft_message_for_conn(
    conn: &Connection,
    input: DraftInput,
) -> MailResult<i64> {
    reject_empty_attachment_names(&input.attachments)?;
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
    let outbound_attachments = input.attachments.iter().collect::<Vec<_>>();

    conn.execute(
        "
        UPDATE messages
        SET account_id = ?1, folder_id = ?2, sender_name = ?3, sender_email = ?4,
            recipients = ?5, cc = ?6, bcc = ?7, subject = ?8, snippet = ?9,
            body = ?10, sanitized_html = ?11, received_at = ?12, has_attachments = ?13, thread_key = ?14,
            message_id_header = CASE WHEN trim(message_id_header) = '' THEN ?16 ELSE message_id_header END
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
            input.draft_id,
            format!("<better-email-{}@better-email.local>", uuid::Uuid::new_v4())
        ],
    )?;
    replace_outbound_attachments_for_conn(conn, input.draft_id, &outbound_attachments)?;
    Ok(input.draft_id)
}
pub(super) fn replace_outbound_attachments_for_conn(
    conn: &Connection,
    message_id: i64,
    outbound_attachments: &[&OutboundAttachmentInput],
) -> MailResult<()> {
    if outbound_attachments
        .iter()
        .any(|attachment| attachment.filename.trim().is_empty())
    {
        return Err(MailError::SmtpPermanent(
            "附件名称不能为空，邮件未保存或发送。".into(),
        ));
    }
    conn.execute(
        "DELETE FROM attachments WHERE message_id = ?1",
        params![message_id],
    )?;
    for attachment in outbound_attachments {
        let local_path = attachment.local_path.trim();
        conn.execute(
            "INSERT INTO attachments(message_id, filename, mime_type, size_bytes, is_downloaded, local_path, content_id, is_inline)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                message_id,
                attachment.filename.trim(),
                fallback_mime_type(&attachment.mime_type),
                attachment.size_bytes.max(0),
                bool_to_int(!local_path.is_empty()),
                local_path,
                attachment.content_id.trim(),
                bool_to_int(attachment.is_inline)
            ],
        )?;
    }
    Ok(())
}

fn reject_empty_attachment_names(attachments: &[OutboundAttachmentInput]) -> MailResult<()> {
    if attachments
        .iter()
        .any(|attachment| attachment.filename.trim().is_empty())
    {
        return Err(MailError::SmtpPermanent(
            "附件名称不能为空，邮件未保存或发送。".into(),
        ));
    }
    Ok(())
}
pub(super) fn sanitize_outbound_html(html: &str) -> String {
    if html.trim().is_empty() {
        String::new()
    } else {
        protocol::sanitize_html(html)
    }
}
pub(super) fn html_body_with_signature(html: &str, signature: &str) -> String {
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
pub(super) fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}
pub(super) fn fallback_mime_type(mime_type: &str) -> &str {
    let trimmed = mime_type.trim();
    if trimmed.is_empty() {
        "application/octet-stream"
    } else {
        trimmed
    }
}
pub(super) fn safe_attachment_filename(filename: &str) -> String {
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
pub(super) fn outbound_message_for_conn(
    conn: &Connection,
    message_id: i64,
) -> MailResult<OutboundMessage> {
    conn.query_row(
        "
        SELECT m.id, m.account_id, m.sender_name, m.sender_email,
               COALESCE(mi.reply_to, ''), m.recipients, m.cc, m.bcc, m.subject, m.body,
               m.sanitized_html, m.in_reply_to_header, m.references_header, m.message_id_header
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
                message_id_header: row.get(13)?,
                attachments: attachments_for_message_conn(conn, id)?,
            })
        },
    )
    .map_err(Into::into)
}
pub(super) fn get_outbox_item_for_conn(conn: &Connection, id: i64) -> MailResult<OutboxItem> {
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
pub(super) fn list_outbox_for_conn(conn: &Connection) -> MailResult<Vec<OutboxItem>> {
    let mut stmt = conn.prepare(
        "
        SELECT q.id, q.message_id, m.recipients, m.subject, q.status, q.attempts,
               q.last_error, q.queued_at, q.next_attempt_at
        FROM outbox_queue q
        JOIN messages m ON m.id = q.message_id
        WHERE q.status NOT IN ('sent', 'cancelled') OR q.id IN (
            SELECT id FROM outbox_queue WHERE status IN ('sent', 'cancelled')
            ORDER BY queued_at DESC, id DESC LIMIT 50
        )
        ORDER BY q.queued_at DESC, q.id DESC
        ",
    )?;
    let items = stmt
        .query_map([], map_outbox_item)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}
pub(super) fn map_outbox_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<OutboxItem> {
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
pub(super) fn outbox_retry_delay_minutes(next_attempt_number: i64) -> i64 {
    match next_attempt_number {
        0 | 1 => 1,
        2 => 5,
        3 => 15,
        4 => 60,
        _ => 240,
    }
}

#[cfg(test)]
mod claim_tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn fixture() -> (tempfile::TempDir, MailStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        (dir, store)
    }

    fn draft() -> DraftInput {
        DraftInput {
            draft_id: 0,
            account_id: 0,
            identity_id: 0,
            to: "recipient@example.com".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Claim regression".into(),
            body: "complete body".into(),
            html_body: String::new(),
            send_at: String::new(),
            attachments: Vec::new(),
        }
    }

    #[test]
    fn outbound_attachment_metadata_is_saved_with_drafts_and_outbox() {
        let (_dir, store) = fixture();
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
    fn concurrent_connections_claim_each_message_only_once() {
        let (dir, store) = fixture();
        let item = store.queue_outbox_message(draft()).unwrap();
        let other = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        assert_eq!(
            other.get_message(item.message_id).unwrap().id,
            item.message_id
        );
        let barrier = Arc::new(Barrier::new(12));
        let workers = (0..12)
            .map(|index| {
                let store = if index % 2 == 0 {
                    store.clone()
                } else {
                    other.clone()
                };
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store.claim_outbox_message(item.message_id).unwrap()
                })
            })
            .collect::<Vec<_>>();
        let claimed = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .filter(|claimed| *claimed)
            .count();
        assert_eq!(claimed, 1);
        assert!(store.pending_outbox_messages().unwrap().is_empty());
    }

    #[test]
    fn concurrent_workers_claim_high_volume_retry_items_only_once() {
        // 压力路径：多个发送 worker 同时处理一批已进入 retry 的邮件时，
        // 每个 message 只能被一个 worker 抢到，避免重复投递。
        const MESSAGE_COUNT: usize = 128;
        const WORKER_COUNT: usize = 16;
        let (dir, store) = fixture();
        let other = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        let message_ids = (0..MESSAGE_COUNT)
            .map(|index| {
                let mut input = draft();
                input.subject = format!("Retry pressure {index}");
                let item = store.queue_outbox_message(input).unwrap();
                store
                    .mark_outbox_failed(item.message_id, "simulated temporary SMTP failure")
                    .unwrap();
                item.message_id
            })
            .collect::<Vec<_>>();
        // 让这一轮 retry 立即到期，模拟调度器在重试窗口到达后的批量唤醒。
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE outbox_queue SET next_attempt_at = '' WHERE status = 'retry'",
                    [],
                )?;
                Ok(())
            })
            .unwrap();

        let barrier = Arc::new(Barrier::new(WORKER_COUNT));
        let workers = (0..WORKER_COUNT)
            .map(|index| {
                let worker_store = if index % 2 == 0 {
                    store.clone()
                } else {
                    other.clone()
                };
                let ids = message_ids.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    ids.into_iter()
                        .filter(|message_id| {
                            worker_store.claim_outbox_message(*message_id).unwrap()
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect::<Vec<_>>();
        let mut claimed_ids = workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("worker joined"))
            .collect::<Vec<_>>();
        claimed_ids.sort_unstable();
        let mut expected_ids = message_ids.clone();
        expected_ids.sort_unstable();
        assert_eq!(claimed_ids, expected_ids);
        assert!(store.pending_outbox_messages().unwrap().is_empty());
    }

    #[test]
    fn repeated_transient_failures_advance_retry_attempts_without_duplicate_rows() {
        let (_dir, store) = fixture();
        let item = store.queue_outbox_message(draft()).unwrap();

        for expected_attempts in 1..=8 {
            store
                .mark_outbox_failed(item.message_id, "simulated temporary SMTP failure")
                .unwrap();
            let current = store
                .list_outbox()
                .unwrap()
                .into_iter()
                .find(|candidate| candidate.id == item.id)
                .expect("retry row remains visible");
            assert_eq!(current.status, "retry");
            assert_eq!(current.attempts, expected_attempts);
            assert!(!current.next_attempt_at.is_empty());
        }

        let row_count: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT COUNT(*) FROM outbox_queue WHERE message_id = ?1",
                    params![item.message_id],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(row_count, 1, "重试只更新原队列记录，不应产生重复发件记录");
    }

    #[test]
    fn cancelling_before_claim_prevents_smtp_and_preserves_draft() {
        let (_dir, store) = fixture();
        let item = store.queue_outbox_message(draft()).unwrap();
        assert_eq!(
            store.cancel_outbox_item(item.id).unwrap().status,
            "cancelled"
        );
        assert!(!store.claim_outbox_message(item.message_id).unwrap());
        assert_eq!(
            store.get_message(item.message_id).unwrap().folder_role,
            "drafts"
        );
    }

    #[test]
    fn claimed_message_cannot_be_cancelled_deleted_or_edited() {
        let (_dir, store) = fixture();
        let item = store.queue_outbox_message(draft()).unwrap();
        assert!(store.claim_outbox_message(item.message_id).unwrap());
        assert!(store.cancel_outbox_item(item.id).is_err());
        assert!(store.delete_message_permanently(item.message_id).is_err());
        assert!(store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body = 'changed' WHERE id = ?1",
                    [item.message_id],
                )?;
                Ok(())
            })
            .is_err());
        assert!(store
            .with_conn(|conn| {
                conn.execute(
                    "DELETE FROM outbox_queue WHERE message_id = ?1",
                    [item.message_id],
                )?;
                Ok(())
            })
            .is_err());
        store
            .cancel_claimed_outbox_message(item.message_id)
            .unwrap();
        assert_eq!(
            store.get_message(item.message_id).unwrap().folder_role,
            "drafts"
        );
    }

    #[test]
    fn expired_send_lease_requires_manual_reconciliation_not_automatic_retry() {
        let (_dir, store) = fixture();
        let message_id = store.prepare_outbox_send(draft()).unwrap();
        assert_eq!(
            store
                .recover_outbox_leases_at(&Utc::now().to_rfc3339())
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .recover_outbox_leases_at(&(Utc::now() + Duration::minutes(6)).to_rfc3339())
                .unwrap(),
            1
        );
        let item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|item| item.message_id == message_id)
            .unwrap();
        assert_eq!(item.status, "send_unknown");
        assert!(store.cancel_outbox_item(item.id).is_err());
        assert!(!store.claim_outbox_message(message_id).unwrap());
        assert!(store.pending_outbox_messages().unwrap().is_empty());
    }

    #[test]
    fn accepted_messages_only_retry_archiving_and_cannot_be_downgraded() {
        let (_dir, store) = fixture();
        let message_id = store.prepare_outbox_send(draft()).unwrap();
        store
            .mark_outbox_smtp_sent_pending_archive(message_id, "<stable@example.com>")
            .unwrap();
        store
            .mark_outbox_failed(message_id, "stale worker")
            .unwrap();
        store
            .mark_outbox_blocked(message_id, "stale worker")
            .unwrap();
        assert!(!store.claim_outbox_message(message_id).unwrap());
        assert!(store.claim_outbox_archive(message_id).unwrap());
        assert!(!store.claim_outbox_archive(message_id).unwrap());
        assert_eq!(
            store
                .recover_outbox_leases_at(&(Utc::now() + Duration::minutes(6)).to_rfc3339())
                .unwrap(),
            1
        );
        assert!(store.claim_outbox_archive(message_id).unwrap());
        store
            .mark_outbox_remote_archived(message_id, "Sent", 123, "100")
            .unwrap();
        assert!(store.pending_outbox_messages().unwrap().is_empty());
        assert!(store.pending_remote_archive_messages().unwrap().is_empty());
        assert_eq!(store.get_message(message_id).unwrap().folder_role, "sent");
    }

    #[test]
    fn scheduled_messages_are_not_claimed_early() {
        let (_dir, store) = fixture();
        let mut input = draft();
        input.send_at = (Utc::now() + Duration::days(1)).to_rfc3339();
        let item = store.queue_outbox_message(input).unwrap();
        assert!(!store.claim_outbox_message(item.message_id).unwrap());
    }
    #[test]
    fn uncertain_submission_requires_explicit_reconciliation_before_resubmission() {
        let (_dir, store) = fixture();
        let id = store.prepare_outbox_send(draft()).unwrap();
        assert!(store.prepare_outbox_send(draft()).is_err());
        store
            .mark_outbox_outcome_unknown(id, "connection lost after DATA")
            .unwrap();
        assert!(matches!(
            store.prepare_outbox_send(draft()),
            Err(MailError::SmtpOutcomeUnknown(_))
        ));
        let queued = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|item| item.message_id == id)
            .unwrap();
        let cancelled = store.resolve_outbox_outcome(queued.id, false).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(store.get_message(id).unwrap().folder_role, "drafts");
        assert!(store.pending_outbox_messages().unwrap().is_empty());
        assert!(store.resolve_outbox_outcome(queued.id, true).is_err());
        assert!(store.prepare_outbox_send(draft()).is_ok());
    }

    #[test]
    fn confirmed_delivery_only_enters_the_archive_queue() {
        let (_dir, store) = fixture();
        let id = store.prepare_outbox_send(draft()).unwrap();
        store.mark_outbox_outcome_unknown(id, "reply lost").unwrap();
        let item = store
            .list_outbox()
            .unwrap()
            .into_iter()
            .find(|item| item.message_id == id)
            .unwrap();
        let resolved = store.resolve_outbox_outcome(item.id, true).unwrap();
        assert_eq!(resolved.status, "sent_remote_pending");
        assert_eq!(store.get_message(id).unwrap().folder_role, "sent");
        assert!(!store.claim_outbox_message(id).unwrap());
        assert!(store.claim_outbox_archive(id).unwrap());
    }

    #[test]
    fn active_outbox_items_are_not_hidden_by_terminal_history_limit() {
        let (_dir, store) = fixture();
        let active = store.queue_outbox_message(draft()).unwrap();
        for index in 0..55 {
            let mut input = draft();
            input.subject = format!("History {index}");
            let item = store.queue_outbox_message(input).unwrap();
            store.cancel_outbox_item(item.id).unwrap();
        }
        let items = store.list_outbox().unwrap();
        assert!(items.iter().any(|item| item.id == active.id));
        assert_eq!(
            items
                .iter()
                .filter(|item| item.status == "cancelled")
                .count(),
            50
        );
        assert_eq!(items.len(), 51);
    }

    #[test]
    fn rejected_queue_insert_rolls_back_message_metadata() {
        let (_dir, store) = fixture();
        let before: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?)
            })
            .unwrap();
        store
            .with_conn(|conn| {
                conn.execute_batch(
                    "CREATE TRIGGER reject_queue BEFORE INSERT ON outbox_queue
                BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;",
                )?;
                Ok(())
            })
            .unwrap();
        assert!(store.queue_outbox_message(draft()).is_err());
        let after: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?)
            })
            .unwrap();
        assert_eq!(before, after);
        assert!(store.list_outbox().unwrap().is_empty());
    }

    #[test]
    fn malformed_schedule_does_not_create_an_unprocessable_outbox_item() {
        let (_dir, store) = fixture();
        let mut input = draft();
        input.send_at = "not-a-time".into();
        assert!(store.queue_outbox_message(input).is_err());
        assert!(store.list_outbox().unwrap().is_empty());
    }
}

#[cfg(test)]
mod sent_attachment_tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, MailStore, OutboundMessage, Vec<Vec<u8>>) {
        let dir = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(dir.path().join("outbound.sqlite3"), true).unwrap();
        fs::create_dir_all(store.temp_attachment_dir()).unwrap();
        let source = store.temp_attachment_dir().join("sent.zip");
        let bytes = b"verified attachment content".to_vec();
        fs::write(&source, &bytes).unwrap();
        let item = store
            .queue_outbox_message(DraftInput {
                draft_id: 0,
                account_id: 0,
                identity_id: 0,
                to: "recipient@example.com".into(),
                cc: String::new(),
                bcc: String::new(),
                subject: "Attachment only".into(),
                body: String::new(),
                html_body: String::new(),
                send_at: String::new(),
                attachments: vec![OutboundAttachmentInput {
                    filename: "sent.zip".into(),
                    mime_type: "application/zip".into(),
                    size_bytes: bytes.len() as i64,
                    local_path: source.to_string_lossy().into_owned(),
                    content_id: String::new(),
                    is_inline: false,
                }],
            })
            .unwrap();
        let message = store.get_outbound_message(item.message_id).unwrap();
        (dir, store, message, vec![bytes])
    }

    #[test]
    fn archived_sent_attachment_survives_temp_cleanup_and_opens_from_managed_storage() {
        let (_dir, store, original, bytes) = fixture();
        store
            .persist_sent_attachment_bytes(&original, &bytes)
            .unwrap();
        let persisted = store.get_outbound_message(original.id).unwrap();
        let attachment = &persisted.attachments[0];
        assert_ne!(attachment.local_path, original.attachments[0].local_path);
        assert_eq!(
            crate::commands::read_verified_outbound_attachment(&store, attachment).unwrap(),
            bytes[0]
        );
        let path = crate::commands::validated_attachment_read_path(&store, attachment).unwrap();
        store
            .mark_outbox_smtp_sent_pending_archive(original.id, "<sent@test.local>")
            .unwrap();
        store
            .mark_outbox_remote_archived(original.id, "Sent", 42, "100")
            .unwrap();
        store
            .prune_temp_attachments(std::time::Duration::ZERO)
            .unwrap();
        assert!(!Path::new(&original.attachments[0].local_path).exists());
        assert_eq!(fs::read(path).unwrap(), bytes[0]);
        assert!(store.list_attachments(original.id).unwrap()[0].is_downloaded);
        // Retrying archive/send persistence does not make another large copy.
        store
            .persist_sent_attachment_bytes(&persisted, &bytes)
            .unwrap();
        assert_eq!(
            fs::read_dir(store.attachment_dir(original.id))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn cache_cleanup_preserves_pending_archive_and_active_uncommitted_files() {
        let (_dir, store, original, bytes) = fixture();
        store
            .persist_sent_attachment_bytes(&original, &bytes)
            .unwrap();
        let attachment = store.list_attachments(original.id).unwrap().remove(0);
        store
            .mark_outbox_smtp_sent_pending_archive(original.id, "<accepted@test.local>")
            .unwrap();
        store
            .set_message_remote_ref(original.id, "Sent", 42)
            .unwrap();
        store.clear_reclaimable_attachment_cache().unwrap();
        assert_eq!(
            fs::read(&attachment.local_path).unwrap(),
            bytes[0],
            "an unresolved archive must retain its MIME source even with a remote UID"
        );
        store
            .mark_outbox_remote_archived(original.id, "Sent", 42, "100")
            .unwrap();
        let lease = store.hold_outbox_lease(original.id).unwrap();
        let in_progress = store
            .attachment_dir(original.id)
            .join("copy-not-yet-in-database.bin");
        fs::write(&in_progress, b"copy in progress").unwrap();
        store.clear_reclaimable_attachment_cache().unwrap();
        assert!(
            in_progress.exists(),
            "active copies have no DB row yet and still must not be pruned"
        );
        assert!(store.get_attachment(attachment.id).unwrap().is_downloaded);
        assert_eq!(fs::read(&attachment.local_path).unwrap(), bytes[0]);
        drop(lease);
        store.clear_reclaimable_attachment_cache().unwrap();
        assert!(!in_progress.exists());
        assert!(!Path::new(&attachment.local_path).exists());
        assert!(!store.get_attachment(attachment.id).unwrap().is_downloaded);
    }

    #[test]
    fn accepted_attachment_hash_remains_a_valid_source_after_temporary_auth_expires() {
        let (_dir, store, original, bytes) = fixture();
        store
            .persist_sent_attachment_bytes(&original, &bytes)
            .unwrap();
        let attachment = store.list_attachments(original.id).unwrap().remove(0);
        store
            .with_conn(|conn| {
                conn.execute(
                    "DELETE FROM outbound_attachment_auths WHERE canonical_path=?1",
                    [&attachment.local_path],
                )?;
                Ok(())
            })
            .unwrap();
        // Merely queuing a local path must not create trusted source provenance.
        assert!(crate::commands::read_verified_outbound_attachment(&store, &attachment).is_err());
        store
            .mark_outbox_smtp_sent_pending_archive(original.id, "<accepted@test.local>")
            .unwrap();
        assert_eq!(
            crate::commands::read_verified_outbound_attachment(&store, &attachment).unwrap(),
            bytes[0]
        );
        store
            .mark_outbox_remote_archived(original.id, "Sent", 42, "100")
            .unwrap();
        assert_eq!(
            crate::commands::read_verified_outbound_attachment(&store, &attachment).unwrap(),
            bytes[0]
        );
        fs::write(&attachment.local_path, vec![b'x'; bytes[0].len()]).unwrap();
        assert!(crate::commands::read_verified_outbound_attachment(&store, &attachment).is_err());
    }

    #[test]
    fn missing_attachment_repair_cannot_clear_a_newer_promoted_path() {
        let (_dir, store, original, bytes) = fixture();
        let original_attachment = &original.attachments[0];
        assert!(!store
            .is_sent_attachment(original_attachment.id, &original_attachment.local_path)
            .unwrap());
        store
            .persist_sent_attachment_bytes(&original, &bytes)
            .unwrap();
        let promoted = store.list_attachments(original.id).unwrap().remove(0);
        store
            .mark_outbox_smtp_sent_pending_archive(original.id, "<accepted@test.local>")
            .unwrap();
        assert!(store
            .is_sent_attachment(promoted.id, &promoted.local_path)
            .unwrap());
        assert!(!store
            .is_sent_attachment(promoted.id, &original_attachment.local_path)
            .unwrap());
        assert!(!store
            .mark_attachment_missing_if_path(promoted.id, &original_attachment.local_path)
            .unwrap());
        assert!(store.get_attachment(promoted.id).unwrap().is_downloaded);
        assert!(store
            .mark_attachment_missing_if_path(promoted.id, &promoted.local_path)
            .unwrap());
        let missing = store.get_attachment(promoted.id).unwrap();
        assert!(!missing.is_downloaded);
        assert!(missing.local_path.is_empty());
        assert!(
            Path::new(&promoted.local_path).exists(),
            "repair only updates metadata, never deletes files"
        );
    }

    #[test]
    fn failed_copy_keeps_original_attachment_record_and_source() {
        let (_dir, store, message, bytes) = fixture();
        fs::create_dir_all(store.attachment_root()).unwrap();
        fs::write(store.attachment_dir(message.id), b"directory unavailable").unwrap();
        assert!(store
            .persist_sent_attachment_bytes(&message, &bytes)
            .is_err());
        assert_eq!(
            store.list_attachments(message.id).unwrap()[0].local_path,
            message.attachments[0].local_path
        );
        assert_eq!(
            fs::read(&message.attachments[0].local_path).unwrap(),
            bytes[0]
        );
    }

    #[test]
    fn stale_attachment_snapshot_rolls_back_new_copies_and_auths() {
        let (_dir, store, message, bytes) = fixture();
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE attachments SET local_path='newer-path' WHERE message_id=?1",
                    [message.id],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(matches!(
            store.persist_sent_attachment_bytes(&message, &bytes),
            Err(MailError::Cancelled)
        ));
        assert_eq!(
            store.list_attachments(message.id).unwrap()[0].local_path,
            "newer-path"
        );
        assert_eq!(
            fs::read_dir(store.attachment_dir(message.id))
                .unwrap()
                .count(),
            0
        );
    }

    #[test]
    fn active_lease_is_shared_across_connections_and_only_recovered_after_drop() {
        let (dir, store, message, _bytes) = fixture();
        assert!(store.claim_outbox_message(message.id).unwrap());
        let other =
            MailStore::open_at_with_seed(dir.path().join("outbound.sqlite3"), true).unwrap();
        let lease = store.hold_outbox_lease(message.id).unwrap();
        let later = (Utc::now() + Duration::hours(1)).to_rfc3339();
        assert_eq!(other.recover_outbox_leases_at(&later).unwrap(), 0);
        assert_eq!(
            other
                .list_outbox()
                .unwrap()
                .iter()
                .find(|item| item.message_id == message.id)
                .unwrap()
                .status,
            "sending"
        );
        drop(lease);
        assert_eq!(other.recover_outbox_leases_at(&later).unwrap(), 1);
        assert_eq!(
            other
                .list_outbox()
                .unwrap()
                .iter()
                .find(|item| item.message_id == message.id)
                .unwrap()
                .status,
            "send_unknown"
        );
        assert!(!other.claim_outbox_message(message.id).unwrap());
    }

    #[test]
    fn nested_archive_leases_prevent_duplicate_claim_until_last_owner_exits() {
        let (_dir, store, message, _bytes) = fixture();
        store
            .mark_outbox_smtp_sent_pending_archive(message.id, "<sent@test.local>")
            .unwrap();
        assert!(store.claim_outbox_archive(message.id).unwrap());
        let first = store.hold_outbox_lease(message.id).unwrap();
        let second = store.hold_outbox_lease(message.id).unwrap();
        let later = (Utc::now() + Duration::hours(1)).to_rfc3339();
        drop(first);
        assert_eq!(store.recover_outbox_leases_at(&later).unwrap(), 0);
        assert!(!store.claim_outbox_archive(message.id).unwrap());
        drop(second);
        assert_eq!(store.recover_outbox_leases_at(&later).unwrap(), 1);
        assert!(store.claim_outbox_archive(message.id).unwrap());
    }

    #[test]
    fn empty_attachment_name_is_rejected_without_silently_saving_a_partial_draft() {
        let (_dir, store, _message, _bytes) = fixture();
        let before: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?)
            })
            .unwrap();
        let result = store.save_draft(DraftInput {
            draft_id: 0,
            account_id: 0,
            identity_id: 0,
            to: "recipient@example.com".into(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Must not lose attachment".into(),
            body: String::new(),
            html_body: String::new(),
            send_at: String::new(),
            attachments: vec![OutboundAttachmentInput {
                filename: "  ".into(),
                mime_type: "text/plain".into(),
                size_bytes: 1,
                local_path: "irrelevant".into(),
                content_id: String::new(),
                is_inline: false,
            }],
        });
        assert!(matches!(result, Err(MailError::SmtpPermanent(_))));
        let after: i64 = store
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?)
            })
            .unwrap();
        assert_eq!(after, before);
    }
}

#[cfg(test)]
#[path = "outbox_lifecycle_tests.rs"]
mod lifecycle_tests;
