use super::common::command_info;
use crate::db::{MailError, MailResult, MailStore};
use crate::models::{BackgroundTask, BackgroundTaskInput};
use tauri::State;
#[tauri::command]
pub fn enqueue_background_task(
    store: State<'_, MailStore>,
    input: BackgroundTaskInput,
) -> MailResult<BackgroundTask> {
    command_info(format!(
        "[better-email][task] enqueue start kind={} source={}",
        input.kind.trim(),
        input.source.trim(),
    ));
    match store.enqueue_background_task(input) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] enqueue ok task_id={} kind={} source={} status={}",
                task.id, task.kind, task.source, task.status,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!("[better-email][task] enqueue failed error={error}"));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_background_tasks(store: State<'_, MailStore>) -> MailResult<Vec<BackgroundTask>> {
    store.list_background_tasks()
}

/// 轮询单个任务的进度与取消状态（文件夹/批次级进度由 Rust 同步流程写入）。
#[tauri::command]
pub fn get_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<BackgroundTask> {
    store.get_background_task_by_id(task_id)
}

#[tauri::command]
pub fn next_background_task(store: State<'_, MailStore>) -> MailResult<Option<BackgroundTask>> {
    match store.next_background_task() {
        Ok(Some(task)) => {
            command_info(format!(
                "[better-email][task] next task_id={} kind={} source={} status={}",
                task.id, task.kind, task.source, task.status,
            ));
            Ok(Some(task))
        }
        Ok(None) => Ok(None),
        Err(error) => {
            crate::logging::log_line(format!("[better-email][task] next failed error={error}"));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn mark_background_task_running(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<BackgroundTask> {
    match store.mark_background_task_running(task_id) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] running task_id={} kind={} source={}",
                task.id, task.kind, task.source,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] running failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn update_background_task_progress(
    store: State<'_, MailStore>,
    task_id: i64,
    progress: i64,
    message: String,
) -> MailResult<BackgroundTask> {
    match store.update_background_task_progress(task_id, progress, &message) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] progress task_id={} kind={} source={} progress={} message={}",
                task.id, task.kind, task.source, task.progress, task.message,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] progress failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn complete_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
    message: String,
) -> MailResult<BackgroundTask> {
    match store.complete_background_task(task_id, &message) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] complete task_id={} kind={} source={} message={}",
                task.id, task.kind, task.source, task.message,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] complete failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn fail_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
    message: String,
) -> MailResult<BackgroundTask> {
    match store.fail_background_task(task_id, &message) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] fail task_id={} kind={} source={} message={}",
                task.id, task.kind, task.source, task.message,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] fail failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

/// 绑定明确 account_id 的同步任务（首次登录后台同步等）：
/// 即使前端切换账号，也不会把 A 账号的同步结果写进 B 账号的界面。
#[tauri::command]
pub fn enqueue_account_background_task(
    store: State<'_, MailStore>,
    input: BackgroundTaskInput,
) -> MailResult<BackgroundTask> {
    let account_id = input.account_id.unwrap_or_default();
    if account_id <= 0 {
        return Err(MailError::Imap("首次同步必须绑定明确账号。".to_string()));
    }
    command_info(format!(
        "[better-email][task] enqueue account task start kind={} source={} account_id={account_id}",
        input.kind.trim(),
        input.source.trim(),
    ));
    match store.enqueue_background_task(input) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] enqueue account task ok task_id={} kind={} source={} status={} account_id={}",
                task.id, task.kind, task.source, task.status, task.account_id.unwrap_or_default(),
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] enqueue account task failed error={error}"
            ));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn retry_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<BackgroundTask> {
    match store.retry_background_task(task_id) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] retry task_id={} kind={} status={}",
                task.id, task.kind, task.status,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] retry failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<BackgroundTask> {
    match store.cancel_background_task(task_id) {
        Ok(task) => {
            command_info(format!(
                "[better-email][task] cancel task_id={} kind={} status={} cancel_requested={}",
                task.id, task.kind, task.status, task.cancel_requested,
            ));
            Ok(task)
        }
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][task] cancel failed task_id={task_id} error={error}"
            ));
            Err(error)
        }
    }
}

/// 安全检查点：执行方在任务边界确认取消请求；返回 true 表示应放弃本次结果。
#[tauri::command]
pub fn consume_background_task_cancel(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<bool> {
    store.consume_background_task_cancel(task_id)
}
