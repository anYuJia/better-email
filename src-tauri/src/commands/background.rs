use super::common::command_info;
use crate::db::{MailResult, MailStore};
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
            eprintln!("[better-email][task] enqueue failed error={error}");
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_background_tasks(store: State<'_, MailStore>) -> MailResult<Vec<BackgroundTask>> {
    store.list_background_tasks()
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
            eprintln!("[better-email][task] next failed error={error}");
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
            eprintln!("[better-email][task] running failed task_id={task_id} error={error}");
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
            eprintln!("[better-email][task] complete failed task_id={task_id} error={error}");
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
            eprintln!("[better-email][task] fail failed task_id={task_id} error={error}");
            Err(error)
        }
    }
}
