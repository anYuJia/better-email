use super::*;
use super::accounts::{account_for_conn, map_account};
use super::attachments::attachment_count_for_message;
use super::contacts_rules::apply_enabled_rules_for_message;
use super::contacts_rules::upsert_contact;
use super::folders::{folder_id_for_account_role, folder_id_for_message_role};
use super::outbox::{create_outbound_message_for_conn, outbound_message_for_conn, update_draft_message_for_conn};
use super::outbox::{fallback_mime_type, get_outbox_item_for_conn, safe_attachment_filename};
use super::search::{SearchCriteria, build_message_filter_clause, build_message_summary_query, thread_order_clause};
use super::folders::role_for_virtual_folder_id;

impl MailStore {
    #[allow(dead_code)]
    pub fn list_messages_for_scope(
        &self,
        account_id: Option<i64>,
        folder_id: i64,
        query: Option<String>,
        filter: Option<String>,
        limit: i64,
    ) -> MailResult<Vec<MessageSummary>> {
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
    ) -> MailResult<Vec<MessageSummary>> {
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
            let sql = build_message_summary_query(
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
                    map_message_summary_row_base(row)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            hydrate_message_summary_list_metadata(conn, rows)
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
    ) -> MailResult<Vec<MessageSummary>> {
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
                       m.cc, m.bcc, m.subject, m.snippet, m.security_warnings,
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
                    map_message_summary_row_base(row)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            hydrate_message_summary_list_metadata(conn, rows)
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
                       a.signature, a.cross_account_risk_warning, a.is_default
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
                .and_then(|message| {
                    if !should_allow_remote_images_for_message(conn, &message)?
                        || !looks_like_html_fragment(&message.body)
                    {
                        return Ok(message);
                    }
                    let mut message = message;
                    message.sanitized_html =
                        crate::protocol::sanitize_html_with_remote_images(&message.body);
                    message
                        .security_warnings
                        .retain(|warning| !warning.contains("远程图片"));
                    conn.execute(
                        "
                        UPDATE messages
                        SET sanitized_html = ?2, security_warnings = ?3
                        WHERE id = ?1
                        ",
                        params![
                            message_id,
                            message.sanitized_html,
                            warning_lines_to_text(&message.security_warnings)
                        ],
                    )?;
                    Ok(message)
                })
        })
    }
    pub fn import_eml_message(&self, account_id: Option<i64>, raw: &[u8]) -> MailResult<Message> {
        let imported = protocol::parse_imported_eml_bytes(raw);
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
                let imported = protocol::parse_imported_eml_bytes(pop_message.raw.as_bytes());
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
    pub fn release_due_snoozed_messages(&self, now: &str) -> MailResult<ReleasedSnoozedCount> {
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
                return Ok(ReleasedSnoozedCount { released_count: 0 });
            }
            for message_id in &due_ids {
                let folder_id = folder_id_for_message_role(conn, *message_id, "inbox")?;
                conn.execute(
                    "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                    params![folder_id, message_id],
                )?;
            }
            Ok(ReleasedSnoozedCount {
                released_count: due_ids.len() as i64,
            })
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
        self.with_conn(|conn| {
            let message_id = create_outbound_message_for_conn(conn, input, "outbox")?;
            let queued_at = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO outbox_queue(message_id, status, attempts, last_error, queued_at, next_attempt_at)
                 VALUES (?1, 'queued', 0, '', ?2, '')",
                params![message_id, queued_at],
            )?;
            Ok(message_id)
        })
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
                        subject: protocol::decode_mime_header_value(&row.get::<_, String>(1)?),
                        message_count: row.get(2)?,
                        unread_count: row.get(3)?,
                        latest_at: row.get(4)?,
                        participants: decode_thread_participants(&row.get::<_, String>(5)?),
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
}

