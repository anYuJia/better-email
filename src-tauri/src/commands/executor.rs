//! Keep synchronous storage/network work off Tauri's IPC and async workers.
//! Acquire permits before spawning so queued requests do not occupy OS threads.
use crate::db::{MailError, MailResult};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::Semaphore;

static DATABASE_WORKERS: Semaphore = Semaphore::const_new(4);
static NETWORK_WORKERS: Semaphore = Semaphore::const_new(4);
static DIALOG_WORKERS: Semaphore = Semaphore::const_new(2);
static ACCOUNT_WORKERS: Lazy<Mutex<HashMap<i64, Weak<Semaphore>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn task_error(error: impl std::fmt::Display) -> MailError {
    MailError::Io(std::io::Error::other(format!("后台任务失败：{error}")))
}

pub(super) async fn database<T: Send + 'static>(
    operation: impl FnOnce() -> MailResult<T> + Send + 'static,
) -> MailResult<T> {
    let generation = crate::db::restore_generation();
    let permit = DATABASE_WORKERS.acquire().await.map_err(task_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let _restore_guard = crate::db::protect_network_operation()?;
        crate::db::ensure_restore_generation(generation)?;
        operation()
    })
    .await
    .map_err(task_error)?
}

pub(super) async fn database_string<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    database(move || Ok(operation()))
        .await
        .map_err(|error| error.to_string())?
}

/// Blocking native file dialogs need their own budget: waiting for a human
/// must not consume the jobs used to open messages or query the mailbox.
pub(super) async fn dialog<T: Send + 'static>(
    operation: impl FnOnce() -> MailResult<T> + Send + 'static,
) -> MailResult<T> {
    let permit = DIALOG_WORKERS.acquire().await.map_err(task_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(task_error)?
}

fn account_workers(account_id: i64) -> Arc<Semaphore> {
    let mut accounts = ACCOUNT_WORKERS
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    accounts.retain(|_, workers| workers.strong_count() > 0);
    if let Some(workers) = accounts.get(&account_id).and_then(Weak::upgrade) {
        return workers;
    }
    // Two operations permit reading a body while a long mailbox sync runs,
    // while bounding connection pressure from rapid navigation.
    let workers = Arc::new(Semaphore::new(2));
    accounts.insert(account_id, Arc::downgrade(&workers));
    workers
}

pub(super) async fn network<T: Send + 'static>(
    account_id: i64,
    operation: impl FnOnce() -> MailResult<T> + Send + 'static,
) -> MailResult<T> {
    let generation = crate::db::restore_generation();
    let account = account_workers(account_id)
        .acquire_owned()
        .await
        .map_err(task_error)?;
    let global = NETWORK_WORKERS.acquire().await.map_err(task_error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (_account, _global) = (account, global);
        let _restore_guard = crate::db::protect_network_operation()?;
        crate::db::ensure_restore_generation(generation)?;
        operation()
    })
    .await
    .map_err(task_error)?
}

pub(super) async fn network_string<T: Send + 'static>(
    account_id: i64,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    network(account_id, move || Ok(operation()))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_limits_share_one_gate_and_release_capacity() {
        let first = account_workers(81001);
        let second = account_workers(81001);
        assert!(Arc::ptr_eq(&first, &second));
        let a = first.try_acquire().unwrap();
        let b = second.try_acquire().unwrap();
        assert!(first.try_acquire().is_err());
        assert!(account_workers(81002).try_acquire().is_ok());
        drop(a);
        assert!(second.try_acquire().is_ok());
        drop(b);
    }
}
