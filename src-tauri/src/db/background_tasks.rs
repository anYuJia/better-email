use super::*;

const BACKGROUND_TASK_COLUMNS: &str =
    "id, kind, title, source, status, message, created_at, started_at, finished_at, account_id, cancel_requested, progress";

impl MailStore {
    pub fn enqueue_background_task(
        &self,
        input: BackgroundTaskInput,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let kind = normalize_background_task_kind(&input.kind);
            let source = normalize_background_task_source(&input.source);
            let account_id = input.account_id.filter(|id| *id > 0);
            let active_task = conn
                .query_row(
                    &format!(
                        "
                        SELECT {BACKGROUND_TASK_COLUMNS}
                        FROM background_tasks
                        WHERE kind = ?1 AND status IN ('queued', 'running')
                          AND COALESCE(account_id, 0) = COALESCE(?2, 0)
                        ORDER BY created_at ASC
                        LIMIT 1
                        "
                    ),
                    params![kind, account_id],
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
                INSERT INTO background_tasks(kind, title, source, status, message, created_at, account_id)
                VALUES (?1, ?2, ?3, 'queued', '等待执行', ?4, ?5)
                ",
                params![kind, title, source, created_at, account_id],
            )?;
            get_background_task_for_conn(conn, conn.last_insert_rowid())
        })
    }
    pub fn list_background_tasks(&self) -> MailResult<Vec<BackgroundTask>> {
        self.with_conn(list_background_tasks_for_conn)
    }
    pub fn get_background_task_by_id(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| get_background_task_for_conn(conn, task_id))
    }
    pub fn next_background_task(&self) -> MailResult<Option<BackgroundTask>> {
        self.with_conn(|conn| {
            conn.query_row(
                &format!(
                    "
                    SELECT {BACKGROUND_TASK_COLUMNS}
                    FROM background_tasks
                    WHERE status = 'queued'
                    ORDER BY created_at ASC
                    LIMIT 1
                    "
                ),
                [],
                map_background_task,
            )
            .optional()
            .map_err(Into::into)
        })
    }
    pub fn mark_background_task_running(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            // 原子领取：只有 queued 且未被请求取消的任务才能转 running。
            // 若期间被取消（queued -> cancelled），本语句影响 0 行，任务保持 cancelled。
            let started_at = Utc::now().to_rfc3339();
            let affected = conn.execute(
                "
                UPDATE background_tasks
                SET status = 'running', message = '执行中', started_at = ?1,
                    cancel_requested = 0
                WHERE id = ?2 AND status = 'queued' AND cancel_requested = 0
                ",
                params![started_at, task_id],
            )?;
            if affected == 0 {
                return Err(MailError::Imap(
                    "任务已不在排队状态（可能已取消），无法开始执行。".to_string(),
                ));
            }
            get_background_task_for_conn(conn, task_id)
        })
    }
    pub fn complete_background_task(
        &self,
        task_id: i64,
        message: &str,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            // 原子完成：仅 running 且未被请求取消的任务可完成。
            // 被取消的任务由 consume_background_task_cancel 落为 cancelled，绝不误标 done。
            let finished_at = Utc::now().to_rfc3339();
            let affected = conn.execute(
                "
                UPDATE background_tasks
                SET status = 'done', message = ?1, finished_at = ?2, cancel_requested = 0
                WHERE id = ?3 AND status = 'running' AND cancel_requested = 0
                ",
                params![message, finished_at, task_id],
            )?;
            if affected == 0 {
                return Err(MailError::Imap(
                    "任务已完成、被取消或不在执行状态，本次完成结果未提交。".to_string(),
                ));
            }
            get_background_task_for_conn(conn, task_id)
        })
    }
    pub fn fail_background_task(&self, task_id: i64, message: &str) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            // 原子失败：仅 running 任务可失败；已取消的任务保持 cancelled。
            let finished_at = Utc::now().to_rfc3339();
            let affected = conn.execute(
                "
                UPDATE background_tasks
                SET status = 'failed', message = ?1, finished_at = ?2, cancel_requested = 0
                WHERE id = ?3 AND status = 'running' AND cancel_requested = 0
                ",
                params![message, finished_at, task_id],
            )?;
            if affected == 0 {
                return Err(MailError::Imap(
                    "任务已取消或不在执行状态，失败结果未提交。".to_string(),
                ));
            }
            get_background_task_for_conn(conn, task_id)
        })
    }
    /// 取消任务：排队中的立即取消；运行中的置 cancel_requested，
    /// 由执行方在安全检查点（任务边界）消费后落为 cancelled。
    pub fn cancel_background_task(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let task = get_background_task_for_conn(conn, task_id)?;
            if task.status == "queued" {
                let finished_at = Utc::now().to_rfc3339();
                conn.execute(
                    "
                    UPDATE background_tasks
                    SET status = 'cancelled', message = '已取消', finished_at = ?1
                    WHERE id = ?2
                    ",
                    params![finished_at, task_id],
                )?;
            } else if task.status == "running" {
                conn.execute(
                    "
                    UPDATE background_tasks
                    SET cancel_requested = 1, message = '正在取消…'
                    WHERE id = ?1
                    ",
                    params![task_id],
                )?;
            }
            get_background_task_for_conn(conn, task_id)
        })
    }
    /// 在安全检查点确认取消请求：已请求取消时把任务落为 cancelled，
    /// 返回 true 表示执行方应放弃本次结果。
    pub fn consume_background_task_cancel(&self, task_id: i64) -> MailResult<bool> {
        self.with_conn(|conn| {
            let task = get_background_task_for_conn(conn, task_id)?;
            if task.status != "running" || !task.cancel_requested {
                return Ok(false);
            }
            let finished_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'cancelled', message = '已取消', cancel_requested = 0, finished_at = ?1
                WHERE id = ?2
                ",
                params![finished_at, task_id],
            )?;
            Ok(true)
        })
    }
    /// 失败/已取消的任务重新排队，供用户重试。
    pub fn retry_background_task(&self, task_id: i64) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            let task = get_background_task_for_conn(conn, task_id)?;
            if !matches!(task.status.as_str(), "failed" | "cancelled") {
                return Ok(task);
            }
            conn.execute(
                "
                UPDATE background_tasks
                SET status = 'queued', message = '等待执行', cancel_requested = 0,
                    progress = 0, started_at = '', finished_at = ''
                WHERE id = ?1
                ",
                params![task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }
    /// 运行中任务的进度更新（文件夹/批次级）。仅 running 任务可更新。
    pub fn update_background_task_progress(
        &self,
        task_id: i64,
        progress: i64,
        message: &str,
    ) -> MailResult<BackgroundTask> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE background_tasks
                SET progress = ?1, message = ?2
                WHERE id = ?3 AND status = 'running'
                ",
                params![progress, message, task_id],
            )?;
            get_background_task_for_conn(conn, task_id)
        })
    }
    /// 取消令牌：同步流程在文件夹/批次安全点检查，已请求取消时返回 true。
    pub fn background_task_cancel_requested(&self, task_id: i64) -> MailResult<bool> {
        self.with_conn(|conn| {
            let task = get_background_task_for_conn(conn, task_id)?;
            Ok(task.status == "running" && task.cancel_requested)
        })
    }
}