pub(super) fn warning_lines_to_text(warnings: &[String]) -> String {
    warnings
        .iter()
        .map(|warning| warning.trim())
        .filter(|warning| !warning.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}
pub(super) fn warning_lines_from_text(raw: String) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|warning| !warning.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}
pub(super) fn normalize_remote_image_trust_scope(scope: &str) -> MailResult<String> {
    match scope.trim().to_ascii_lowercase().as_str() {
        "sender" => Ok("sender".to_string()),
        "domain" => Ok("domain".to_string()),
        _ => Err(MailError::Imap(
            "远程图片信任范围必须是 sender 或 domain。".to_string(),
        )),
    }
}
pub(super) fn normalize_remote_image_trust_value(scope: &str, value: &str) -> MailResult<String> {
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
pub(super) fn map_remote_image_trust(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteImageTrust> {
    Ok(RemoteImageTrust {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_email: row.get(2)?,
        scope: row.get(3)?,
        value: row.get(4)?,
        created_at: row.get(5)?,
    })
}
pub(super) fn should_allow_remote_images_for_message(
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
pub(super) fn looks_like_html_fragment(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "<html", "<body", "<div", "<p", "<table", "<a ", "<img", "<span",
    ]
    .iter()
    .any(|tag| lower.contains(tag))
}
pub(super) fn message_for_conn(conn: &Connection, message_id: i64) -> MailResult<Message> {
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
        |row| map_message_row(conn, row),
    )
    .map_err(Into::into)
}
pub(super) fn decode_thread_participants(value: &str) -> String {
    value
        .split(',')
        .map(|participant| {
            protocol::decode_mime_header_value(participant)
                .trim()
                .to_string()
        })
        .filter(|participant| !participant.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}
pub(super) fn map_message_row(conn: &Connection, row: &Row<'_>) -> rusqlite::Result<Message> {
    let mut message = map_message_row_base(row)?;
    message.labels = labels_for_message(conn, message.id)?;
    message.attachment_count = attachment_count_for_message(conn, message.id)?;
    Ok(message)
}
pub(super) fn map_message_row_base(row: &Row<'_>) -> rusqlite::Result<Message> {
    let message_id: i64 = row.get(0)?;
    Ok(Message {
        id: message_id,
        account_id: row.get(1)?,
        account_email: row.get(2)?,
        folder_id: row.get(3)?,
        folder_role: row.get(4)?,
        sender_name: protocol::decode_address_header_value(&row.get::<_, String>(5)?),
        sender_email: row.get(6)?,
        recipients: protocol::decode_address_header_value(&row.get::<_, String>(7)?),
        cc: protocol::decode_address_header_value(&row.get::<_, String>(8)?),
        bcc: protocol::decode_address_header_value(&row.get::<_, String>(9)?),
        subject: protocol::decode_mime_header_value(&row.get::<_, String>(10)?),
        snippet: row.get(11)?,
        body: row.get(12)?,
        sanitized_html: row.get(13)?,
        security_warnings: warning_lines_from_text(row.get(14)?),
        received_at: row.get(15)?,
        is_read: row.get::<_, i64>(16)? != 0,
        is_starred: row.get::<_, i64>(17)? != 0,
        has_attachments: row.get::<_, i64>(18)? != 0,
        snoozed_until: row.get(19)?,
        labels: Vec::new(),
        attachment_count: 0,
        remote_mailbox: row.get(20)?,
        remote_uid: row.get(21)?,
        message_id_header: row.get(22)?,
        in_reply_to_header: row.get(23)?,
        references_header: row.get(24)?,
    })
}
#[allow(dead_code)]
pub(super) fn hydrate_message_list_metadata(
    conn: &Connection,
    mut messages: Vec<Message>,
) -> MailResult<Vec<Message>> {
    if messages.is_empty() {
        return Ok(messages);
    }

    let message_ids = messages
        .iter()
        .map(|message| message.id)
        .collect::<Vec<_>>();
    let placeholders = std::iter::repeat_n("?", message_ids.len())
        .collect::<Vec<_>>()
        .join(", ");

    let label_sql = format!(
        "
        SELECT ml.message_id, l.name
        FROM message_labels ml
        JOIN labels l ON l.id = ml.label_id
        WHERE ml.message_id IN ({placeholders})
        ORDER BY ml.message_id, l.name
        "
    );
    let label_params = message_ids
        .iter()
        .copied()
        .map(Value::Integer)
        .collect::<Vec<_>>();
    let mut labels_by_message = BTreeMap::<i64, Vec<String>>::new();
    {
        let mut stmt = conn.prepare(&label_sql)?;
        let labels = stmt.query_map(params_from_iter(label_params), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        for item in labels {
            let (message_id, label) = item?;
            labels_by_message.entry(message_id).or_default().push(label);
        }
    }

    let attachment_sql = format!(
        "
        SELECT message_id, COUNT(*) AS attachment_count
        FROM attachments
        WHERE message_id IN ({placeholders})
        GROUP BY message_id
        "
    );
    let attachment_params = message_ids
        .iter()
        .copied()
        .map(Value::Integer)
        .collect::<Vec<_>>();
    let mut attachment_counts = BTreeMap::<i64, i64>::new();
    {
        let mut stmt = conn.prepare(&attachment_sql)?;
        let counts = stmt.query_map(params_from_iter(attachment_params), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?;
        for item in counts {
            let (message_id, count) = item?;
            attachment_counts.insert(message_id, count);
        }
    }

    for message in &mut messages {
        message.labels = labels_by_message.remove(&message.id).unwrap_or_default();
        message.attachment_count = attachment_counts.remove(&message.id).unwrap_or(0);
    }
    Ok(messages)
}
pub(super) fn map_message_summary_row_base(row: &Row<'_>) -> rusqlite::Result<MessageSummary> {
    let message_id: i64 = row.get(0)?;
    Ok(MessageSummary {
        id: message_id,
        account_id: row.get(1)?,
        account_email: row.get(2)?,
        folder_id: row.get(3)?,
        folder_role: row.get(4)?,
        sender_name: protocol::decode_address_header_value(&row.get::<_, String>(5)?),
        sender_email: row.get(6)?,
        recipients: protocol::decode_address_header_value(&row.get::<_, String>(7)?),
        cc: protocol::decode_address_header_value(&row.get::<_, String>(8)?),
        bcc: protocol::decode_address_header_value(&row.get::<_, String>(9)?),
        subject: protocol::decode_mime_header_value(&row.get::<_, String>(10)?),
        snippet: row.get(11)?,
        security_warnings: warning_lines_from_text(row.get(12)?),
        received_at: row.get(13)?,
        is_read: row.get::<_, i64>(14)? != 0,
        is_starred: row.get::<_, i64>(15)? != 0,
        has_attachments: row.get::<_, i64>(16)? != 0,
        snoozed_until: row.get(17)?,
        labels: Vec::new(),
        attachment_count: 0,
        remote_mailbox: row.get(18)?,
        remote_uid: row.get(19)?,
        message_id_header: row.get(20)?,
        in_reply_to_header: row.get(21)?,
        references_header: row.get(22)?,
    })
}
pub(super) fn hydrate_message_summary_list_metadata(
    conn: &Connection,
    mut messages: Vec<MessageSummary>,
) -> MailResult<Vec<MessageSummary>> {
    if messages.is_empty() {
        return Ok(messages);
    }

    let message_ids = messages
        .iter()
        .map(|message| message.id)
        .collect::<Vec<_>>();
    let placeholders = std::iter::repeat_n("?", message_ids.len())
        .collect::<Vec<_>>()
        .join(", ");

    let label_sql = format!(
        "
        SELECT ml.message_id, l.name
        FROM message_labels ml
        JOIN labels l ON l.id = ml.label_id
        WHERE ml.message_id IN ({placeholders})
        ORDER BY ml.message_id, l.name
        "
    );
    let label_params = message_ids
        .iter()
        .copied()
        .map(Value::Integer)
        .collect::<Vec<_>>();
    let mut labels_by_message = BTreeMap::<i64, Vec<String>>::new();
    {
        let mut stmt = conn.prepare(&label_sql)?;
        let labels = stmt.query_map(params_from_iter(label_params), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        for item in labels {
            let (message_id, label) = item?;
            labels_by_message.entry(message_id).or_default().push(label);
        }
    }

    let attachment_sql = format!(
        "
        SELECT message_id, COUNT(*) AS attachment_count
        FROM attachments
        WHERE message_id IN ({placeholders})
        GROUP BY message_id
        "
    );
    let attachment_params = message_ids
        .iter()
        .copied()
        .map(Value::Integer)
        .collect::<Vec<_>>();
    let mut attachment_counts = BTreeMap::<i64, i64>::new();
    {
        let mut stmt = conn.prepare(&attachment_sql)?;
        let counts = stmt.query_map(params_from_iter(attachment_params), |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })?;
        for item in counts {
            let (message_id, count) = item?;
            attachment_counts.insert(message_id, count);
        }
    }

    for message in &mut messages {
        message.labels = labels_by_message.remove(&message.id).unwrap_or_default();
        message.attachment_count = attachment_counts.remove(&message.id).unwrap_or(0);
    }
    Ok(messages)
}
pub(super) fn message_remote_ref_for_conn(conn: &Connection, message_id: i64) -> MailResult<MessageRemoteRef> {
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
pub(super) fn trash_remote_refs_for_conn(
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
pub(super) fn due_snoozed_message_ids(now: &str, rows: Vec<(i64, String)>) -> Vec<i64> {
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
pub(super) fn labels_for_message(conn: &Connection, message_id: i64) -> rusqlite::Result<Vec<String>> {
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
pub(super) fn scalar_count_values(conn: &Connection, sql: &str, values: Vec<Value>) -> MailResult<i64> {
    conn.query_row(sql, params_from_iter(values), |row| row.get(0))
        .map_err(Into::into)
}
pub(super) fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}
pub(super) fn normalized_subject(subject: &str) -> String {
    if subject.trim().is_empty() {
        "(无主题)".to_string()
    } else {
        subject.trim().to_string()
    }
}
pub(super) fn normalized_thread_subject(subject: &str) -> String {
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
pub(super) fn first_message_id(value: &str) -> Option<String> {
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
pub(super) fn thread_key_for_message(
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
pub(super) fn normalize_thread_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
pub(super) fn snippet_from_body(body: &str) -> String {
    body.lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

