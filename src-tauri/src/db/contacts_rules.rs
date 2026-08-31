use super::folders::folder_id_for_message_role;
use super::messages::bool_to_int;
use super::messages::message_for_conn;
use super::*;

impl MailStore {
    #[allow(dead_code)]
    pub fn list_contacts(&self) -> MailResult<Vec<Contact>> {
        self.list_contacts_for_account(None)
    }

    pub fn list_contacts_for_account(&self, account_id: Option<i64>) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts
                 WHERE (?1 IS NULL OR account_id = ?1)
                 ORDER BY CASE WHEN julianday(last_seen_at) IS NULL THEN 1 ELSE 0 END,
                          julianday(last_seen_at) DESC, last_seen_at DESC, name COLLATE NOCASE",
            )?;
            let contacts = stmt
                .query_map(params![account_id], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        name: row.get(2)?,
                        email: row.get(3)?,
                        aliases: contact_aliases_from_text(row.get(4)?),
                        vip: row.get::<_, i64>(5)? != 0,
                        message_count: row.get(6)?,
                        last_seen_at: row.get(7)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }
    #[allow(dead_code)]
    pub fn list_all_contacts(&self) -> MailResult<Vec<Contact>> {
        self.list_all_contacts_for_account(None)
    }

    pub fn list_all_contacts_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts
                 WHERE (?1 IS NULL OR account_id = ?1)
                 ORDER BY name COLLATE NOCASE, email COLLATE NOCASE",
            )?;
            let contacts = stmt
                .query_map(params![account_id], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        name: row.get(2)?,
                        email: row.get(3)?,
                        aliases: contact_aliases_from_text(row.get(4)?),
                        vip: row.get::<_, i64>(5)? != 0,
                        message_count: row.get(6)?,
                        last_seen_at: row.get(7)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }
    pub fn should_auto_scan_recent_contacts(&self) -> MailResult<bool> {
        self.with_conn(|conn| {
            let completed = conn
                .query_row(
                    "SELECT initial_scan_completed FROM contact_sync_state WHERE id = 1",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            Ok(completed == 0)
        })
    }
    #[allow(dead_code)]
    pub fn scan_recent_contacts(&self, initial_only: bool) -> MailResult<RecentContactSyncReport> {
        self.scan_recent_contacts_for_account(initial_only, None)
    }

    pub fn scan_recent_contacts_for_account(
        &self,
        initial_only: bool,
        account_id: Option<i64>,
    ) -> MailResult<RecentContactSyncReport> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            if initial_only {
                let completed = transaction
                    .query_row(
                        "SELECT initial_scan_completed FROM contact_sync_state WHERE id = 1",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .unwrap_or(0);
                if completed != 0 {
                    return Ok(RecentContactSyncReport {
                        scanned_messages: 0,
                        discovered_contacts: 0,
                        created: 0,
                        updated: 0,
                        skipped: true,
                    });
                }
            }

            let own_addresses = own_email_addresses_for_conn(&transaction)?;
            let mut aggregates = BTreeMap::<(i64, String), SentContactAggregate>::new();
            let mut scanned_messages = 0_i64;
            {
                let mut stmt = transaction.prepare(
                    "SELECT m.id, m.account_id, m.recipients, m.cc, m.bcc, m.received_at
                     FROM messages m
                     JOIN folders f ON f.id = m.folder_id
                     WHERE f.role = 'sent'
                       AND (?1 IS NULL OR m.account_id = ?1)
                     ORDER BY CASE WHEN julianday(m.received_at) IS NULL THEN 1 ELSE 0 END,
                              julianday(m.received_at) DESC, m.received_at DESC, m.id DESC",
                )?;
                let rows = stmt.query_map(params![account_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                })?;
                for row in rows {
                    let (message_id, message_account_id, to, cc, bcc, seen_at) = row?;
                    scanned_messages += 1;
                    let mut message_addresses = BTreeMap::<String, String>::new();
                    for header in [to, cc, bcc] {
                        for (name, email) in parse_contact_address_list(&header) {
                            if !own_addresses.contains(&email) {
                                message_addresses.entry(email).or_insert(name);
                            }
                        }
                    }
                    for (email, name) in message_addresses {
                        let aggregate = aggregates
                            .entry((message_account_id, email.clone()))
                            .or_default();
                        aggregate.message_count += 1;
                        if aggregate.name.is_empty() && !name.is_empty() && name != email {
                            aggregate.name = name;
                        }
                        if seen_at_is_newer(&seen_at, &aggregate.last_seen_at) {
                            aggregate.last_seen_at = seen_at.clone();
                        }
                        transaction.execute(
                            "INSERT OR IGNORE INTO contact_sent_messages(message_id, email, scanned_at)
                             VALUES (?1, ?2, ?3)",
                            params![message_id, email, Utc::now().to_rfc3339()],
                        )?;
                    }
                }
            }

            let mut created = 0_i64;
            let mut updated = 0_i64;
            for ((message_account_id, email), aggregate) in &aggregates {
                let existing: Option<(i64, String, i64, String)> = transaction
                    .query_row(
                        "SELECT id, name, message_count, last_seen_at
                         FROM contacts WHERE account_id = ?1 AND lower(email) = lower(?2)",
                        params![message_account_id, email],
                        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
                    )
                    .optional()?;
                let display_name = if aggregate.name.trim().is_empty() {
                    email.as_str()
                } else {
                    aggregate.name.as_str()
                };
                if let Some((id, current_name, current_count, current_seen_at)) = existing {
                    let next_name = if current_name.trim().is_empty() || current_name.eq_ignore_ascii_case(email) {
                        display_name
                    } else {
                        current_name.as_str()
                    };
                    let next_count = current_count.max(aggregate.message_count);
                    let next_seen_at = if seen_at_is_newer(&aggregate.last_seen_at, &current_seen_at) {
                        aggregate.last_seen_at.as_str()
                    } else {
                        current_seen_at.as_str()
                    };
                    transaction.execute(
                        "UPDATE contacts SET name = ?2, message_count = ?3, last_seen_at = ?4
                         WHERE id = ?1 AND account_id = ?5",
                        params![id, next_name, next_count, next_seen_at, message_account_id],
                    )?;
                    updated += 1;
                } else {
                    transaction.execute(
                        "INSERT INTO contacts(account_id, name, email, aliases, vip, message_count, last_seen_at)
                         VALUES (?1, ?2, ?3, '', 0, ?4, ?5)",
                        params![message_account_id, display_name, email, aggregate.message_count, aggregate.last_seen_at],
                    )?;
                    created += 1;
                }
            }

            let now = Utc::now().to_rfc3339();
            transaction.execute(
                "INSERT INTO contact_sync_state(id, initial_scan_completed, last_scanned_at)
                 VALUES (1, ?1, ?2)
                 ON CONFLICT(id) DO UPDATE SET
                   initial_scan_completed = CASE WHEN ?1 = 1 THEN 1 ELSE contact_sync_state.initial_scan_completed END,
                   last_scanned_at = excluded.last_scanned_at",
                params![if initial_only { 1 } else { 0 }, now],
            )?;
            transaction.commit()?;
            Ok(RecentContactSyncReport {
                scanned_messages,
                discovered_contacts: aggregates.len() as i64,
                created,
                updated,
                skipped: false,
            })
        })
    }

    pub fn sync_contacts_from_sent_message(&self, message_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let (message_account_id, to, cc, bcc, seen_at): (i64, String, String, String, String) = transaction.query_row(
                "SELECT account_id, recipients, cc, bcc, received_at FROM messages WHERE id = ?1",
                params![message_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )?;
            let own_addresses = own_email_addresses_for_conn(&transaction)?;
            let mut addresses = BTreeMap::<String, String>::new();
            for header in [to, cc, bcc] {
                for (name, email) in parse_contact_address_list(&header) {
                    if !own_addresses.contains(&email) {
                        addresses.entry(email).or_insert(name);
                    }
                }
            }
            for (email, name) in addresses {
                let inserted = transaction.execute(
                    "INSERT OR IGNORE INTO contact_sent_messages(message_id, email, scanned_at)
                     VALUES (?1, ?2, ?3)",
                    params![message_id, email, Utc::now().to_rfc3339()],
                )?;
                if inserted == 0 {
                    continue;
                }
                let display_name = if name.trim().is_empty() { email.as_str() } else { name.as_str() };
                transaction.execute(
                    "INSERT INTO contacts(account_id, name, email, aliases, vip, message_count, last_seen_at)
                     VALUES (?1, ?2, ?3, '', 0, 1, ?4)
                     ON CONFLICT(account_id, email) DO UPDATE SET
                        name = CASE WHEN contacts.name = '' OR lower(contacts.name) = lower(contacts.email)
                                    THEN excluded.name ELSE contacts.name END,
                        message_count = contacts.message_count + 1,
                        last_seen_at = CASE
                            WHEN julianday(excluded.last_seen_at) IS NOT NULL
                                 AND (julianday(contacts.last_seen_at) IS NULL
                                      OR julianday(excluded.last_seen_at) > julianday(contacts.last_seen_at))
                                THEN excluded.last_seen_at
                            WHEN julianday(excluded.last_seen_at) IS NULL
                                 AND excluded.last_seen_at > contacts.last_seen_at
                                THEN excluded.last_seen_at
                            ELSE contacts.last_seen_at END",
                    params![message_account_id, display_name, email, seen_at],
                )?;
            }
            transaction.commit()?;
            Ok(())
        })
    }
    pub fn import_contacts(&self, inputs: Vec<ContactCreateInput>) -> MailResult<(i64, i64)> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            import_contacts_for_conn(conn, account_id, inputs)
        })
    }

    pub fn import_contacts_for_account(
        &self,
        account_id: i64,
        inputs: Vec<ContactCreateInput>,
    ) -> MailResult<(i64, i64)> {
        self.with_conn(|conn| import_contacts_for_conn(conn, account_id, inputs))
    }
    pub fn classify_contact_import(
        &self,
        inputs: Vec<ContactCreateInput>,
    ) -> MailResult<Vec<ContactImportPreviewEntry>> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            classify_contact_import_for_conn(conn, account_id, inputs)
        })
    }
    pub fn classify_contact_import_for_account(
        &self,
        account_id: i64,
        inputs: Vec<ContactCreateInput>,
    ) -> MailResult<Vec<ContactImportPreviewEntry>> {
        self.with_conn(|conn| classify_contact_import_for_conn(conn, account_id, inputs))
    }
    pub fn commit_contact_import(
        &self,
        inputs: Vec<(ContactCreateInput, String)>,
        file_name: &str,
        scope: &str,
    ) -> MailResult<ContactImportCommitSummary> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            commit_import_inputs(conn, account_id, inputs, file_name, scope)
        })
    }
    pub fn commit_contact_import_for_account(
        &self,
        account_id: i64,
        inputs: Vec<(ContactCreateInput, String)>,
        file_name: &str,
        scope: &str,
    ) -> MailResult<ContactImportCommitSummary> {
        self.with_conn(|conn| commit_import_inputs(conn, account_id, inputs, file_name, scope))
    }
    pub fn commit_contact_import_entries(
        &self,
        inputs: Vec<(ContactCreateInput, String)>,
        file_name: &str,
        scope: &str,
    ) -> MailResult<ContactImportCommitSummary> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            commit_import_inputs(conn, account_id, inputs, file_name, scope)
        })
    }
    pub fn commit_contact_import_entries_for_account(
        &self,
        account_id: i64,
        inputs: Vec<(ContactCreateInput, String)>,
        file_name: &str,
        scope: &str,
    ) -> MailResult<ContactImportCommitSummary> {
        self.with_conn(|conn| commit_import_inputs(conn, account_id, inputs, file_name, scope))
    }
    #[allow(dead_code)]
    pub fn list_contact_import_batches(&self) -> MailResult<Vec<ContactImportBatch>> {
        self.list_contact_import_batches_for_account(None)
    }
    pub fn list_contact_import_batches_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<ContactImportBatch>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, file_name, total_count, created_count, merged_count, skipped_count, scope, created_at
                 FROM contact_import_batches
                 WHERE (?1 IS NULL OR account_id = ?1)
                 ORDER BY id DESC LIMIT 50",
            )?;
            let batches = stmt
                .query_map(params![account_id], |row| {
                    Ok(ContactImportBatch {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        file_name: row.get(2)?,
                        total_count: row.get(3)?,
                        created_count: row.get(4)?,
                        merged_count: row.get(5)?,
                        skipped_count: row.get(6)?,
                        scope: row.get(7)?,
                        created_at: row.get(8)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(batches)
        })
    }
    pub fn undo_contact_import_batch(&self, batch_id: i64) -> MailResult<ContactImportUndoReport> {
        self.with_conn(|conn| undo_contact_import_batch_for_conn(conn, None, batch_id))
    }
    pub fn undo_contact_import_batch_for_account(
        &self,
        account_id: i64,
        batch_id: i64,
    ) -> MailResult<ContactImportUndoReport> {
        self.with_conn(|conn| undo_contact_import_batch_for_conn(conn, Some(account_id), batch_id))
    }
    pub fn create_contact(&self, input: ContactCreateInput) -> MailResult<Contact> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            create_contact_for_conn(conn, account_id, input)
        })
    }
    pub fn create_contact_for_account(
        &self,
        account_id: i64,
        input: ContactCreateInput,
    ) -> MailResult<Contact> {
        self.with_conn(|conn| create_contact_for_conn(conn, account_id, input))
    }
    pub fn update_contact(&self, contact_id: i64, input: ContactInput) -> MailResult<Contact> {
        self.with_conn(|conn| update_contact_for_conn(conn, None, contact_id, input))
    }
    pub fn update_contact_for_account(
        &self,
        account_id: i64,
        contact_id: i64,
        input: ContactInput,
    ) -> MailResult<Contact> {
        self.with_conn(|conn| update_contact_for_conn(conn, Some(account_id), contact_id, input))
    }
    pub fn delete_contact(&self, contact_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM contacts WHERE id = ?1", params![contact_id])?;
            Ok(())
        })
    }
    pub fn delete_contact_for_account(&self, account_id: i64, contact_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let changed = conn.execute(
                "DELETE FROM contacts WHERE id = ?1 AND account_id = ?2",
                params![contact_id, account_id],
            )?;
            if changed == 0 {
                return Err(MailError::Imap(
                    "联系人不存在或不属于当前邮箱账号".to_string(),
                ));
            }
            Ok(())
        })
    }
    pub fn merge_contacts(
        &self,
        target_contact_id: i64,
        source_contact_id: i64,
    ) -> MailResult<Contact> {
        if target_contact_id == source_contact_id {
            return Err(MailError::Imap("请选择两个不同联系人进行合并".to_string()));
        }
        self.with_conn(|conn| {
            merge_contacts_for_conn(conn, None, target_contact_id, source_contact_id)
        })
    }
    pub fn merge_contacts_for_account(
        &self,
        account_id: i64,
        target_contact_id: i64,
        source_contact_id: i64,
    ) -> MailResult<Contact> {
        if target_contact_id == source_contact_id {
            return Err(MailError::Imap("请选择两个不同联系人进行合并".to_string()));
        }
        self.with_conn(|conn| {
            merge_contacts_for_conn(conn, Some(account_id), target_contact_id, source_contact_id)
        })
    }
    #[allow(dead_code)]
    pub fn list_rules(&self) -> MailResult<Vec<MailRule>> {
        self.list_rules_for_account(None)
    }
    pub fn list_rules_for_account(&self, account_id: Option<i64>) -> MailResult<Vec<MailRule>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, account_id, name, condition, action, enabled FROM mail_rules
                 WHERE (?1 IS NULL OR account_id = ?1) ORDER BY id",
            )?;
            let rules = stmt
                .query_map(params![account_id], |row| {
                    Ok(MailRule {
                        id: row.get(0)?,
                        account_id: row.get(1)?,
                        name: row.get(2)?,
                        condition: row.get(3)?,
                        action: row.get(4)?,
                        enabled: row.get::<_, i64>(5)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rules)
        })
    }
    pub fn upsert_rule(&self, rule_id: Option<i64>, input: MailRuleInput) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            let account_id = default_account_id_for_conn(conn)?;
            upsert_rule_for_conn(conn, account_id, rule_id, input)
        })
    }
    pub fn upsert_rule_for_account(
        &self,
        account_id: i64,
        rule_id: Option<i64>,
        input: MailRuleInput,
    ) -> MailResult<MailRule> {
        self.with_conn(|conn| upsert_rule_for_conn(conn, account_id, rule_id, input))
    }
    pub fn set_rule_enabled(&self, rule_id: i64, enabled: bool) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            conn.execute(
                "UPDATE mail_rules SET enabled = ?2 WHERE id = ?1",
                params![rule_id, bool_to_int(enabled)],
            )?;
            rule_for_conn(conn, rule_id)
        })
    }
    pub fn set_rule_enabled_for_account(
        &self,
        account_id: i64,
        rule_id: i64,
        enabled: bool,
    ) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            let changed = conn.execute(
                "UPDATE mail_rules SET enabled = ?2 WHERE id = ?1 AND account_id = ?3",
                params![rule_id, bool_to_int(enabled), account_id],
            )?;
            if changed == 0 {
                return Err(MailError::Imap(
                    "规则不存在或不属于当前邮箱账号".to_string(),
                ));
            }
            rule_for_conn_for_account(conn, Some(account_id), rule_id)
        })
    }
    pub fn delete_rule(&self, rule_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM mail_rules WHERE id = ?1", params![rule_id])?;
            Ok(())
        })
    }
    pub fn delete_rule_for_account(&self, account_id: i64, rule_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let changed = conn.execute(
                "DELETE FROM mail_rules WHERE id = ?1 AND account_id = ?2",
                params![rule_id, account_id],
            )?;
            if changed == 0 {
                return Err(MailError::Imap(
                    "规则不存在或不属于当前邮箱账号".to_string(),
                ));
            }
            Ok(())
        })
    }
}