pub(super) fn get_background_task_for_conn(
    conn: &Connection,
    id: i64,
) -> MailResult<BackgroundTask> {
    conn.query_row(
        &format!(
            "
            SELECT {BACKGROUND_TASK_COLUMNS}
            FROM background_tasks
            WHERE id = ?1
            "
        ),
        params![id],
        map_background_task,
    )
    .map_err(Into::into)
}
pub(super) fn list_background_tasks_for_conn(conn: &Connection) -> MailResult<Vec<BackgroundTask>> {
    let mut stmt = conn.prepare(&format!(
        "
            SELECT {BACKGROUND_TASK_COLUMNS}
            FROM background_tasks
            ORDER BY created_at DESC
            LIMIT 10
            "
    ))?;
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
        account_id: row.get(9)?,
        cancel_requested: row.get::<_, i64>(10)? != 0,
        progress: row.get::<_, i64>(11)?,
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
        "initial" => "initial",
        _ => "manual",
    }
}
pub(super) fn background_task_title(kind: &str, source: &str) -> &'static str {
    match (kind, source) {
        ("sync", "timer") => "定时同步邮件头",
        ("sync", "initial") => "首次同步邮件头",
        ("sync", _) => "同步邮件头",
        ("outbox-smtp", _) => "真实发送发件箱",
        ("outbox-dry-run", _) => "发件箱发送演练",
        _ => "后台任务",
    }
}
