use super::*;

impl MailStore {
    pub fn enqueue_background_task(
        &self,
        input: BackgroundTaskInput,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let kind = normalize_background_task_kind(&input.kind);
            let source = normalize_background_task_source(&input.source);
            let active_task = conn
                .query_row(
                    "
                    SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
                    FROM background_tasks
                    WHERE kind = ?1 AND status IN ('queued', 'running')
                    ORDER BY created_at ASC
                    LIMIT 1
                    ",
                    params![kind],
                    map_background_task,
                )
                .optional()?;
            if let Some(task) = active_task {
                return Ok(task);
            }

            let created_at = Utc::now().to_rfc3339();
            let title = background_task_title(kind, source);
            conn.execute(
                "
                INSERT INTO background_tasks(kind, title, source, status, message, created_at)
                VALUES (?1, ?2, ?3, 'queued', '等待执行', ?4)
                ",
                params![kind, title, source, created_at],
            )?;
            get_background_task_for_conn(conn, conn.last_insert_rowid())
        })
    }
    pub fn list_background_tasks(&self) -> MailResult<Vec<BackgroundTask>> {
        self.with_conn(list_background_tasks_for_conn)
    }
    pub fn next_background_task(&self) -> MailResult<Option<BackgroundTask>> {
        self.with_conn(|conn| {
            conn.query_row(
                "
                SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
                FROM background_tasks
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                ",
                [],
                map_background_task,
            )
            .optional()
            .map_err(Into::into)
        })
    }
    pub fn mark_background_task_running(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let started_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'running', message = '执行中', started_at = ?1
                WHERE id = ?2
                ",
                params![started_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }
    pub fn complete_background_task(
        &self,
        task_id: i64,
        message: &str,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let finished_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'done', message = ?1, finished_at = ?2
                WHERE id = ?3
                ",
                params![message, finished_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }
    pub fn fail_background_task(&self, task_id: i64, message: &str) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let finished_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'failed', message = ?1, finished_at = ?2
                WHERE id = ?3
                ",
                params![message, finished_at, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }
}

pub(super) fn get_background_task_for_conn(conn: &Connection, id: i64) -> MailResult<BackgroundTask> {
    conn.query_row(
        "
        SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
        FROM background_tasks
        WHERE id = ?1
        ",
        params![id],
        map_background_task,
    )
    .map_err(Into::into)
}
pub(super) fn list_background_tasks_for_conn(conn: &Connection) -> MailResult<Vec<BackgroundTask>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, kind, title, source, status, message, created_at, started_at, finished_at
        FROM background_tasks
        ORDER BY created_at DESC
        LIMIT 10
        ",
    )?;
    let tasks = stmt
        .query_map([], map_background_task)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tasks)
}
pub(super) fn map_background_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<BackgroundTask> {
    Ok(BackgroundTask {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        source: row.get(3)?,
        status: row.get(4)?,
        message: row.get(5)?,
        created_at: row.get(6)?,
        started_at: row.get(7)?,
        finished_at: row.get(8)?,
    })
}
pub(super) fn normalize_background_task_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "outbox-dry-run" => "outbox-dry-run",
        "outbox-smtp" => "outbox-smtp",
        _ => "sync",
    }
}
pub(super) fn normalize_background_task_source(source: &str) -> &'static str {
    match source.trim() {
        "timer" => "timer",
        _ => "manual",
    }
}
pub(super) fn background_task_title(kind: &str, source: &str) -> &'static str {
    match (kind, source) {
        ("sync", "timer") => "定时同步邮件头",
        ("sync", _) => "同步邮件头",
        ("outbox-smtp", _) => "真实发送发件箱",
        ("outbox-dry-run", _) => "发件箱发送演练",
        _ => "后台任务",
    }
}