pub(super) fn contact_aliases_to_text(aliases: &[String]) -> String {
    aliases
        .iter()
        .map(|alias| alias.trim().to_ascii_lowercase())
        .filter(|alias| !alias.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn default_account_id_for_conn(conn: &Connection) -> MailResult<i64> {
    conn.query_row(
        "SELECT id FROM accounts ORDER BY is_default DESC, id LIMIT 1",
        [],
        |row| row.get(0),
    )
    .map_err(|error| MailError::Imap(format!("没有可用邮箱账号：{error}")))
}

fn undo_contact_import_batch_for_conn(
    conn: &Connection,
    account_id: Option<i64>,
    batch_id: i64,
) -> MailResult<ContactImportUndoReport> {
    let batch_account_id: i64 = conn.query_row(
        "SELECT account_id FROM contact_import_batches
         WHERE id = ?1 AND (?2 IS NULL OR account_id = ?2)",
        params![batch_id, account_id],
        |row| row.get(0),
    )?;
    let transaction = conn.unchecked_transaction()?;
    let created_contact_ids: Vec<i64> = {
        let mut stmt = transaction.prepare(
            "SELECT contact_id FROM contact_import_entries
             WHERE batch_id = ?1 AND action = 'create' AND contact_id IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![batch_id], |row| row.get::<_, i64>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let mut removed = 0_i64;
    for contact_id in created_contact_ids {
        let changed = transaction.execute(
            "DELETE FROM contacts WHERE id = ?1 AND account_id = ?2",
            params![contact_id, batch_account_id],
        )?;
        if changed > 0 {
            removed += 1;
        }
    }
    transaction.execute(
        "DELETE FROM contact_import_entries WHERE batch_id = ?1 AND action = 'create'",
        params![batch_id],
    )?;
    transaction.commit()?;
    // 事务已提交，复用外层 with_conn 的连接查询剩余条数；不能再次进入
    // self.with_conn，否则非重入 Mutex 会永久阻塞。
    let remaining_created = conn.query_row(
        "SELECT COUNT(*) FROM contact_import_entries WHERE batch_id = ?1 AND action = 'create'",
        params![batch_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(ContactImportUndoReport {
        removed,
        remaining_created,
        note: "已删除该批次新增的联系人；合并/更新已有联系人的变更不可回滚。".to_string(),
    })
}

fn create_contact_for_conn(
    conn: &Connection,
    account_id: i64,
    input: ContactCreateInput,
) -> MailResult<Contact> {
    let email = normalize_email(&input.email);
    if email.is_empty() {
        return Err(MailError::Imap("联系人邮箱不能为空".to_string()));
    }
    let name = input.name.trim();
    let display_name = if name.is_empty() {
        email.as_str()
    } else {
        name
    };
    let aliases = normalize_contact_aliases(input.aliases, &email);
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO contacts(account_id, name, email, aliases, vip, message_count, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        params![
            account_id,
            display_name,
            email,
            contact_aliases_to_text(&aliases),
            if input.vip { 1 } else { 0 },
            now,
        ],
    )?;
    get_contact_for_conn_and_account(conn, Some(account_id), conn.last_insert_rowid())
}

fn update_contact_for_conn(
    conn: &Connection,
    account_id: Option<i64>,
    contact_id: i64,
    input: ContactInput,
) -> MailResult<Contact> {
    let existing = get_contact_for_conn_and_account(conn, account_id, contact_id)?;
    let name = input.name.trim();
    let aliases = normalize_contact_aliases(input.aliases, &existing.email);
    conn.execute(
        "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1
         AND (?5 IS NULL OR account_id = ?5)",
        params![
            contact_id,
            if name.is_empty() {
                existing.name.as_str()
            } else {
                name
            },
            contact_aliases_to_text(&aliases),
            if input.vip { 1 } else { 0 },
            account_id,
        ],
    )?;
    Ok(Contact {
        aliases,
        vip: input.vip,
        name: if name.is_empty() {
            existing.name
        } else {
            name.to_string()
        },
        ..existing
    })
}

fn merge_contacts_for_conn(
    conn: &Connection,
    account_id: Option<i64>,
    target_contact_id: i64,
    source_contact_id: i64,
) -> MailResult<Contact> {
    let target = get_contact_for_conn_and_account(conn, account_id, target_contact_id)?;
    let source = get_contact_for_conn_and_account(conn, account_id, source_contact_id)?;
    if target.account_id != source.account_id {
        return Err(MailError::Imap(
            "只能合并同一邮箱账号下的联系人".to_string(),
        ));
    }
    let mut aliases = target.aliases.clone();
    aliases.push(source.email.clone());
    aliases.extend(source.aliases.clone());
    let aliases = normalize_contact_aliases(aliases, &target.email);
    let name = if target.name.trim().is_empty() || target.name == target.email {
        source.name.as_str()
    } else {
        target.name.as_str()
    };
    let message_count = target.message_count + source.message_count;
    let last_seen_at = if source.last_seen_at > target.last_seen_at {
        source.last_seen_at.as_str()
    } else {
        target.last_seen_at.as_str()
    };
    conn.execute(
        "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4, message_count = ?5, last_seen_at = ?6
         WHERE id = ?1 AND account_id = ?7",
        params![
            target_contact_id,
            name,
            contact_aliases_to_text(&aliases),
            if target.vip || source.vip { 1 } else { 0 },
            message_count,
            last_seen_at,
            target.account_id,
        ],
    )?;
    conn.execute(
        "DELETE FROM contacts WHERE id = ?1 AND account_id = ?2",
        params![source_contact_id, target.account_id],
    )?;
    get_contact_for_conn_and_account(conn, Some(target.account_id), target_contact_id)
}

fn contact_row_for_account_conn(
    conn: &Connection,
    account_id: Option<i64>,
    email: &str,
) -> MailResult<Option<Contact>> {
    conn.query_row(
        "SELECT id, account_id, name, email, aliases, vip, message_count, last_seen_at
         FROM contacts
         WHERE lower(email) = lower(?1) AND (?2 IS NULL OR account_id = ?2)
         ORDER BY id LIMIT 1",
        params![email, account_id],
        |row| {
            Ok(Contact {
                id: row.get(0)?,
                account_id: row.get(1)?,
                name: row.get(2)?,
                email: row.get(3)?,
                aliases: contact_aliases_from_text(row.get(4)?),
                vip: row.get::<_, i64>(5)? != 0,
                message_count: row.get(6)?,
                last_seen_at: row.get(7)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn import_contacts_for_conn(
    conn: &Connection,
    account_id: i64,
    inputs: Vec<ContactCreateInput>,
) -> MailResult<(i64, i64)> {
    let transaction = conn.unchecked_transaction()?;
    let now = Utc::now().to_rfc3339();
    let mut created = 0_i64;
    let mut updated = 0_i64;

    for input in inputs {
        let email = normalize_email(&input.email);
        if email.is_empty() {
            continue;
        }
        let existing = contact_row_for_account_conn(&transaction, Some(account_id), &email)?;
        let imported_name = input.name.trim();

        if let Some(existing) = existing {
            let mut aliases = existing.aliases.clone();
            aliases.extend(input.aliases);
            let aliases = normalize_contact_aliases(aliases, &existing.email);
            let name = if (existing.name.trim().is_empty() || existing.name == existing.email)
                && !imported_name.is_empty()
            {
                imported_name
            } else {
                existing.name.as_str()
            };
            transaction.execute(
                "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4
                 WHERE id = ?1 AND account_id = ?5",
                params![
                    existing.id,
                    name,
                    contact_aliases_to_text(&aliases),
                    if existing.vip || input.vip { 1 } else { 0 },
                    account_id,
                ],
            )?;
            updated += 1;
        } else {
            let display_name = if imported_name.is_empty() {
                email.as_str()
            } else {
                imported_name
            };
            let aliases = normalize_contact_aliases(input.aliases, &email);
            transaction.execute(
                "INSERT INTO contacts(account_id, name, email, aliases, vip, message_count, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
                params![
                    account_id,
                    display_name,
                    email,
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                    now,
                ],
            )?;
            created += 1;
        }
    }

    transaction.commit()?;
    Ok((created, updated))
}

fn classify_contact_import_for_conn(
    conn: &Connection,
    account_id: i64,
    inputs: Vec<ContactCreateInput>,
) -> MailResult<Vec<ContactImportPreviewEntry>> {
    let mut entries = Vec::new();
    for input in inputs {
        let email = normalize_email(&input.email);
        if email.is_empty() || !email.contains('@') {
            entries.push(ContactImportPreviewEntry {
                email,
                name: input.name,
                aliases: input.aliases,
                vip: input.vip,
                status: "invalid".to_string(),
                existing_contact_id: None,
                existing_name: String::new(),
                reason: "邮箱地址无效".to_string(),
            });
            continue;
        }
        let existing = contact_row_for_account_conn(conn, Some(account_id), &email)?;
        if let Some(existing) = existing {
            let new_aliases = input
                .aliases
                .iter()
                .filter(|alias| {
                    let normalized = normalize_email(alias);
                    !normalized.is_empty()
                        && normalized != existing.email
                        && !existing.aliases.contains(&normalized)
                })
                .count();
            let same_name = input.name.trim().eq_ignore_ascii_case(existing.name.trim())
                || existing.name.trim().is_empty()
                || existing.name == existing.email;
            if same_name && new_aliases == 0 && !input.vip {
                entries.push(ContactImportPreviewEntry {
                    email: existing.email.clone(),
                    name: existing.name.clone(),
                    aliases: Vec::new(),
                    vip: existing.vip,
                    status: "duplicate".to_string(),
                    existing_contact_id: Some(existing.id),
                    existing_name: existing.name,
                    reason: "与已有联系人完全相同".to_string(),
                });
            } else {
                entries.push(ContactImportPreviewEntry {
                    email: existing.email.clone(),
                    name: input.name,
                    aliases: input.aliases,
                    vip: input.vip,
                    status: "merge".to_string(),
                    existing_contact_id: Some(existing.id),
                    existing_name: existing.name,
                    reason: "已有联系人，可合并补充字段".to_string(),
                });
            }
        } else {
            entries.push(ContactImportPreviewEntry {
                email: email.clone(),
                name: input.name,
                aliases: input.aliases,
                vip: input.vip,
                status: "new".to_string(),
                existing_contact_id: None,
                existing_name: String::new(),
                reason: "新联系人".to_string(),
            });
        }
    }
    Ok(entries)
}

fn merge_imported_contact(
    transaction: &rusqlite::Transaction<'_>,
    existing: &Contact,
    input: &ContactCreateInput,
) -> MailResult<()> {
    let mut aliases = existing.aliases.clone();
    aliases.extend(input.aliases.clone());
    let aliases = normalize_contact_aliases(aliases, &existing.email);
    let imported_name = input.name.trim();
    let differs = !existing.name.trim().is_empty()
        && !existing.name.eq_ignore_ascii_case(imported_name)
        && existing.name != existing.email;
    let name = if !imported_name.is_empty()
        && (differs || existing.name.trim().is_empty() || existing.name == existing.email)
    {
        imported_name
    } else {
        existing.name.as_str()
    };
    transaction.execute(
        "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1",
        params![
            existing.id,
            name,
            contact_aliases_to_text(&aliases),
            if existing.vip || input.vip { 1 } else { 0 },
        ],
    )?;
    Ok(())
}

fn commit_import_inputs(
    conn: &Connection,
    account_id: i64,
    inputs: Vec<(ContactCreateInput, String)>,
    file_name: &str,
    scope: &str,
) -> MailResult<ContactImportCommitSummary> {
    let transaction = conn.unchecked_transaction()?;
    let now = Utc::now().to_rfc3339();
    let mut created = 0_i64;
    let mut merged = 0_i64;
    let mut skipped = 0_i64;
    let mut entries: Vec<(i64, String, String)> = Vec::new();
    for (input, action) in inputs {
        let email = normalize_email(&input.email);
        if email.is_empty() || !email.contains('@') {
            skipped += 1;
            continue;
        }
        if action == "skip" {
            skipped += 1;
            continue;
        }
        let existing = contact_row_for_account_conn(&transaction, Some(account_id), &email)?;
        if let Some(existing) = existing {
            merge_imported_contact(&transaction, &existing, &input)?;
            entries.push((existing.id, email, "merge".to_string()));
            merged += 1;
        } else {
            let display_name = if input.name.trim().is_empty() {
                email.as_str()
            } else {
                input.name.trim()
            };
            let aliases = normalize_contact_aliases(input.aliases, &email);
            transaction.execute(
                "INSERT INTO contacts(account_id, name, email, aliases, vip, message_count, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
                params![
                    account_id,
                    display_name,
                    email,
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                    now,
                ],
            )?;
            let contact_id = transaction.last_insert_rowid();
            entries.push((contact_id, email, "create".to_string()));
            created += 1;
        }
    }
    let total_count = created + merged + skipped;
    transaction.execute(
        "INSERT INTO contact_import_batches(account_id, file_name, total_count, created_count, merged_count, skipped_count, scope, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            account_id,
            file_name,
            total_count,
            created,
            merged,
            skipped,
            scope,
            now,
        ],
    )?;
    let batch_id = transaction.last_insert_rowid();
    for (contact_id, email, action) in entries {
        transaction.execute(
            "INSERT INTO contact_import_entries(batch_id, contact_id, email, action)
             VALUES (?1, ?2, ?3, ?4)",
            params![batch_id, contact_id, email, action],
        )?;
    }
    transaction.commit()?;
    Ok(ContactImportCommitSummary {
        batch_id,
        created,
        merged,
        skipped,
    })
}
pub(super) fn contact_aliases_from_text(raw: String) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|alias| !alias.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}
pub(super) fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}
pub(super) fn normalize_contact_aliases(aliases: Vec<String>, primary_email: &str) -> Vec<String> {
    let primary = primary_email.trim().to_ascii_lowercase();
    let mut normalized = Vec::new();
    for alias in aliases {
        let value = alias.trim().to_ascii_lowercase();
        if value.is_empty() || value == primary || normalized.iter().any(|item| item == &value) {
            continue;
        }
        normalized.push(value);
    }
    normalized
}

#[derive(Default)]
struct SentContactAggregate {
    name: String,
    message_count: i64,
    last_seen_at: String,
}

fn seen_at_is_newer(candidate: &str, current: &str) -> bool {
    match (
        DateTime::parse_from_rfc3339(candidate).ok(),
        DateTime::parse_from_rfc3339(current).ok(),
    ) {
        (Some(candidate), Some(current)) => candidate > current,
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => candidate > current,
    }
}

fn own_email_addresses_for_conn(conn: &Connection) -> MailResult<BTreeSet<String>> {
    let mut addresses = BTreeSet::new();
    let mut stmt = conn.prepare(
        "SELECT email FROM accounts
         UNION
         SELECT email FROM mail_identities",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    for row in rows {
        let email = normalize_email(&row?);
        if !email.is_empty() {
            addresses.insert(email);
        }
    }
    Ok(addresses)
}

fn parse_contact_address_list(value: &str) -> Vec<(String, String)> {
    let decoded = crate::protocol::decode_address_header_value(value);
    split_address_header(&decoded)
        .into_iter()
        .filter_map(|part| parse_contact_address(&part))
        .collect()
}

fn split_address_header(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut escaped = false;
    let mut angle_depth = 0_u8;
    for character in value.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' && quoted {
            current.push(character);
            escaped = true;
            continue;
        }
        match character {
            '"' => {
                quoted = !quoted;
                current.push(character);
            }
            '<' if !quoted => {
                angle_depth = angle_depth.saturating_add(1);
                current.push(character);
            }
            '>' if !quoted => {
                angle_depth = angle_depth.saturating_sub(1);
                current.push(character);
            }
            ',' | ';' if !quoted && angle_depth == 0 => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn parse_contact_address(value: &str) -> Option<(String, String)> {
    let trimmed = value.trim();
    let (name, email) = if let Some(open) = trimmed.rfind('<') {
        let close = trimmed[open + 1..]
            .find('>')
            .map(|offset| open + 1 + offset)
            .unwrap_or(trimmed.len());
        (
            trimmed[..open].trim().trim_matches('"').trim().to_string(),
            trimmed[open + 1..close].trim().to_string(),
        )
    } else {
        (String::new(), trimmed.trim_matches('"').trim().to_string())
    };
    let email = normalize_email(email.trim_start_matches("mailto:"));
    let (local, domain) = email.split_once('@')?;
    if local.is_empty()
        || domain.is_empty()
        || domain.starts_with('.')
        || domain.ends_with('.')
        || email.chars().any(char::is_whitespace)
    {
        return None;
    }
    Some((name, email))
}

fn get_contact_for_conn_and_account(
    conn: &Connection,
    account_id: Option<i64>,
    contact_id: i64,
) -> MailResult<Contact> {
    conn.query_row(
        "SELECT id, account_id, name, email, aliases, vip, message_count, last_seen_at
         FROM contacts
         WHERE id = ?1 AND (?2 IS NULL OR account_id = ?2)",
        params![contact_id, account_id],
        |row| {
            Ok(Contact {
                id: row.get(0)?,
                account_id: row.get(1)?,
                name: row.get(2)?,
                email: row.get(3)?,
                aliases: contact_aliases_from_text(row.get(4)?),
                vip: row.get::<_, i64>(5)? != 0,
                message_count: row.get(6)?,
                last_seen_at: row.get(7)?,
            })
        },
    )
    .map_err(Into::into)
}

pub(super) fn upsert_contact(
    conn: &Connection,
    account_id: i64,
    name: &str,
    email: &str,
    seen_at: &str,
) -> MailResult<()> {
    if email.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO contacts(account_id, name, email, message_count, last_seen_at)
        VALUES (?1, ?2, ?3, 1, ?4)
        ON CONFLICT(account_id, email) DO UPDATE SET
            name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
            message_count = contacts.message_count + 1,
            last_seen_at = excluded.last_seen_at
        ",
        params![account_id, name.trim(), email.trim(), seen_at],
    )?;
    Ok(())
}

pub(super) fn rule_for_conn(conn: &Connection, rule_id: i64) -> MailResult<MailRule> {
    rule_for_conn_for_account(conn, None, rule_id)
}

fn rule_for_conn_for_account(
    conn: &Connection,
    account_id: Option<i64>,
    rule_id: i64,
) -> MailResult<MailRule> {
    conn.query_row(
        "SELECT id, account_id, name, condition, action, enabled
         FROM mail_rules
         WHERE id = ?1 AND (?2 IS NULL OR account_id = ?2)",
        params![rule_id, account_id],
        |row| {
            Ok(MailRule {
                id: row.get(0)?,
                account_id: row.get(1)?,
                name: row.get(2)?,
                condition: row.get(3)?,
                action: row.get(4)?,
                enabled: row.get::<_, i64>(5)? != 0,
            })
        },
    )
    .map_err(Into::into)
}

fn upsert_rule_for_conn(
    conn: &Connection,
    account_id: i64,
    rule_id: Option<i64>,
    input: MailRuleInput,
) -> MailResult<MailRule> {
    let name = input.name.trim();
    let condition = input.condition.trim();
    let action = input.action.trim();
    if name.is_empty() || condition.is_empty() || action.is_empty() {
        return Err(MailError::Imap(
            "规则名称、条件和动作都不能为空。".to_string(),
        ));
    }
    let enabled = bool_to_int(input.enabled);
    let id = if let Some(id) = rule_id {
        let changed = conn.execute(
            "UPDATE mail_rules
             SET name = ?2, condition = ?3, action = ?4, enabled = ?5
             WHERE id = ?1 AND account_id = ?6",
            params![id, name, condition, action, enabled, account_id],
        )?;
        if changed == 0 {
            return Err(MailError::Imap(
                "规则不存在或不属于当前邮箱账号".to_string(),
            ));
        }
        id
    } else {
        conn.execute(
            "INSERT INTO mail_rules(account_id, name, condition, action, enabled)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![account_id, name, condition, action, enabled],
        )?;
        conn.last_insert_rowid()
    };
    rule_for_conn_for_account(conn, Some(account_id), id)
}

pub(super) fn apply_enabled_rules_for_message(
    conn: &Connection,
    message_id: i64,
) -> MailResult<i64> {
    let message = message_for_conn(conn, message_id)?;
    let mut stmt = conn.prepare(
        "SELECT condition, action FROM mail_rules
         WHERE enabled = 1 AND account_id = ?1 ORDER BY id",
    )?;
    let rules = stmt
        .query_map(params![message.account_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut applied = 0;
    for (condition, action) in rules {
        if rule_matches_message(&condition, &message) {
            let (action_count, should_stop) = apply_rule_actions(conn, message_id, &action)?;
            applied += action_count;
            if should_stop {
                break;
            }
        }
    }
    Ok(applied)
}
pub(super) fn rule_matches_message(condition: &str, message: &Message) -> bool {
    let normalized = condition.trim().to_lowercase();
    let Some((field, needle)) = normalized.split_once(" contains ") else {
        return false;
    };
    let haystack = match field.trim() {
        "from" | "sender" => format!("{} {}", message.sender_name, message.sender_email),
        "subject" => message.subject.clone(),
        "body" => format!("{} {}", message.snippet, message.body),
        "to" | "recipients" => message.recipients.clone(),
        _ => return false,
    }
    .to_lowercase();
    haystack.contains(needle.trim())
}
pub(super) fn apply_rule_actions(
    conn: &Connection,
    message_id: i64,
    actions: &str,
) -> MailResult<(i64, bool)> {
    let mut applied = 0;
    let mut should_stop = false;
    for action in actions
        .split(';')
        .map(str::trim)
        .filter(|action| !action.is_empty())
    {
        if matches!(action.to_lowercase().as_str(), "stop" | "stop processing") {
            should_stop = true;
            continue;
        }
        applied += apply_rule_action(conn, message_id, action)?;
    }
    Ok((applied, should_stop))
}
pub(super) fn apply_rule_action(
    conn: &Connection,
    message_id: i64,
    action: &str,
) -> MailResult<i64> {
    let trimmed = action.trim();
    let normalized = trimmed.to_lowercase();
    if let Some(label_name) = normalized
        .strip_prefix("apply label ")
        .and_then(|_| trimmed.get("apply label ".len()..))
    {
        let label_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM labels WHERE lower(name) = lower(?1) LIMIT 1",
                params![label_name.trim()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(label_id) = label_id {
            conn.execute(
                "INSERT OR IGNORE INTO message_labels(message_id, label_id) VALUES (?1, ?2)",
                params![message_id, label_id],
            )?;
            return Ok(1);
        }
        return Ok(0);
    }
    if let Some(role) = normalized.strip_prefix("move to ") {
        let folder_id = folder_id_for_message_role(conn, message_id, role.trim())?;
        conn.execute(
            "UPDATE messages SET folder_id = ?1, snoozed_until = '' WHERE id = ?2",
            params![folder_id, message_id],
        )?;
        return Ok(1);
    }
    if normalized == "mark read" || normalized == "mark as read" {
        conn.execute(
            "UPDATE messages SET is_read = 1 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "mark unread" || normalized == "mark as unread" {
        conn.execute(
            "UPDATE messages SET is_read = 0 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "star" || normalized == "mark starred" {
        conn.execute(
            "UPDATE messages SET is_starred = 1 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    if normalized == "unstar" || normalized == "clear star" || normalized == "mark unstarred" {
        conn.execute(
            "UPDATE messages SET is_starred = 0 WHERE id = ?1",
            params![message_id],
        )?;
        return Ok(1);
    }
    Ok(0)
}

#[cfg(test)]
mod recent_contact_tests {
    use super::{parse_contact_address_list, split_address_header};

    #[test]
    fn parses_named_quoted_and_multiple_recipient_headers() {
        let parsed = parse_contact_address_list(
            "\"张三, 销售\" <ZHANG@example.com>; Ada <ada@example.com>, plain@example.com",
        );
        assert_eq!(
            parsed,
            vec![
                ("张三, 销售".to_string(), "zhang@example.com".to_string()),
                ("Ada".to_string(), "ada@example.com".to_string()),
                (String::new(), "plain@example.com".to_string()),
            ]
        );
    }

    #[test]
    fn ignores_delimiters_inside_quotes_and_rejects_invalid_addresses() {
        assert_eq!(
            split_address_header("\"Doe, Jane\" <jane@example.com>, x@example.com").len(),
            2
        );
        assert!(parse_contact_address_list("not-an-email, missing@, @missing.com").is_empty());
    }
}

#[cfg(test)]
mod account_scope_tests {
    use super::{create_contact_for_conn, upsert_rule_for_conn};
    use crate::models::{ContactCreateInput, MailRuleInput};
    use rusqlite::{params, Connection};

    fn scoped_test_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;
            CREATE TABLE accounts (id INTEGER PRIMARY KEY);
            INSERT INTO accounts(id) VALUES (1), (2);
            CREATE TABLE contacts (
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
            CREATE TABLE mail_rules (
                id INTEGER PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                condition TEXT NOT NULL,
                action TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1
            );
            ",
        )
        .expect("scoped schema creates");
        conn
    }

    #[test]
    fn keeps_same_contact_and_rule_data_separate_per_account() {
        let conn = scoped_test_connection();
        let contact_input = || ContactCreateInput {
            name: "同名联系人".to_string(),
            email: "person@example.com".to_string(),
            aliases: Vec::new(),
            vip: false,
        };
        let account_one_contact = create_contact_for_conn(&conn, 1, contact_input())
            .expect("account one contact creates");
        let account_two_contact = create_contact_for_conn(&conn, 2, contact_input())
            .expect("account two contact creates");

        assert_ne!(account_one_contact.id, account_two_contact.id);
        assert_eq!(account_one_contact.account_id, 1);
        assert_eq!(account_two_contact.account_id, 2);
        assert!(create_contact_for_conn(&conn, 1, contact_input()).is_err());
        assert!(super::update_contact_for_conn(
            &conn,
            Some(2),
            account_one_contact.id,
            crate::models::ContactInput {
                name: "不应跨账号修改".to_string(),
                aliases: Vec::new(),
                vip: false,
            },
        )
        .is_err());

        let rule_input = || MailRuleInput {
            name: "账号规则".to_string(),
            condition: "subject contains test".to_string(),
            action: "mark read".to_string(),
            enabled: true,
        };
        let account_one_rule =
            upsert_rule_for_conn(&conn, 1, None, rule_input()).expect("account one rule creates");
        let account_two_rule =
            upsert_rule_for_conn(&conn, 2, None, rule_input()).expect("account two rule creates");
        assert_eq!(account_one_rule.account_id, 1);
        assert_eq!(account_two_rule.account_id, 2);

        let account_one_contact_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM contacts WHERE account_id = ?1",
                params![1],
                |row| row.get(0),
            )
            .expect("account one contact count");
        let account_two_contact_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM contacts WHERE account_id = ?1",
                params![2],
                |row| row.get(0),
            )
            .expect("account two contact count");
        assert_eq!(account_one_contact_count, 1);
        assert_eq!(account_two_contact_count, 1);
    }
}
