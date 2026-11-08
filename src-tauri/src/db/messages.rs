use super::accounts::{account_for_conn, map_account};
use super::attachments::attachment_count_for_message;
use super::contacts_rules::upsert_contact;
use super::contacts_rules::{apply_deferred_message_rules, apply_enabled_rules_for_message};
use super::folders::role_for_virtual_folder_id;
use super::folders::{folder_id_for_account_role, folder_id_for_message_role};
use super::outbox::{
    create_outbound_message_for_conn, outbound_message_for_conn, update_draft_message_for_conn,
};
use super::outbox::{fallback_mime_type, get_outbox_item_for_conn, safe_attachment_filename};
use super::search::{
    build_message_filter_clause, build_message_summary_query, thread_order_clause, SearchCriteria,
};
use super::*;

pub(super) fn queue_remote_intent_for_conn(
    conn: &Connection,
    message_id: i64,
    kind: &str,
    value: &str,
) -> MailResult<()> {
    // A UID generation reset may have detached a pending message from its
    // remote identity. Keep its existing intent current even though it cannot
    // safely be sent until the identity has been resolved.
    conn.execute(
        "UPDATE pending_remote_writes SET value = ?3, created_at = ?4 WHERE message_id = ?1 AND kind = ?2",
        params![message_id, kind, value, Utc::now().to_rfc3339()],
    )?;
    conn.execute(
        "INSERT INTO pending_remote_writes(message_id, kind, value, created_at)
         SELECT m.id, ?2, ?3, ?4 FROM messages m JOIN accounts a ON a.id = m.account_id
         WHERE m.id = ?1 AND lower(trim(a.incoming_protocol)) != 'pop3'
           AND trim(m.remote_mailbox) != '' AND m.remote_uid > 0
         ON CONFLICT(message_id, kind) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
        params![message_id, kind, value, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn suppress_deferred_rule_actions(conn: &Connection, message_id: i64, bits: i64) -> MailResult<()> {
    conn.execute("UPDATE pending_message_rules SET suppressed_actions = suppressed_actions | ?2 WHERE message_id = ?1", params![message_id, bits])?;
    Ok(())
}

pub(super) fn build_thread_summary_query(
    scope_condition: &str,
    filter_clause: &str,
    order_clause: &str,
) -> String {
    format!(
        "
        WITH scoped_messages AS (
            SELECT m.id, m.account_id, m.thread_key, m.subject, m.sender_name,
                   m.snippet, m.received_at, m.is_read
            FROM messages m
            JOIN accounts a ON a.id = m.account_id
            JOIN folders f ON f.id = m.folder_id
            WHERE {scope_condition} {filter_clause}
        ),
        ranked_messages AS (
            SELECT scoped_messages.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY thread_key
                       ORDER BY received_at DESC, id DESC
                   ) AS latest_rank
            FROM scoped_messages
        ),
        thread_rows AS (
            SELECT ranked.thread_key,
                   COALESCE(
                       MAX(CASE WHEN ranked.latest_rank = 1 THEN ranked.subject END),
                       '(无主题)'
                   ) AS subject,
                   COUNT(*) AS message_count,
                   SUM(CASE WHEN ranked.is_read = 0 THEN 1 ELSE 0 END) AS unread_count,
                   MAX(ranked.received_at) AS latest_at,
                   COALESCE(
                       MAX(CASE WHEN ranked.latest_rank = 1 THEN ranked.snippet END),
                       ''
                   ) AS latest_preview,
                   GROUP_CONCAT(DISTINCT ranked.sender_name) AS participants,
                   MAX(CASE WHEN muted.account_id IS NOT NULL THEN 1 ELSE 0 END) AS is_muted
            FROM ranked_messages ranked
            LEFT JOIN muted_threads muted
              ON muted.account_id = ranked.account_id
             AND muted.thread_key = ranked.thread_key
            GROUP BY ranked.thread_key
        )
        SELECT scoped.thread_key, scoped.subject, scoped.message_count,
               scoped.unread_count, scoped.latest_at, scoped.latest_preview,
               scoped.participants, scoped.is_muted
        FROM thread_rows scoped
        ORDER BY {order_clause}
        LIMIT ?
        ",
    )
}

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
        self.list_messages_for_scope_sorted_page(
            account_id, folder_id, query, filter, sort, 0, limit,
        )
    }

    /// Reads one stable page of a message scope. Keeping the page size capped
    /// protects the renderer and SQLite memory use; callers can advance with
    /// `offset` instead of repeatedly asking for a larger (and eventually
    /// clamped) LIMIT.
    // Scope, filtering, sorting, and paging are independent SQL dimensions;
    // keeping them explicit avoids an opaque parameter object at this DB seam.
    #[allow(clippy::too_many_arguments)]
    pub fn list_messages_for_scope_sorted_page(
        &self,
        account_id: Option<i64>,
        folder_id: i64,
        query: Option<String>,
        filter: Option<String>,
        sort: Option<String>,
        offset: i64,
        limit: i64,
    ) -> MailResult<Vec<MessageSummary>> {
        self.with_read_conn(|conn| {
            let limit = limit.clamp(1, 200);
            let offset = offset.max(0);
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
            query_params.push(Value::Integer(offset));
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params_from_iter(query_params), |row| {
                    map_message_summary_row_base(row)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            hydrate_message_summary_list_metadata(conn, rows)
        })
    }

    /// Returns the exact number of messages for the same account/folder/search
    /// scope used by `list_messages_for_scope_sorted_page`.
    ///
    /// Keep this query separate from the paged list query so the title bar can
    /// show the full result count without loading every row into memory.
    #[allow(clippy::too_many_arguments)]
    pub fn count_messages_for_scope(
        &self,
        account_id: Option<i64>,
        folder_id: i64,
        query: Option<String>,
        filter: Option<String>,
    ) -> MailResult<i64> {
        self.with_read_conn(|conn| {
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

            let filter_clause = build_message_filter_clause(&search_criteria, &filter);
            let mut conditions = Vec::new();
            let scope = scope_conditions.join(" AND ");
            if !scope.trim().is_empty() {
                conditions.push(scope);
            }
            let filter = filter_clause.trim().trim_start_matches("AND").trim();
            if !filter.is_empty() {
                conditions.push(filter.to_string());
            }
            let sql = format!(
                "SELECT COUNT(*)
                 FROM messages m
                 JOIN accounts a ON a.id = m.account_id
                 JOIN folders f ON f.id = m.folder_id
                 {}",
                if conditions.is_empty() {
                    String::new()
                } else {
                    format!("WHERE {}", conditions.join(" AND "))
                },
            );
            query_params.extend(search_criteria.params().into_iter().map(Value::Text));
            conn.query_row(&sql, params_from_iter(query_params), |row| row.get(0))
                .map_err(Into::into)
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
    pub fn get_message_remote_reference(&self, message_id: i64) -> MailResult<MessageRemoteRef> {
        self.with_conn(|conn| message_remote_ref_for_conn(conn, message_id))
    }
    #[cfg(test)]
    pub fn set_message_remote_ref(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
    ) -> MailResult<()> {
        self.set_message_remote_ref_with_validity(message_id, remote_mailbox, remote_uid, "")
    }

    #[cfg(test)]
    pub fn set_message_remote_ref_with_validity(
        &self,
        message_id: i64,
        remote_mailbox: &str,
        remote_uid: i64,
        remote_uid_validity: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET remote_mailbox=?2, remote_uid=?3, remote_uid_validity=?4 WHERE id=?1",
                params![message_id, remote_mailbox.trim(), remote_uid.max(0), remote_uid_validity],
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
        remote_uid_validity: &str,
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
                    thread_key = ?5,
                    remote_uid_validity = ?6
                WHERE id = ?1
                ",
                params![
                    message_id,
                    remote_mailbox.trim(),
                    remote_uid.max(0),
                    message_id_header.trim(),
                    thread_key,
                    remote_uid_validity
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
        let (mut message, needs_upgrade) = self.with_conn(|conn| {
            let message = message_for_conn(conn, message_id)?;
            let needs_upgrade: bool = conn.query_row(
                "SELECT sanitizer_version < 1 AND NOT EXISTS(SELECT 1 FROM outbox_queue WHERE message_id=?1) FROM messages WHERE id=?1",
                [message_id], |row| row.get(0),
            )?;
            let needs_upgrade = needs_upgrade && !matches!(message.folder_role.as_str(), "drafts" | "outbox");
            Ok((message, needs_upgrade))
        })?;
        if !needs_upgrade {
            return Ok(message);
        }
        // Legacy truncation recovery can parse megabytes. Do it after releasing
        // SQLite, then compare the source before persisting the repaired HTML.
        let previous_html = message.sanitized_html.clone();
        if looks_like_html_fragment(&message.body) && message.body.len() > 20_000 {
            message.sanitized_html = if crate::protocol::html_has_remote_images(&previous_html) {
                super::trusted_html_cache::sanitize(&self.trusted_html, message.id, &message.body)
            } else {
                crate::protocol::sanitize_html(&message.body)
            };
        }
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET sanitized_html=?2, sanitizer_version=1
                 WHERE id=?1 AND body=?3 AND sanitized_html=?4 AND sanitizer_version<1
                   AND NOT EXISTS(SELECT 1 FROM outbox_queue WHERE message_id=?1)
                   AND folder_id NOT IN (SELECT id FROM folders WHERE role IN ('drafts','outbox'))",
                params![
                    message_id,
                    message.sanitized_html,
                    message.body,
                    previous_html
                ],
            )?;
            message_for_conn(conn, message_id)
        })
    }
    /// 按本地 message id 批量取消息（新邮件通知候选来源）。
    pub fn list_messages_by_ids(&self, message_ids: &[i64]) -> MailResult<Vec<Message>> {
        if message_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.with_conn(|conn| {
            let placeholders = std::iter::repeat_n("?", message_ids.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
                       m.cc, m.bcc, m.subject, m.snippet, m.body, m.sanitized_html, m.security_warnings,
                       m.received_at, m.is_read, m.is_starred, m.has_attachments,
                       m.snoozed_until, m.remote_mailbox, m.remote_uid,
                       m.message_id_header, m.in_reply_to_header, m.references_header, m.remote_body_fetched
                FROM messages m
                JOIN accounts a ON a.id = m.account_id
                JOIN folders f ON f.id = m.folder_id
                WHERE m.id IN ({placeholders})
                ORDER BY m.received_at DESC",
            );
            let params = message_ids.iter().map(|id| Value::Integer(*id)).collect::<Vec<_>>();
            let mut stmt = conn.prepare(&sql)?;
            let messages = stmt
                .query_map(params_from_iter(params), |row| map_message_row(conn, row))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(messages)
        })
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
                       a.signature, a.cross_account_risk_warning,
                       a.block_external_mailboxes, a.intercept_https_links, a.auto_download_attachments,
                       a.fetch_history_attachments, a.warn_external_senders, a.onboarding_completed, a.is_default
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
        self.render_message_with_remote_image_policy(message_id, |message| {
            super::trusted_html_cache::sanitize(&self.trusted_html, message.id, &message.body)
        })
    }

    fn render_message_with_remote_image_policy(
        &self,
        message_id: i64,
        render: impl FnOnce(&Message) -> String,
    ) -> MailResult<Message> {
        let message = self.get_message(message_id)?;
        let allow_remote =
            self.with_conn(|conn| should_allow_remote_images_for_message(conn, &message))?;
        // Sanitization is CPU work, not database work. Never hold the shared
        // connection while parsing a potentially very large trusted message.
        if !allow_remote || !looks_like_html_fragment(&message.body) {
            return Ok(message);
        }
        let html = render(&message);
        let (mut current, still_allowed) = self.with_conn(|conn| {
            let current = message_for_conn(conn, message_id)?;
            let still_allowed = should_allow_remote_images_for_message(conn, &current)?;
            Ok((current, still_allowed))
        })?;
        if still_allowed
            && current.body == message.body
            && current.sanitized_html == message.sanitized_html
        {
            current.sanitized_html = html;
            current
                .security_warnings
                .retain(|warning| !warning.contains("远程图片"));
        } else {
            // Trust/source changed while parsing. Use the newest source with
            // the conservative policy; do not return the old trusted render.
            // This fallback also stays outside the shared SQLite mutex.
            current.sanitized_html = crate::protocol::sanitize_html(&current.body);
            if crate::protocol::html_has_remote_images(&current.body)
                && !current
                    .security_warnings
                    .iter()
                    .any(|warning| warning.contains("远程图片"))
            {
                current
                    .security_warnings
                    .push("检测到远程图片，默认已阻止自动加载。".into());
            }
        }
        Ok(current)
    }
    pub fn persist_message_remote_images_once(&self, message_id: i64) -> MailResult<Message> {
        self.persist_remote_image_render(self.get_message(message_id)?, false)
    }

    fn persist_remote_image_render(
        &self,
        message: Message,
        require_trust: bool,
    ) -> MailResult<Message> {
        let html = if looks_like_html_fragment(&message.body) {
            super::trusted_html_cache::sanitize(&self.trusted_html, message.id, &message.body)
        } else {
            message.sanitized_html.clone()
        };
        self.with_conn(|conn| {
            let mut current = message_for_conn(conn, message.id)?;
            // A concurrent body refresh or trust revocation must win over a
            // rendering job that started with an older snapshot.
            if current.body != message.body
                || current.sanitized_html != message.sanitized_html
                || (require_trust && !should_allow_remote_images_for_message(conn, &current)?)
            {
                return Ok(current);
            }
            current.sanitized_html = html;
            current
                .security_warnings
                .retain(|warning| !warning.contains("远程图片"));
            conn.execute(
                "UPDATE messages SET sanitized_html=?2, security_warnings=?3 WHERE id=?1",
                params![
                    current.id,
                    current.sanitized_html,
                    warning_lines_to_text(&current.security_warnings)
                ],
            )?;
            Ok(current)
        })
    }
    #[cfg(test)]
    pub fn update_message_body(
        &self,
        message_id: i64,
        body: &RemoteMessageBody,
    ) -> MailResult<Message> {
        self.update_message_body_checked(message_id, body, None)
    }

    pub fn update_message_body_from_remote(
        &self,
        message_id: i64,
        body: &RemoteMessageBody,
        expected: &MessageRemoteRef,
    ) -> MailResult<Message> {
        self.update_message_body_checked(message_id, body, Some(expected))
    }

    fn update_message_body_checked(
        &self,
        message_id: i64,
        body: &RemoteMessageBody,
        expected: Option<&MessageRemoteRef>,
    ) -> MailResult<Message> {
        let message = self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let conn = &transaction;
            if let Some(expected) = expected {
                let actual = message_remote_ref_for_conn(conn, message_id)?;
                if actual.account_id != expected.account_id
                    || actual.remote_mailbox != expected.remote_mailbox
                    || actual.remote_uid != expected.remote_uid
                    || actual.remote_uid_validity != expected.remote_uid_validity
                {
                    return Err(MailError::Cancelled);
                }
            }
            let has_attachments = body.has_attachments || !body.attachments.is_empty();
            conn.execute(
                "
                UPDATE messages
                SET body = ?2, sanitized_html = ?3, security_warnings = ?4, snippet = ?5,
                    has_attachments = CASE WHEN ?7 THEN ?6 ELSE MAX(has_attachments, ?6) END,
                    sanitizer_version = 1, remote_body_fetched = 1
                WHERE id = ?1
                ",
                params![
                    message_id,
                    body.body,
                    body.sanitized_html,
                    warning_lines_to_text(&body.security_warnings),
                    body.snippet,
                    bool_to_int(has_attachments),
                    body.attachments_complete
                ],
            )?;
            // Only a complete MIME/BODYSTRUCTURE response owns attachment
            // metadata. Body-only responses retain the existing sent/downloaded
            // records; complete responses also mark remote backfill complete.
            if body.attachments_complete {
                replace_message_attachments_for_conn(
                    conn,
                    message_id,
                    &body.attachments,
                    body.has_attachments,
                )?;
            }
            apply_deferred_message_rules(conn, message_id)?;
            let message = message_for_conn(conn, message_id)?;
            transaction.commit()?;
            Ok(message)
        })?;
        let allow_remote =
            self.with_conn(|conn| should_allow_remote_images_for_message(conn, &message))?;
        if allow_remote && looks_like_html_fragment(&message.body) {
            self.persist_remote_image_render(message, true)
        } else {
            Ok(message)
        }
    }
    /// Backfill attachment metadata without overwriting an already cached body.
    #[cfg(test)]
    pub fn update_message_attachments(
        &self,
        message_id: i64,
        attachments: &[crate::models::RemoteAttachmentMetadata],
    ) -> MailResult<Message> {
        self.update_message_attachments_checked(message_id, attachments, None)
    }
    pub fn update_message_attachments_from_remote(
        &self,
        message_id: i64,
        attachments: &[crate::models::RemoteAttachmentMetadata],
        expected: &MessageRemoteRef,
    ) -> MailResult<Message> {
        self.update_message_attachments_checked(message_id, attachments, Some(expected))
    }
    fn update_message_attachments_checked(
        &self,
        message_id: i64,
        attachments: &[crate::models::RemoteAttachmentMetadata],
        expected: Option<&MessageRemoteRef>,
    ) -> MailResult<Message> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            if let Some(expected) = expected {
                let actual = message_remote_ref_for_conn(&transaction, message_id)?;
                if actual.account_id != expected.account_id
                    || actual.remote_mailbox != expected.remote_mailbox
                    || actual.remote_uid != expected.remote_uid
                    || actual.remote_uid_validity != expected.remote_uid_validity
                {
                    return Err(MailError::Cancelled);
                }
            }
            replace_message_attachments_for_conn(&transaction, message_id, attachments, false)?;
            let message = message_for_conn(&transaction, message_id)?;
            transaction.commit()?;
            Ok(message)
        })
    }
    pub fn list_messages_missing_body(
        &self,
        account_id: i64,
        remote_mailbox: &str,
        limit: i64,
    ) -> MailResult<Vec<(i64, i64)>> {
        self.with_conn(|conn| {
            let limit = limit.max(1);
            let oldest_limit = (limit + 1) / 2;
            let newest_limit = limit / 2;
            // 公平分层回填：一半最老优先，保证大量历史积压持续推进；
            // 一半最新优先，保证新邮件正文的交互优先级不退化。
            let mut combined = Vec::with_capacity(limit as usize);
            let mut seen = BTreeSet::new();
            {
                let mut stmt = conn.prepare(
                    "
                    SELECT id, remote_uid
                    FROM messages
                    WHERE account_id = ?1
                      AND remote_mailbox = ?2
                      AND remote_uid > 0
                      AND body = ''
                      AND remote_body_fetched = 0
                      AND NOT EXISTS (SELECT 1 FROM outbox_queue WHERE message_id = messages.id)
                    ORDER BY id ASC
                    LIMIT ?3
                    ",
                )?;
                let rows = stmt
                    .query_map(params![account_id, remote_mailbox, oldest_limit], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, uid) in rows {
                    combined.push((id, uid));
                    seen.insert(id);
                }
            }
            if newest_limit > 0 {
                let mut stmt = conn.prepare(
                    "
                    SELECT id, remote_uid
                    FROM messages
                    WHERE account_id = ?1
                      AND remote_mailbox = ?2
                      AND remote_uid > 0
                      AND body = ''
                      AND remote_body_fetched = 0
                      AND NOT EXISTS (SELECT 1 FROM outbox_queue WHERE message_id = messages.id)
                    ORDER BY id DESC
                    LIMIT ?3
                    ",
                )?;
                let rows = stmt
                    .query_map(params![account_id, remote_mailbox, newest_limit], |row| {
                        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                for (id, uid) in rows {
                    if seen.insert(id) {
                        combined.push((id, uid));
                    }
                }
            }
            Ok(combined)
        })
    }
    pub fn list_messages_missing_attachment_metadata(
        &self,
        account_id: i64,
        remote_mailbox: &str,
        limit: i64,
    ) -> MailResult<Vec<(i64, i64)>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, remote_uid
                FROM messages
                WHERE account_id = ?1
                  AND remote_mailbox = ?2
                  AND remote_uid > 0
                  AND (body <> '' OR remote_body_fetched = 1)
                  AND attachment_metadata_synced = 0
                ORDER BY id ASC
                LIMIT ?3
                ",
            )?;
            let rows = stmt
                .query_map(params![account_id, remote_mailbox, limit.max(1)], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    }
    pub fn list_remote_uids_for_mailbox(
        &self,
        account_id: i64,
        remote_mailbox: &str,
    ) -> MailResult<std::collections::BTreeSet<i64>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT remote_uid
                FROM messages
                WHERE account_id = ?1
                  AND remote_mailbox = ?2
                  AND remote_uid > 0
                ",
            )?;
            let uids = stmt
                .query_map(params![account_id, remote_mailbox], |row| {
                    row.get::<_, i64>(0)
                })?
                .collect::<Result<std::collections::BTreeSet<_>, _>>()?;
            Ok(uids)
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
            conn.execute(
                "UPDATE messages SET attachment_metadata_synced = 1 WHERE id = ?1",
                params![message_id],
            )?;
            upsert_contact(
                conn,
                account.id,
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
                    SET subject = ?1,
                        snippet = ?2,
                        body = ?3,
                        sanitized_html = ?4,
                        security_warnings = ?5,
                        received_at = ?6,
                        has_attachments = ?7,
                        attachment_metadata_synced = 1,
                        thread_key = ?8,
                        message_id_header = ?9,
                        in_reply_to_header = ?10,
                        references_header = ?11
                    WHERE account_id = ?12
                      AND remote_mailbox = 'POP3/INBOX'
                      AND remote_uid = ?13
                    ",
                    params![
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
                        remote_uid, message_id_header, in_reply_to_header, references_header,
                        attachment_metadata_synced
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                            0, 0, ?14, ?15, 'POP3/INBOX', ?16, ?17, ?18, ?19, 1)
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
                    account_id,
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
    #[cfg(test)]
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
            let transaction = conn.unchecked_transaction()?;
            let conn = &transaction;
            if is_virtual && role.trim().is_empty() {
                return Err(MailError::Imap(
                    "虚拟文件夹缺少角色，无法批量标为已读。".to_string(),
                ));
            }

            let unread_messages = if is_virtual {
                let mut stmt = conn.prepare(
                    "
                    SELECT m.id
                    FROM messages m
                    JOIN folders f ON f.id = m.folder_id
                    WHERE m.is_read = 0 AND f.role = ?1
                    ORDER BY m.account_id ASC, m.remote_mailbox ASC, m.remote_uid ASC
                    ",
                )?;
                let rows = stmt
                    .query_map(params![role], |row| {
                        Ok(UnreadMessageRemoteRef {
                            message_id: row.get(0)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            } else {
                let mut stmt = conn.prepare(
                    "
                    SELECT id
                    FROM messages
                    WHERE is_read = 0 AND folder_id = ?1
                    ORDER BY remote_mailbox ASC, remote_uid ASC
                    ",
                )?;
                let rows = stmt
                    .query_map(params![folder_id], |row| {
                        Ok(UnreadMessageRemoteRef {
                            message_id: row.get(0)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };

            if unread_messages.is_empty() {
                transaction.commit()?;
                return Ok(unread_messages);
            }

            for message in &unread_messages {
                suppress_deferred_rule_actions(conn, message.message_id, 1)?;
                queue_remote_intent_for_conn(conn, message.message_id, "seen", "1")?;
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

            transaction.commit()?;
            Ok(unread_messages)
        })
    }

    /// Commit the local edit and its remote intent together so a crash or sync
    /// cannot silently discard an edit before it has been written back.
    pub fn apply_local_remote_intent(
        &self,
        message_id: i64,
        kind: &str,
        value: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            match kind {
                "seen" => {
                    transaction.execute(
                        "UPDATE messages SET is_read = ?1 WHERE id = ?2",
                        params![i64::from(value == "1"), message_id],
                    )?;
                }
                "flagged" => {
                    transaction.execute(
                        "UPDATE messages SET is_starred = ?1 WHERE id = ?2",
                        params![i64::from(value == "1"), message_id],
                    )?;
                }
                "move" => {
                    let folder_id = folder_id_for_message_role(&transaction, message_id, value)?;
                    transaction.execute(
                        "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                        params![folder_id, message_id],
                    )?;
                }
                _ => return Err(MailError::Imap("不支持的远端操作。".into())),
            }
            let bits = match kind {
                "seen" => 1,
                "flagged" => 2,
                "move" => 4,
                _ => 0,
            };
            suppress_deferred_rule_actions(&transaction, message_id, bits)?;
            queue_remote_intent_for_conn(&transaction, message_id, kind, value)?;
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn clear_pending_remote_write_if_unchanged(
        &self,
        pending: &PendingRemoteWrite,
    ) -> MailResult<bool> {
        self.with_conn(|conn| Ok(conn.execute(
            "DELETE FROM pending_remote_writes WHERE message_id = ?1 AND kind = ?2 AND value = ?3 AND created_at = ?4",
            params![pending.message_id, pending.kind, pending.value, pending.created_at],
        )? == 1))
    }

    pub fn finish_pending_move(
        &self,
        pending: &PendingRemoteWrite,
        expected: &MessageRemoteRef,
        mailbox: &str,
        uid: i64,
        validity: &str,
    ) -> MailResult<bool> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let actual = message_remote_ref_for_conn(&transaction, pending.message_id)?;
            if actual.account_id != expected.account_id || actual.remote_mailbox != expected.remote_mailbox
                || actual.remote_uid != expected.remote_uid || actual.remote_uid_validity != expected.remote_uid_validity {
                return Ok(false);
            }
            let cleared = transaction.execute(
                "DELETE FROM pending_remote_writes WHERE message_id = ?1 AND kind = ?2 AND value = ?3 AND created_at = ?4",
                params![pending.message_id, pending.kind, pending.value, pending.created_at],
            )?;
            transaction.execute("UPDATE messages SET remote_mailbox = ?1, remote_uid = ?2, remote_uid_validity = ?3 WHERE id = ?4", params![mailbox, uid, validity, pending.message_id])?;
            transaction.commit()?;
            Ok(cleared == 1)
        })
    }
    #[cfg(test)]
    pub fn set_message_starred(&self, message_id: i64, is_starred: bool) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET is_starred = ?1 WHERE id = ?2",
                params![bool_to_int(is_starred), message_id],
            )?;
            Ok(())
        })
    }
    #[cfg(test)]
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
    #[cfg(test)]
    pub fn record_pending_remote_write(
        &self,
        message_id: i64,
        kind: &str,
        value: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO pending_remote_writes(message_id, kind, value, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(message_id, kind) DO UPDATE SET
                     value = excluded.value,
                     created_at = excluded.created_at",
                params![message_id, kind, value, Utc::now().to_rfc3339()],
            )?;
            Ok(())
        })
    }
    #[cfg(test)]
    pub fn clear_pending_remote_write(&self, message_id: i64, kind: &str) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "DELETE FROM pending_remote_writes WHERE message_id = ?1 AND kind = ?2",
                params![message_id, kind],
            )?;
            Ok(())
        })
    }
    pub fn list_pending_remote_writes(&self) -> MailResult<Vec<PendingRemoteWrite>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT message_id, kind, value, created_at
                FROM pending_remote_writes
                ORDER BY created_at ASC, message_id ASC
                ",
            )?;
            let writes = stmt
                .query_map([], |row| {
                    Ok(PendingRemoteWrite {
                        message_id: row.get(0)?,
                        kind: row.get(1)?,
                        value: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(writes)
        })
    }

    pub fn get_pending_remote_write(
        &self,
        message_id: i64,
        kind: &str,
    ) -> MailResult<Option<PendingRemoteWrite>> {
        self.with_conn(|conn| Ok(conn.query_row(
            "SELECT message_id, kind, value, created_at FROM pending_remote_writes WHERE message_id = ?1 AND kind = ?2",
            params![message_id, kind],
            |row| Ok(PendingRemoteWrite { message_id: row.get(0)?, kind: row.get(1)?, value: row.get(2)?, created_at: row.get(3)? }),
        ).optional()?))
    }
    #[cfg(test)]
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
    pub fn list_trash_message_ids(&self, account_id: Option<i64>) -> MailResult<Vec<i64>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare("SELECT m.id FROM messages m JOIN folders f ON f.id=m.folder_id WHERE f.role='trash' AND (?1 IS NULL OR m.account_id=?1) ORDER BY m.id")?;
            let ids = stmt.query_map([account_id], |row| row.get(0))?.collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        })
    }

    /// Keep the local row (and attachment ownership) until remote deletion has
    /// been acknowledged. A concurrent restore/move must never be erased.
    pub fn delete_trash_message_if_unchanged(
        &self,
        id: i64,
        expected: &MessageRemoteRef,
    ) -> MailResult<bool> {
        self.with_conn(|conn| {
            Ok(conn.execute("DELETE FROM messages WHERE id=?1 AND account_id=?2 AND remote_mailbox=?3 AND remote_uid=?4 AND message_id_header=?5 AND remote_uid_validity=?6 AND folder_id IN (SELECT id FROM folders WHERE role='trash')",
                params![id, expected.account_id, expected.remote_mailbox, expected.remote_uid, expected.message_id_header, expected.remote_uid_validity])? == 1)
        })
    }
    pub fn snooze_message(&self, message_id: i64, snoozed_until: &str) -> MailResult<Message> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let folder_id = folder_id_for_message_role(&transaction, message_id, "snoozed")?;
            transaction.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = ?2, is_read = 1 WHERE id = ?3",
                params![folder_id, snoozed_until.trim(), message_id],
            )?;
            suppress_deferred_rule_actions(&transaction, message_id, 1 | 4)?;
            queue_remote_intent_for_conn(&transaction, message_id, "seen", "1")?;
            let message = message_for_conn(&transaction, message_id)?;
            transaction.commit()?;
            Ok(message)
        })
    }
    /// 批量稍后处理：在单个数据库事务内处理全部目标邮件，保证全成或全不成。
    /// 中途任一目标失败（例如邮件不存在）会整体回滚，不会留下部分已稍后处理的中间状态。
    pub fn snooze_messages(
        &self,
        message_ids: &[i64],
        snoozed_until: &str,
    ) -> MailResult<Vec<Message>> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let mut messages = Vec::with_capacity(message_ids.len());
            for message_id in message_ids {
                let folder_id = folder_id_for_message_role(&transaction, *message_id, "snoozed")?;
                transaction.execute(
                    "UPDATE messages SET folder_id = ?1, snoozed_until = ?2, is_read = 1 WHERE id = ?3",
                    params![folder_id, snoozed_until.trim(), message_id],
                )?;
                suppress_deferred_rule_actions(&transaction, *message_id, 1 | 4)?;
                queue_remote_intent_for_conn(&transaction, *message_id, "seen", "1")?;
                messages.push(message_for_conn(&transaction, *message_id)?);
            }
            transaction.commit()?;
            Ok(messages)
        })
    }
    pub fn unsnooze_message(&self, message_id: i64) -> MailResult<Message> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let folder_id = folder_id_for_message_role(&transaction, message_id, "inbox")?;
            transaction.execute(
                "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                params![folder_id, message_id],
            )?;
            suppress_deferred_rule_actions(&transaction, message_id, 4)?;
            queue_remote_intent_for_conn(&transaction, message_id, "move", "inbox")?;
            let message = message_for_conn(&transaction, message_id)?;
            transaction.commit()?;
            Ok(message)
        })
    }
    pub fn release_due_snoozed_messages(&self, now: &str) -> MailResult<ReleasedSnoozedCount> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let mut stmt = transaction.prepare(
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
            drop(stmt);
            let due_ids = due_snoozed_message_ids(now, rows);
            if due_ids.is_empty() {
                return Ok(ReleasedSnoozedCount { released_count: 0 });
            }
            for message_id in &due_ids {
                let folder_id = folder_id_for_message_role(&transaction, *message_id, "inbox")?;
                transaction.execute(
                    "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
                    params![folder_id, message_id],
                )?;
                suppress_deferred_rule_actions(&transaction, *message_id, 4)?;
                queue_remote_intent_for_conn(&transaction, *message_id, "move", "inbox")?;
            }
            transaction.commit()?;
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
            let transaction = conn.unchecked_transaction()?;
            transaction.execute(
                "INSERT OR IGNORE INTO message_labels(message_id, label_id) VALUES (?1, ?2)",
                params![message_id, label_id],
            )?;
            suppress_deferred_rule_actions(&transaction, message_id, 8)?;
            transaction.commit()?;
            Ok(())
        })
    }
    pub fn remove_label_from_message(&self, message_id: i64, label_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            transaction.execute(
                "DELETE FROM message_labels WHERE message_id = ?1 AND label_id = ?2",
                params![message_id, label_id],
            )?;
            suppress_deferred_rule_actions(&transaction, message_id, 8)?;
            transaction.commit()?;
            Ok(())
        })
    }
    pub fn save_draft(&self, input: DraftInput) -> MailResult<i64> {
        if input.draft_id > 0 {
            return self.with_conn(|conn| update_draft_message_for_conn(conn, input));
        }
        self.create_outbound_message(input, "drafts")
    }
    pub fn queue_outbox_message(&self, input: DraftInput) -> MailResult<OutboxItem> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let send_at = input.send_at.trim().to_string();
            if !send_at.is_empty() && DateTime::parse_from_rfc3339(&send_at).is_err() {
                return Err(MailError::Smtp("计划发送时间无效，请重新选择。".into()));
            }
            let status = if send_at.is_empty() {
                "queued"
            } else {
                "scheduled"
            };
            let message_id = create_outbound_message_for_conn(&transaction, input, "outbox")?;
            let queued_at = Utc::now().to_rfc3339();
            transaction.execute(
                "INSERT INTO outbox_queue(message_id, status, attempts, last_error, queued_at, next_attempt_at)
                 VALUES (?1, ?2, 0, '', ?3, ?4)",
                params![message_id, status, queued_at, send_at],
            )?;
            let id = transaction.last_insert_rowid();
            let item = get_outbox_item_for_conn(&transaction, id)?;
            transaction.commit()?;
            Ok(item)
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
            let (total_messages, unread_messages, starred_messages, attachment_messages): (
                i64,
                i64,
                i64,
                i64,
            ) = conn.query_row(
                &format!(
                    "SELECT COUNT(*),
                            COALESCE(SUM(CASE WHEN m.is_read = 0 THEN 1 ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN m.is_starred = 1 THEN 1 ELSE 0 END), 0),
                            COALESCE(SUM(CASE WHEN m.has_attachments = 1 THEN 1 ELSE 0 END), 0)
                     FROM messages m WHERE 1 = 1{account_filter}"
                ),
                params_from_iter(account_params()),
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
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
        self.with_read_conn(|conn| {
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
            let sql = build_thread_summary_query(&scope_condition, &filter_clause, order_clause);
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
                        latest_preview: row.get(5)?,
                        participants: decode_thread_participants(&row.get::<_, String>(6)?),
                        is_muted: row.get::<_, i64>(7)? != 0,
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
pub(super) fn map_remote_image_trust(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<RemoteImageTrust> {
    Ok(RemoteImageTrust {
        id: row.get(0)?,
        account_id: row.get(1)?,
        account_email: row.get(2)?,
        scope: row.get(3)?,
        value: row.get(4)?,
        created_at: row.get(5)?,
    })
}
pub(super) fn sender_is_external_mailbox(account: &Account, sender_email: &str) -> bool {
    let account_domain = account
        .email
        .split_once('@')
        .map(|(_, domain)| domain.trim().trim_start_matches('@').to_ascii_lowercase())
        .unwrap_or_default();
    let sender = sender_email.trim().to_ascii_lowercase();
    let sender_domain = sender
        .split_once('@')
        .map(|(_, domain)| domain.trim().trim_start_matches('@').to_ascii_lowercase())
        .unwrap_or_default();
    if account_domain.is_empty() {
        return false;
    }
    sender_domain.is_empty() || sender_domain != account_domain
}

pub(super) fn should_allow_remote_images_for_message(
    conn: &Connection,
    message: &Message,
) -> MailResult<bool> {
    let account = account_for_conn(conn, Some(message.account_id))?;
    if account.block_external_mailboxes
        && sender_is_external_mailbox(&account, &message.sender_email)
    {
        return Ok(false);
    }
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
/// 附件在数据库中的行快照，用于正文重拉时按稳定身份匹配并保留下载状态。
pub(super) struct AttachmentRow {
    pub id: i64,
    pub filename: String,
    pub is_downloaded: bool,
    pub local_path: String,
    pub content_sha256: String,
    pub content_id: String,
    pub remote_part_path: String,
}

pub(super) fn attachment_rows_for_conn(
    conn: &Connection,
    message_id: i64,
) -> MailResult<Vec<AttachmentRow>> {
    let mut stmt = conn.prepare("SELECT id, filename, is_downloaded, local_path, content_sha256, content_id, remote_part_path FROM attachments WHERE message_id = ?1 ORDER BY id")?;
    let rows = stmt
        .query_map(params![message_id], |row| {
            Ok(AttachmentRow {
                id: row.get(0)?,
                filename: row.get(1)?,
                is_downloaded: row.get::<_, i64>(2)? != 0,
                local_path: row.get(3)?,
                content_sha256: row.get(4)?,
                content_id: row.get(5)?,
                remote_part_path: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn replace_message_attachments_for_conn(
    conn: &Connection,
    message_id: i64,
    attachments: &[crate::models::RemoteAttachmentMetadata],
    has_attachments: bool,
) -> MailResult<()> {
    let mut unmatched = attachment_rows_for_conn(conn, message_id)?;
    conn.execute(
        "UPDATE messages SET has_attachments = ?2, attachment_metadata_synced = 1 WHERE id = ?1",
        params![
            message_id,
            bool_to_int(has_attachments || !attachments.is_empty())
        ],
    )?;
    for attachment in attachments {
        let exact = if attachment.remote_part_path.is_empty() {
            None
        } else {
            unmatched
                .iter()
                .position(|old| old.remote_part_path == attachment.remote_part_path)
        };
        // Older rows have no MIME section. Transfer their local binding only if
        // both old and new metadata identify exactly one candidate; never guess
        // which of two same-name attachments an old downloaded file contained.
        let legacy = if exact.is_none() && !attachment.remote_part_path.is_empty() {
            let cid_matches = unmatched
                .iter()
                .enumerate()
                .filter(|(_, old)| {
                    old.remote_part_path.is_empty()
                        && !attachment.content_id.is_empty()
                        && old.content_id.eq_ignore_ascii_case(&attachment.content_id)
                })
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            let new_cid_count = attachments
                .iter()
                .filter(|other| {
                    !attachment.content_id.is_empty()
                        && other
                            .content_id
                            .eq_ignore_ascii_case(&attachment.content_id)
                })
                .count();
            if cid_matches.len() == 1 && new_cid_count == 1 {
                Some(cid_matches[0])
            } else if cid_matches.is_empty() {
                let names = unmatched
                    .iter()
                    .enumerate()
                    .filter(|(_, old)| {
                        old.remote_part_path.is_empty()
                            && old.content_id.is_empty()
                            && old.filename == attachment.filename
                    })
                    .map(|(i, _)| i)
                    .collect::<Vec<_>>();
                let new_names = attachments
                    .iter()
                    .filter(|other| other.filename == attachment.filename)
                    .count();
                if names.len() == 1 && new_names == 1 {
                    Some(names[0])
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };
        // For local/test data with no remote section, retain the established
        // ordered matching behavior without touching section-bound rows.
        let pathless =
            if exact.is_none() && legacy.is_none() && attachment.remote_part_path.is_empty() {
                unmatched.iter().position(|old| {
                    old.remote_part_path.is_empty()
                        && ((!attachment.content_id.is_empty()
                            && old.content_id == attachment.content_id)
                            || (old.content_id.is_empty() && old.filename == attachment.filename))
                })
            } else {
                None
            };
        let matched = exact
            .or(legacy)
            .or(pathless)
            .map(|index| unmatched.remove(index));
        let (is_downloaded, local_path, size_bytes, content_sha256) =
            preserve_attachment_download_state(&matched, attachment);
        if let Some(old) = matched {
            conn.execute("UPDATE attachments SET filename=?2, mime_type=?3, size_bytes=?4, is_downloaded=?5, local_path=?6, content_sha256=?7, content_id=?8, is_inline=?9, remote_part_path=?10 WHERE id=?1 AND message_id=?11",
                params![old.id, attachment.filename, attachment.mime_type, size_bytes, bool_to_int(is_downloaded), local_path, content_sha256, attachment.content_id, bool_to_int(attachment.is_inline), attachment.remote_part_path, message_id])?;
        } else {
            // Insert before removing stale rows so SQLite cannot reuse an old ID
            // while an earlier download is still in flight.
            conn.execute("INSERT INTO attachments(message_id, filename, mime_type, size_bytes, is_downloaded, local_path, content_sha256, content_id, is_inline, remote_part_path) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![message_id, attachment.filename, attachment.mime_type, size_bytes, bool_to_int(is_downloaded), local_path, content_sha256, attachment.content_id, bool_to_int(attachment.is_inline), attachment.remote_part_path])?;
        }
    }
    for old in unmatched {
        conn.execute(
            "DELETE FROM attachments WHERE id=?1 AND message_id=?2",
            params![old.id, message_id],
        )?;
    }
    Ok(())
}

pub(super) fn has_pending_remote_write_for_conn(
    conn: &Connection,
    message_id: i64,
    kind: &str,
) -> MailResult<bool> {
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM pending_remote_writes WHERE message_id = ?1 AND kind = ?2 LIMIT 1",
            params![message_id, kind],
            |row| row.get(0),
        )
        .optional()?;
    Ok(exists.is_some())
}

/// 将既有附件的下载状态迁移到新的附件记录上。
///
/// 仅当本地文件真实存在且为普通文件时保留 is_downloaded/local_path，并把
/// size_bytes 更新为磁盘上的实际大小（已验证）。文件缺失时视为未下载，避免
/// 记录指向不存在文件的下载状态。用户自行复制到自定义目录的文件不会被删除。
fn preserve_attachment_download_state(
    matched: &Option<AttachmentRow>,
    attachment: &crate::models::RemoteAttachmentMetadata,
) -> (bool, String, i64, String) {
    let Some(old) = matched else {
        return (false, String::new(), attachment.size_bytes, String::new());
    };
    if !old.is_downloaded || old.local_path.trim().is_empty() {
        return (false, String::new(), attachment.size_bytes, String::new());
    }
    match std::fs::metadata(&old.local_path) {
        Ok(metadata) if metadata.is_file() => (
            true,
            old.local_path.clone(),
            metadata.len().min(i64::MAX as u64) as i64,
            old.content_sha256.clone(),
        ),
        _ => (false, String::new(), attachment.size_bytes, String::new()),
    }
}

pub(super) fn message_for_conn(conn: &Connection, message_id: i64) -> MailResult<Message> {
    let message = conn.query_row(
        "
        SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
               m.cc, m.bcc, m.subject, m.snippet, m.body, m.sanitized_html, m.security_warnings,
               m.received_at, m.is_read, m.is_starred, m.has_attachments,
               m.snoozed_until, m.remote_mailbox, m.remote_uid,
               m.message_id_header, m.in_reply_to_header, m.references_header, m.sanitizer_version, m.remote_body_fetched
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        JOIN folders f ON f.id = m.folder_id
        WHERE m.id = ?1
        ",
        params![message_id],
        |row| map_message_row(conn, row),
    )?;
    Ok(message)
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
        remote_body_fetched: row.get::<_, i64>("remote_body_fetched")? != 0,
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
pub(super) fn message_remote_ref_for_conn(
    conn: &Connection,
    message_id: i64,
) -> MailResult<MessageRemoteRef> {
    conn.query_row(
        "
        SELECT account_id, remote_mailbox, remote_uid, message_id_header, remote_uid_validity
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
                remote_uid_validity: row.get(4)?,
            })
        },
    )
    .map_err(Into::into)
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
pub(super) fn labels_for_message(
    conn: &Connection,
    message_id: i64,
) -> rusqlite::Result<Vec<String>> {
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
pub(super) fn scalar_count_values(
    conn: &Connection,
    sql: &str,
    values: Vec<Value>,
) -> MailResult<i64> {
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

#[cfg(test)]
mod completeness_recovery_tests {
    use super::*;

    fn trusted_message() -> (tempfile::TempDir, MailStore, i64, RemoteImageTrust) {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        let message = store
            .list_messages_for_scope(None, 0, None, None, 1)
            .unwrap()
            .remove(0);
        let body = r#"<p>Original</p><img src="https://example.invalid/tracker.png">"#;
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body=?2,sanitized_html=?3,sanitizer_version=1 WHERE id=?1",
                    params![message.id, body, crate::protocol::sanitize_html(body)],
                )?;
                Ok(())
            })
            .unwrap();
        let trust = store
            .upsert_remote_image_trust(RemoteImageTrustInput {
                account_id: message.account_id,
                scope: "sender".into(),
                value: message.sender_email,
            })
            .unwrap();
        (dir, store, message.id, trust)
    }

    #[test]
    fn trust_revoked_while_rendering_cannot_return_remote_images() {
        let (_dir, store, id, trust) = trusted_message();
        let result = store
            .render_message_with_remote_image_policy(id, |source| {
                let html = crate::protocol::sanitize_html_with_remote_images(&source.body);
                assert!(html.contains("tracker.png"));
                // Deterministically interleave a policy change in the lock-free
                // rendering interval; no timing assumptions or sleeping needed.
                store.delete_remote_image_trust(trust.id).unwrap();
                html
            })
            .unwrap();
        assert!(!result.sanitized_html.contains("tracker.png"));
        assert!(result
            .security_warnings
            .iter()
            .any(|warning| warning.contains("远程图片")));
    }

    #[test]
    fn body_refreshed_while_rendering_returns_the_new_safe_source() {
        let (_dir, store, id, _trust) = trusted_message();
        let result = store.render_message_with_remote_image_policy(id, |source| {
            store.with_conn(|conn| {
                conn.execute("UPDATE messages SET body='<p>Newest body</p>',sanitized_html='<p>Newest body</p>' WHERE id=?1",[id])?;
                Ok(())
            }).unwrap();
            crate::protocol::sanitize_html_with_remote_images(&source.body)
        }).unwrap();
        assert!(result.sanitized_html.contains("Newest body"));
        assert!(!result.sanitized_html.contains("Original"));
        assert!(!result.sanitized_html.contains("tracker.png"));
    }

    #[test]
    fn empty_remote_body_completion_survives_reopen_and_both_detail_queries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty-body.sqlite3");
        let store = MailStore::open_at_with_seed(path.clone(), true).unwrap();
        let id = store
            .list_messages_for_scope(None, 0, None, None, 1)
            .unwrap()[0]
            .id;
        store.set_message_remote_ref(id, "INBOX", 123).unwrap();
        let reference = store.get_message_remote_reference(id).unwrap();
        let body = RemoteMessageBody {
            body: String::new(),
            sanitized_html: String::new(),
            security_warnings: Vec::new(),
            snippet: String::new(),
            has_attachments: false,
            attachments_complete: true,
            attachments: Vec::new(),
        };
        let fetched = store
            .update_message_body_from_remote(id, &body, &reference)
            .unwrap();
        assert!(fetched.remote_body_fetched && fetched.body.is_empty());
        drop(store);
        let reopened = MailStore::open_at_with_seed(path, true).unwrap();
        assert!(reopened.get_message(id).unwrap().remote_body_fetched);
        assert!(reopened.list_messages_by_ids(&[id]).unwrap()[0].remote_body_fetched);
        assert_eq!(
            serde_json::to_value(reopened.get_message(id).unwrap()).unwrap()["remote_body_fetched"],
            true
        );
    }

    #[test]
    fn late_remote_body_cannot_overwrite_a_message_that_moved_mailboxes() {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        let message = store
            .list_messages_for_scope(None, 0, None, None, 1)
            .unwrap()
            .remove(0);
        let original = store.get_message(message.id).unwrap();
        let expected = store.get_message_remote_reference(message.id).unwrap();
        store
            .set_message_remote_ref(message.id, "Moved", expected.remote_uid + 10)
            .unwrap();
        let body = RemoteMessageBody {
            body: "stale result".into(),
            sanitized_html: "<p>stale result</p>".into(),
            security_warnings: Vec::new(),
            snippet: "stale result".into(),
            has_attachments: false,
            attachments_complete: true,
            attachments: Vec::new(),
        };
        assert!(matches!(
            store.update_message_body_from_remote(message.id, &body, &expected),
            Err(MailError::Cancelled)
        ));
        assert_eq!(store.get_message(message.id).unwrap().body, original.body);
        let current = store.get_message_remote_reference(message.id).unwrap();
        assert_eq!(
            store
                .update_message_body_from_remote(message.id, &body, &current)
                .unwrap()
                .body,
            body.body
        );
    }

    #[test]
    fn opening_a_legacy_truncated_message_recovers_the_tail_from_preserved_html() {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join("test.sqlite3"), true).unwrap();
        let original = format!(
            "<p>{}</p><p>UNIQUE_COMPLETE_TAIL</p>",
            "正文".repeat(20_000)
        );
        let message_id = store.with_conn(|conn| {
            let id: i64 = conn.query_row("SELECT m.id FROM messages m JOIN folders f ON f.id = m.folder_id WHERE f.role = 'inbox' LIMIT 1", [], |row| row.get(0))?;
            conn.execute("UPDATE messages SET body = ?2, sanitized_html = '<p>truncated', sanitizer_version = 0 WHERE id = ?1", params![id, original])?;
            Ok(id)
        }).unwrap();
        let restored = store.get_message(message_id).unwrap();
        assert!(restored
            .sanitized_html
            .ends_with("UNIQUE_COMPLETE_TAIL</p>"));
        let persisted = store
            .with_conn(|conn| {
                Ok(conn.query_row(
                    "SELECT sanitizer_version FROM messages WHERE id = ?1",
                    [message_id],
                    |row| row.get::<_, i64>(0),
                )?)
            })
            .unwrap();
        assert_eq!(persisted, 1);
        assert_eq!(
            store.get_message(message_id).unwrap().sanitized_html,
            restored.sanitized_html
        );
    }
}

#[cfg(test)]
mod attachment_metadata_tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, MailStore, i64) {
        let dir = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(dir.path().join("metadata.sqlite3"), true).unwrap();
        let id = store
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT id FROM messages LIMIT 1", [], |row| row.get(0))?)
            })
            .unwrap();
        store.set_message_remote_ref(id, "Sent", 42).unwrap();
        (dir, store, id)
    }

    fn body(complete: bool) -> RemoteMessageBody {
        RemoteMessageBody {
            body: String::new(),
            sanitized_html: String::new(),
            security_warnings: Vec::new(),
            snippet: String::new(),
            has_attachments: false,
            attachments_complete: complete,
            attachments: Vec::new(),
        }
    }

    #[test]
    fn body_only_sync_preserves_attachment_rows_until_complete_metadata_arrives() {
        let (_dir, store, id) = fixture();
        // The remote backfill flag must agree with the local completeness
        // contract: a body-only response cannot claim the inventory is synced.
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET attachment_metadata_synced=0 WHERE id=?1",
                    [id],
                )?;
                Ok(())
            })
            .unwrap();
        store.update_message_body(id, &body(false)).unwrap();
        let metadata_synced = || {
            store
                .with_conn(|conn| {
                    Ok(conn.query_row(
                        "SELECT attachment_metadata_synced FROM messages WHERE id=?1",
                        [id],
                        |row| row.get::<_, bool>(0),
                    )?)
                })
                .unwrap()
        };
        assert!(!metadata_synced());
        let initial = RemoteMessageBody {
            has_attachments: true,
            attachments: vec![crate::models::RemoteAttachmentMetadata {
                remote_part_path: String::new(),
                filename: "large.zip".into(),
                mime_type: "application/zip".into(),
                size_bytes: 20_000_000,
                content_id: String::new(),
                is_inline: false,
            }],
            ..body(true)
        };
        store.update_message_body(id, &initial).unwrap();
        assert!(metadata_synced());
        let before = store.list_attachments(id).unwrap();
        let incomplete = store.update_message_body(id, &body(false)).unwrap();
        assert!(incomplete.has_attachments);
        assert_eq!(store.list_attachments(id).unwrap()[0].id, before[0].id);
        assert_eq!(
            store.list_attachments(id).unwrap()[0].size_bytes,
            20_000_000
        );
        // A genuinely complete, empty inventory is still authoritative.
        assert!(
            !store
                .update_message_body(id, &body(true))
                .unwrap()
                .has_attachments
        );
        assert!(store.list_attachments(id).unwrap().is_empty());
    }

    #[test]
    fn successfully_fetched_empty_body_is_not_requested_on_every_sync() {
        let (_dir, store, id) = fixture();
        let account = store.get_message(id).unwrap().account_id;
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body='',remote_body_fetched=0 WHERE id=?1",
                    [id],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(store
            .list_messages_missing_body(account, "Sent", 20)
            .unwrap()
            .iter()
            .any(|item| item.0 == id));
        store.update_message_body(id, &body(false)).unwrap();
        assert!(!store
            .list_messages_missing_body(account, "Sent", 20)
            .unwrap()
            .iter()
            .any(|item| item.0 == id));
    }

    #[test]
    fn failed_attachment_replacement_rolls_back_body_and_existing_inventory() {
        let (_dir, store, id) = fixture();
        let initial = RemoteMessageBody {
            body: "original body".into(),
            has_attachments: true,
            attachments: vec![crate::models::RemoteAttachmentMetadata {
                remote_part_path: String::new(),
                filename: "original.zip".into(),
                mime_type: "application/zip".into(),
                size_bytes: 12,
                content_id: String::new(),
                is_inline: false,
            }],
            ..body(true)
        };
        store.update_message_body(id, &initial).unwrap();
        let attachment_id = store.list_attachments(id).unwrap()[0].id;
        store.with_conn(|conn| {
            conn.execute_batch("CREATE TEMP TRIGGER reject_new_attachment BEFORE INSERT ON attachments WHEN NEW.filename='broken.zip' BEGIN SELECT RAISE(FAIL,'injected write failure'); END;")?;
            Ok(())
        }).unwrap();
        let mut replacement = initial.clone();
        replacement.body = "replacement body".into();
        replacement.attachments[0].filename = "broken.zip".into();
        assert!(store.update_message_body(id, &replacement).is_err());
        assert_eq!(store.get_message(id).unwrap().body, "original body");
        assert_eq!(store.list_attachments(id).unwrap()[0].id, attachment_id);
    }
}
