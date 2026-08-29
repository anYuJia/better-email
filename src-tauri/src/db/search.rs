#[derive(Debug, Default)]
pub(super) struct SearchCriteria {
    text: Option<String>,
    from: Option<String>,
    to: Option<String>,
    cc: Option<String>,
    bcc: Option<String>,
    subject: Option<String>,
    body: Option<String>,
    label: Option<String>,
    account: Option<String>,
    mailbox: Option<String>,
    filename: Option<String>,
    after: Option<String>,
    before: Option<String>,
    has_attachment: bool,
    is_unread: bool,
    is_read: bool,
    is_starred: bool,
}
impl SearchCriteria {
    pub(super) fn parse(search: Option<&str>) -> Self {
        let mut criteria = Self::default();
        let Some(raw) = search else {
            return criteria;
        };
        let mut text_terms = Vec::new();
        for token in raw.split_whitespace() {
            if let Some(value) = token
                .strip_prefix("from:")
                .filter(|value| !value.is_empty())
            {
                criteria.from = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("to:").filter(|value| !value.is_empty())
            {
                criteria.to = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("cc:").filter(|value| !value.is_empty())
            {
                criteria.cc = Some(value.to_string());
            } else if let Some(value) = token.strip_prefix("bcc:").filter(|value| !value.is_empty())
            {
                criteria.bcc = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("subject:")
                .filter(|value| !value.is_empty())
            {
                criteria.subject = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("body:")
                .or_else(|| token.strip_prefix("content:"))
                .filter(|value| !value.is_empty())
            {
                criteria.body = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("label:")
                .filter(|value| !value.is_empty())
            {
                criteria.label = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("account:")
                .filter(|value| !value.is_empty())
            {
                criteria.account = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("mailbox:")
                .filter(|value| !value.is_empty())
            {
                criteria.mailbox = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("folder:")
                .filter(|value| !value.is_empty())
            {
                criteria.mailbox = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("filename:")
                .filter(|value| !value.is_empty())
            {
                criteria.filename = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("attachment:")
                .filter(|value| !value.is_empty())
            {
                criteria.filename = Some(value.to_string());
            } else if let Some(value) = token
                .strip_prefix("after:")
                .filter(|value| !value.is_empty())
            {
                criteria.after = Some(normalize_search_date_start(value));
            } else if let Some(value) = token
                .strip_prefix("before:")
                .filter(|value| !value.is_empty())
            {
                criteria.before = Some(normalize_search_date_end(value));
            } else if matches!(token, "has:attachment" | "has:attachments") {
                criteria.has_attachment = true;
            } else if token == "is:unread" {
                criteria.is_unread = true;
                criteria.is_read = false;
            } else if token == "is:read" {
                criteria.is_read = true;
                criteria.is_unread = false;
            } else if token == "is:starred" {
                criteria.is_starred = true;
            } else {
                text_terms.push(token);
            }
        }
        let text = text_terms.join(" ");
        if !text.trim().is_empty() {
            criteria.text = Some(text);
        }
        criteria
    }

    pub(super) fn params(&self) -> Vec<String> {
        let mut params = Vec::new();
        if let Some(text) = &self.text {
            let value = if should_use_fts(text) {
                build_fts_query(text)
            } else {
                build_like_query(text)
            };
            let repeat = if should_use_fts(text) { 1 } else { 5 };
            params.extend(std::iter::repeat_n(value, repeat));
        }
        if let Some(from) = &self.from {
            let value = build_like_query(from);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(to) = &self.to {
            params.push(build_like_query(to));
        }
        if let Some(cc) = &self.cc {
            params.push(build_like_query(cc));
        }
        if let Some(bcc) = &self.bcc {
            params.push(build_like_query(bcc));
        }
        if let Some(subject) = &self.subject {
            params.push(build_like_query(subject));
        }
        if let Some(body) = &self.body {
            let value = build_like_query(body);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(label) = &self.label {
            params.push(build_like_query(label));
        }
        if let Some(account) = &self.account {
            let value = build_like_query(account);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(mailbox) = &self.mailbox {
            let value = build_like_query(mailbox);
            params.extend(std::iter::repeat_n(value, 2));
        }
        if let Some(filename) = &self.filename {
            params.push(build_like_query(filename));
        }
        if let Some(after) = &self.after {
            params.push(after.clone());
        }
        if let Some(before) = &self.before {
            params.push(before.clone());
        }
        params
    }
}
pub(super) fn build_message_summary_query(
    search: &SearchCriteria,
    filter: &str,
    scope_condition: &str,
    sort: Option<&str>,
) -> String {
    let mut sql = String::from(
        "
        SELECT m.id, m.account_id, a.email, m.folder_id, f.role, m.sender_name, m.sender_email, m.recipients,
               m.cc, m.bcc, m.subject, m.snippet, m.security_warnings,
                       m.received_at, m.is_read, m.is_starred, m.has_attachments,
                       m.snoozed_until, m.remote_mailbox, m.remote_uid,
                       m.message_id_header, m.in_reply_to_header, m.references_header
        FROM messages m
        JOIN accounts a ON a.id = m.account_id
        JOIN folders f ON f.id = m.folder_id
        ",
    );
    let filter_clause = build_message_filter_clause(search, filter);
    let mut conditions = Vec::new();
    let trimmed_scope = scope_condition.trim();
    if !trimmed_scope.is_empty() {
        conditions.push(trimmed_scope.to_string());
    }
    let trimmed_filter = filter_clause.trim().trim_start_matches("AND").trim();
    if !trimmed_filter.is_empty() {
        conditions.push(trimmed_filter.to_string());
    }
    if !conditions.is_empty() {
        sql.push_str("WHERE ");
        sql.push_str(&conditions.join(" AND "));
        sql.push(' ');
    }
    sql.push_str("ORDER BY ");
    sql.push_str(message_order_clause(sort));
    sql.push_str(" LIMIT ? OFFSET ?");
    sql
}
pub(super) fn normalized_list_sort(sort: Option<&str>) -> &'static str {
    match sort.map(str::trim) {
        Some("oldest") => "oldest",
        Some("sender") => "sender",
        Some("subject") => "subject",
        _ => "newest",
    }
}
pub(super) fn message_order_clause(sort: Option<&str>) -> &'static str {
    match normalized_list_sort(sort) {
        "oldest" => "m.received_at ASC, m.id ASC",
        "sender" => {
            "lower(m.sender_name) ASC, lower(m.sender_email) ASC, m.received_at DESC, m.id DESC"
        }
        "subject" => "lower(m.subject) ASC, m.received_at DESC, m.id DESC",
        _ => "m.received_at DESC, m.id DESC",
    }
}
pub(super) fn thread_order_clause(sort: Option<&str>) -> &'static str {
    match normalized_list_sort(sort) {
        "oldest" => "latest_at ASC, scoped.thread_key ASC",
        "sender" => "lower(participants) ASC, latest_at DESC, scoped.thread_key ASC",
        "subject" => "lower(subject) ASC, latest_at DESC, scoped.thread_key ASC",
        _ => "latest_at DESC, scoped.thread_key ASC",
    }
}
pub(super) fn build_message_filter_clause(search: &SearchCriteria, filter: &str) -> String {
    let mut sql = String::new();
    if let Some(term) = &search.text {
        if should_use_fts(term) {
            sql.push_str(
                "AND m.id IN (
                    SELECT rowid FROM message_search WHERE message_search MATCH ?
                ) ",
            );
        } else {
            sql.push_str(
                "AND (
                    m.subject LIKE ? ESCAPE '\\'
                    OR m.sender_name LIKE ? ESCAPE '\\'
                    OR m.sender_email LIKE ? ESCAPE '\\'
                    OR m.recipients LIKE ? ESCAPE '\\'
                    OR m.snippet LIKE ? ESCAPE '\\'
                ) ",
            );
        }
    }
    if search.from.is_some() {
        sql.push_str(
            "AND (m.sender_name LIKE ? ESCAPE '\\' OR m.sender_email LIKE ? ESCAPE '\\') ",
        );
    }
    if search.to.is_some() {
        sql.push_str("AND m.recipients LIKE ? ESCAPE '\\' ");
    }
    if search.cc.is_some() {
        sql.push_str("AND m.cc LIKE ? ESCAPE '\\' ");
    }
    if search.bcc.is_some() {
        sql.push_str("AND m.bcc LIKE ? ESCAPE '\\' ");
    }
    if search.subject.is_some() {
        sql.push_str("AND m.subject LIKE ? ESCAPE '\\' ");
    }
    if search.body.is_some() {
        sql.push_str("AND (m.body LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\') ");
    }
    if search.label.is_some() {
        sql.push_str(
            "AND EXISTS (
                SELECT 1
                FROM message_labels ml
                JOIN labels l ON l.id = ml.label_id
                WHERE ml.message_id = m.id AND l.name LIKE ? ESCAPE '\\'
            ) ",
        );
    }
    if search.account.is_some() {
        sql.push_str("AND (a.email LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\') ");
    }
    if search.mailbox.is_some() {
        sql.push_str("AND (m.remote_mailbox LIKE ? ESCAPE '\\' OR f.name LIKE ? ESCAPE '\\') ");
    }
    if search.filename.is_some() {
        sql.push_str(
            "AND EXISTS (
                SELECT 1
                FROM attachments att
                WHERE att.message_id = m.id AND att.filename LIKE ? ESCAPE '\\'
            ) ",
        );
    }
    if search.after.is_some() {
        sql.push_str("AND m.received_at >= ? ");
    }
    if search.before.is_some() {
        sql.push_str("AND m.received_at <= ? ");
    }
    if search.has_attachment {
        sql.push_str("AND m.has_attachments = 1 ");
    }
    if search.is_unread {
        sql.push_str("AND m.is_read = 0 ");
    }
    if search.is_read {
        sql.push_str("AND m.is_read = 1 ");
    }
    if search.is_starred {
        sql.push_str("AND m.is_starred = 1 ");
    }
    match filter {
        "unread" => sql.push_str("AND m.is_read = 0 "),
        "starred" => sql.push_str("AND m.is_starred = 1 "),
        "attachments" => sql.push_str("AND m.has_attachments = 1 "),
        _ => {}
    }
    sql
}
pub(super) fn should_use_fts(term: &str) -> bool {
    term.is_ascii() && !term.trim().is_empty()
}
pub(super) fn build_fts_query(term: &str) -> String {
    term.split_whitespace()
        .map(|part| format!("\"{}\"", part.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}
pub(super) fn build_like_query(term: &str) -> String {
    let escaped = term
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}
pub(super) fn normalize_search_date_start(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') {
        format!("{trimmed}T00:00:00")
    } else {
        trimmed.to_string()
    }
}
pub(super) fn normalize_search_date_end(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 10 && trimmed.chars().nth(4) == Some('-') {
        format!("{trimmed}T23:59:59")
    } else {
        trimmed.to_string()
    }
}
