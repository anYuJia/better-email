use super::*;
use super::accounts::{account_for_conn, identity_for_draft_conn};
use super::attachments::attachments_for_message_conn;
use super::contacts_rules::upsert_contact;
use super::folders::{folder_id_for_account_role, folder_id_for_message_role};
use super::messages::{bool_to_int, normalized_subject, snippet_from_body};

impl MailStore {
    pub fn list_outbox(&self) -> MailResult<Vec<OutboxItem>> {
        self.with_conn(list_outbox_for_conn)
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
                WHERE q.status IN ('queued', 'retry', 'scheduled')
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
                  AND next_attempt_at <= ?1
                ",
                params![now],
            )?;
            list_outbox_for_conn(conn)
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
    pub fn mark_outbox_blocked(&self, message_id: i64, error: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE outbox_queue
                SET status = 'failed',
                    attempts = attempts + 1,
                    last_error = ?2,
                    next_attempt_at = ''
                WHERE message_id = ?1
                ",
                params![message_id, error.chars().take(500).collect::<String>(),],
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
                WHERE status IN ('queued', 'retry', 'scheduled')
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
    pub(super) fn create_outbound_message(&self, input: DraftInput, role: &str) -> MailResult<i64> {
        self.with_conn(|conn| create_outbound_message_for_conn(conn, input, role))
    }
}

pub(super) fn create_outbound_message_for_conn(
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
pub(super) fn update_draft_message_for_conn(conn: &Connection, input: DraftInput) -> MailResult<i64> {
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
pub(super) fn replace_outbound_attachments_for_conn(
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
pub(super) fn outbound_message_for_conn(conn: &Connection, message_id: i64) -> MailResult<OutboundMessage> {
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
        ORDER BY q.queued_at DESC
        LIMIT 50
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

