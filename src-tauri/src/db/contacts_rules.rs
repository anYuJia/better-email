use super::*;
use super::folders::folder_id_for_message_role;
use super::messages::bool_to_int;
use super::messages::message_for_conn;

impl MailStore {
    pub fn list_contacts(&self) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts ORDER BY last_seen_at DESC, name LIMIT 100",
            )?;
            let contacts = stmt
                .query_map([], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }
    pub fn list_contact_merge_suggestions(&self) -> MailResult<Vec<ContactMergeSuggestion>> {
        let contacts = self.list_contacts()?;
        Ok(detect_contact_merge_suggestions(contacts))
    }
    pub fn list_all_contacts(&self) -> MailResult<Vec<Contact>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                 FROM contacts ORDER BY name COLLATE NOCASE, email COLLATE NOCASE",
            )?;
            let contacts = stmt
                .query_map([], |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(contacts)
        })
    }
    pub fn import_contacts(&self, inputs: Vec<ContactCreateInput>) -> MailResult<(i64, i64)> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let now = Utc::now().to_rfc3339();
            let mut created = 0_i64;
            let mut updated = 0_i64;

            for input in inputs {
                let email = normalize_email(&input.email);
                if email.is_empty() {
                    continue;
                }
                let existing = transaction
                    .query_row(
                        "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                         FROM contacts WHERE lower(email) = lower(?1)",
                        params![email],
                        |row| {
                            Ok(Contact {
                                id: row.get(0)?,
                                name: row.get(1)?,
                                email: row.get(2)?,
                                aliases: contact_aliases_from_text(row.get(3)?),
                                vip: row.get::<_, i64>(4)? != 0,
                                message_count: row.get(5)?,
                                last_seen_at: row.get(6)?,
                            })
                        },
                    )
                    .optional()?;
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
                        "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1",
                        params![
                            existing.id,
                            name,
                            contact_aliases_to_text(&aliases),
                            if existing.vip || input.vip { 1 } else { 0 },
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
                        "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                        params![
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
        })
    }
    pub fn classify_contact_import(
        &self,
        inputs: Vec<ContactCreateInput>,
    ) -> MailResult<Vec<ContactImportPreviewEntry>> {
        self.with_conn(|conn| {
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
                let existing = conn
                    .query_row(
                        "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                         FROM contacts WHERE lower(email) = lower(?1)",
                        params![email],
                        |row| {
                            Ok(Contact {
                                id: row.get(0)?,
                                name: row.get(1)?,
                                email: row.get(2)?,
                                aliases: contact_aliases_from_text(row.get(3)?),
                                vip: row.get::<_, i64>(4)? != 0,
                                message_count: row.get(5)?,
                                last_seen_at: row.get(6)?,
                            })
                        },
                    )
                    .optional()?;
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
        })
    }
    pub fn commit_contact_import(
        &self,
        inputs: Vec<(ContactCreateInput, String)>,
        file_name: &str,
        scope: &str,
    ) -> MailResult<ContactImportCommitSummary> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let now = Utc::now().to_rfc3339();
            let mut created = 0_i64;
            let mut merged = 0_i64;
            let mut skipped = 0_i64;
            let mut entries: Vec<(i64, String, String)> = Vec::new();
            for (input, action) in inputs {
                let email = normalize_email(&input.email);
                if email.is_empty() {
                    skipped += 1;
                    continue;
                }
                match action.as_str() {
                    "skip" => {
                        skipped += 1;
                    }
                    "merge" => {
                        let existing = transaction
                            .query_row(
                                "SELECT id, name, email, aliases, vip, message_count, last_seen_at
                                 FROM contacts WHERE lower(email) = lower(?1)",
                                params![email],
                                |row| {
                                    Ok(Contact {
                                        id: row.get(0)?,
                                        name: row.get(1)?,
                                        email: row.get(2)?,
                                        aliases: contact_aliases_from_text(row.get(3)?),
                                        vip: row.get::<_, i64>(4)? != 0,
                                        message_count: row.get(5)?,
                                        last_seen_at: row.get(6)?,
                                    })
                                },
                            )
                            .optional()?;
                        if let Some(existing) = existing {
                            let mut aliases = existing.aliases.clone();
                            aliases.extend(input.aliases);
                            let aliases = normalize_contact_aliases(aliases, &existing.email);
                            let imported_name = input.name.trim();
                            let name = if (existing.name.trim().is_empty()
                                || existing.name == existing.email)
                                && !imported_name.is_empty()
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
                                "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                                 VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                                params![
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
                    _ => {
                        let display_name = if input.name.trim().is_empty() {
                            email.as_str()
                        } else {
                            input.name.trim()
                        };
                        let aliases = normalize_contact_aliases(input.aliases, &email);
                        transaction.execute(
                            "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                             VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                            params![
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
            }
            let total_count = created + merged + skipped;
            transaction.execute(
                "INSERT INTO contact_import_batches(file_name, total_count, created_count, merged_count, skipped_count, scope, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    file_name,
                    total_count,
                    created,
                    merged,
                    skipped,
                    scope,
                    now
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
        })
    }
    pub fn list_contact_import_batches(&self) -> MailResult<Vec<ContactImportBatch>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, file_name, total_count, created_count, merged_count, skipped_count, scope, created_at
                 FROM contact_import_batches ORDER BY id DESC LIMIT 50",
            )?;
            let batches = stmt
                .query_map([], |row| {
                    Ok(ContactImportBatch {
                        id: row.get(0)?,
                        file_name: row.get(1)?,
                        total_count: row.get(2)?,
                        created_count: row.get(3)?,
                        merged_count: row.get(4)?,
                        skipped_count: row.get(5)?,
                        scope: row.get(6)?,
                        created_at: row.get(7)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(batches)
        })
    }
    pub fn undo_contact_import_batch(
        &self,
        batch_id: i64,
    ) -> MailResult<ContactImportUndoReport> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let created_contact_ids: Vec<i64> = {
                let mut stmt = transaction.prepare(
                    "SELECT contact_id FROM contact_import_entries WHERE batch_id = ?1 AND action = 'create' AND contact_id IS NOT NULL",
                )?;
                let rows = stmt
                    .query_map(params![batch_id], |row| row.get::<_, i64>(0))?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            };
            let mut removed = 0_i64;
            for contact_id in created_contact_ids {
                let changed = transaction.execute(
                    "DELETE FROM contacts WHERE id = ?1",
                    params![contact_id],
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
            let remaining_created = self.with_conn(|conn| {
                let count = conn.query_row(
                    "SELECT COUNT(*) FROM contact_import_entries WHERE batch_id = ?1 AND action = 'create'",
                    params![batch_id],
                    |row| row.get::<_, i64>(0),
                )?;
                Ok(count)
            })?;
            Ok(ContactImportUndoReport {
                removed,
                remaining_created,
                note: "已删除该批次新增的联系人；合并/更新已有联系人的变更不可回滚。".to_string(),
            })
        })
    }
    pub fn create_contact(&self, input: ContactCreateInput) -> MailResult<Contact> {
        self.with_conn(|conn| {
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
                "INSERT INTO contacts(name, email, aliases, vip, message_count, last_seen_at)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![
                    display_name,
                    email,
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                    now,
                ],
            )?;
            get_contact_for_conn(conn, conn.last_insert_rowid())
        })
    }
    pub fn update_contact(&self, contact_id: i64, input: ContactInput) -> MailResult<Contact> {
        self.with_conn(|conn| {
            let existing = conn.query_row(
                "SELECT id, name, email, aliases, vip, message_count, last_seen_at FROM contacts WHERE id = ?1",
                params![contact_id],
                |row| {
                    Ok(Contact {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        aliases: contact_aliases_from_text(row.get(3)?),
                        vip: row.get::<_, i64>(4)? != 0,
                        message_count: row.get(5)?,
                        last_seen_at: row.get(6)?,
                    })
                },
            )?;
            let name = input.name.trim();
            let aliases = normalize_contact_aliases(input.aliases, &existing.email);
            conn.execute(
                "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4 WHERE id = ?1",
                params![
                    contact_id,
                    if name.is_empty() { existing.name.as_str() } else { name },
                    contact_aliases_to_text(&aliases),
                    if input.vip { 1 } else { 0 },
                ],
            )?;
            Ok(Contact {
                aliases,
                vip: input.vip,
                name: if name.is_empty() { existing.name } else { name.to_string() },
                ..existing
            })
        })
    }
    pub fn delete_contact(&self, contact_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM contacts WHERE id = ?1", params![contact_id])?;
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
            let target = get_contact_for_conn(conn, target_contact_id)?;
            let source = get_contact_for_conn(conn, source_contact_id)?;
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
                "UPDATE contacts SET name = ?2, aliases = ?3, vip = ?4, message_count = ?5, last_seen_at = ?6 WHERE id = ?1",
                params![
                    target_contact_id,
                    name,
                    contact_aliases_to_text(&aliases),
                    if target.vip || source.vip { 1 } else { 0 },
                    message_count,
                    last_seen_at,
                ],
            )?;
            conn.execute("DELETE FROM contacts WHERE id = ?1", params![source_contact_id])?;
            get_contact_for_conn(conn, target_contact_id)
        })
    }
    pub fn list_rules(&self) -> MailResult<Vec<MailRule>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, condition, action, enabled FROM mail_rules ORDER BY id",
            )?;
            let rules = stmt
                .query_map([], |row| {
                    Ok(MailRule {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        condition: row.get(2)?,
                        action: row.get(3)?,
                        enabled: row.get::<_, i64>(4)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rules)
        })
    }
    pub fn upsert_rule(&self, rule_id: Option<i64>, input: MailRuleInput) -> MailResult<MailRule> {
        self.with_conn(|conn| {
            let name = input.name.trim();
            let condition = input.condition.trim();
            let action = input.action.trim();
            if name.is_empty() || condition.is_empty() || action.is_empty() {
                return Err(crate::db::MailError::Imap(
                    "规则名称、条件和动作都不能为空。".to_string(),
                ));
            }
            let enabled = bool_to_int(input.enabled);
            let id = if let Some(id) = rule_id {
                conn.execute(
                    "
                    UPDATE mail_rules
                    SET name = ?2, condition = ?3, action = ?4, enabled = ?5
                    WHERE id = ?1
                    ",
                    params![id, name, condition, action, enabled],
                )?;
                id
            } else {
                conn.execute(
                    "
                    INSERT INTO mail_rules(name, condition, action, enabled)
                    VALUES (?1, ?2, ?3, ?4)
                    ",
                    params![name, condition, action, enabled],
                )?;
                conn.last_insert_rowid()
            };
            rule_for_conn(conn, id)
        })
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
    pub fn delete_rule(&self, rule_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute("DELETE FROM mail_rules WHERE id = ?1", params![rule_id])?;
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
pub(super) fn contact_identity_keys(contact: &Contact) -> Vec<String> {
    let mut keys = vec![normalize_email(&contact.email)];
    keys.extend(contact.aliases.iter().map(|alias| normalize_email(alias)));
    keys.extend(
        contact
            .name
            .split(|character: char| !character.is_ascii_alphanumeric())
            .map(str::trim)
            .filter(|part| part.len() >= 4)
            .map(|part| part.to_ascii_lowercase()),
    );
    let domain = contact.email.split('@').nth(1).unwrap_or("").trim();
    if !domain.is_empty() {
        let name_key = contact.name.trim().to_ascii_lowercase();
        if !name_key.is_empty() && name_key != normalize_email(&contact.email) {
            keys.push(format!("{name_key}@{domain}"));
        }
    }
    let mut unique = Vec::new();
    for key in keys {
        if !key.is_empty() && !unique.iter().any(|item| item == &key) {
            unique.push(key);
        }
    }
    unique
}
pub(super) fn contact_suggestion_reason(shared_keys: &[String]) -> String {
    if shared_keys.iter().any(|key| key.contains('@')) {
        "邮箱或别名重叠".to_string()
    } else {
        "名称相近，建议检查是否同一联系人".to_string()
    }
}
pub(super) fn detect_contact_merge_suggestions(mut contacts: Vec<Contact>) -> Vec<ContactMergeSuggestion> {
    contacts.sort_by(|left, right| {
        right
            .message_count
            .cmp(&left.message_count)
            .then_with(|| right.last_seen_at.cmp(&left.last_seen_at))
            .then_with(|| left.name.cmp(&right.name))
    });
    let mut suggestions = Vec::new();
    for left_index in 0..contacts.len() {
        let left = &contacts[left_index];
        let left_keys = contact_identity_keys(left);
        for right in contacts.iter().skip(left_index + 1) {
            let right_keys = contact_identity_keys(right);
            let shared_keys = left_keys
                .iter()
                .filter(|key| right_keys.iter().any(|right_key| right_key == *key))
                .take(4)
                .cloned()
                .collect::<Vec<_>>();
            if shared_keys.is_empty() {
                continue;
            }
            suggestions.push(ContactMergeSuggestion {
                target: left.clone(),
                source: right.clone(),
                reason: contact_suggestion_reason(&shared_keys),
                shared_keys,
            });
            if suggestions.len() >= 8 {
                return suggestions;
            }
        }
    }
    suggestions
}
pub(super) fn get_contact_for_conn(conn: &Connection, contact_id: i64) -> MailResult<Contact> {
    conn.query_row(
        "SELECT id, name, email, aliases, vip, message_count, last_seen_at FROM contacts WHERE id = ?1",
        params![contact_id],
        |row| {
            Ok(Contact {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                aliases: contact_aliases_from_text(row.get(3)?),
                vip: row.get::<_, i64>(4)? != 0,
                message_count: row.get(5)?,
                last_seen_at: row.get(6)?,
            })
        },
    )
    .map_err(Into::into)
}
pub(super) fn upsert_contact(conn: &Connection, name: &str, email: &str, seen_at: &str) -> MailResult<()> {
    if email.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "
        INSERT INTO contacts(name, email, message_count, last_seen_at)
        VALUES (?1, ?2, 1, ?3)
        ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
            message_count = contacts.message_count + 1,
            last_seen_at = excluded.last_seen_at
        ",
        params![name.trim(), email.trim(), seen_at],
    )?;
    Ok(())
}
pub(super) fn rule_for_conn(conn: &Connection, rule_id: i64) -> MailResult<MailRule> {
    conn.query_row(
        "SELECT id, name, condition, action, enabled FROM mail_rules WHERE id = ?1",
        params![rule_id],
        |row| {
            Ok(MailRule {
                id: row.get(0)?,
                name: row.get(1)?,
                condition: row.get(2)?,
                action: row.get(3)?,
                enabled: row.get::<_, i64>(4)? != 0,
            })
        },
    )
    .map_err(Into::into)
}
pub(super) fn apply_enabled_rules_for_message(conn: &Connection, message_id: i64) -> MailResult<i64> {
    let message = message_for_conn(conn, message_id)?;
    let mut stmt =
        conn.prepare("SELECT condition, action FROM mail_rules WHERE enabled = 1 ORDER BY id")?;
    let rules = stmt
        .query_map([], |row| {
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
pub(super) fn apply_rule_action(conn: &Connection, message_id: i64, action: &str) -> MailResult<i64> {
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

