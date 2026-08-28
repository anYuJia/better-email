use super::common::benchmark_env;
use crate::{db::MailResult, StartupState};
use chrono::Utc;
use std::fs;
use std::path::Path;
use tauri::{State, WebviewWindow};
#[tauri::command]
pub fn mark_frontend_ready(
    window: WebviewWindow,
    message: String,
    startup: State<'_, StartupState>,
) -> MailResult<()> {
    startup
        .record_for_window(window.label(), "mark_frontend_ready")
        .map_err(crate::db::MailError::Imap)?;
    startup.log_timeline_async("mark_frontend_ready");

    let Some(path) = benchmark_env(
        "BETTER_EMAIL_BENCH_READY_FILE",
        "SWIFTMAIL_BENCH_READY_FILE",
    ) else {
        return Ok(());
    };
    if path.trim().is_empty() {
        return Ok(());
    }

    let ready_path = Path::new(&path);
    if let Some(parent) = ready_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::json!({
        "ready_at": Utc::now().to_rfc3339(),
        "message": message,
        "startupTimeline": startup.snapshot(),
    });
    let encoded = serde_json::to_vec_pretty(&payload)
        .map_err(|error| crate::db::MailError::Imap(format!("前端启动标记序列化失败：{error}")))?;
    fs::write(ready_path, encoded)?;
    Ok(())
}

/// Refresh the benchmark marker after the first list row has crossed a frame
/// boundary. MarkFrontendReady is intentionally issued as soon as the query
/// completes, while this follow-up keeps the persisted timeline complete
/// without coupling the native window reveal to benchmark I/O.
pub fn refresh_frontend_ready_snapshot(startup: &StartupState) -> MailResult<()> {
    let Some(path) = benchmark_env(
        "BETTER_EMAIL_BENCH_READY_FILE",
        "SWIFTMAIL_BENCH_READY_FILE",
    ) else {
        return Ok(());
    };
    if path.trim().is_empty() {
        return Ok(());
    }

    let ready_path = Path::new(&path);
    let Ok(contents) = fs::read_to_string(ready_path) else {
        return Ok(());
    };
    let Ok(mut payload) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return Ok(());
    };
    payload["startupTimeline"] = serde_json::to_value(startup.snapshot())
        .map_err(|error| crate::db::MailError::Imap(format!("启动时间线序列化失败：{error}")))?;
    payload["startupTimelineUpdatedAt"] = serde_json::Value::String(Utc::now().to_rfc3339());
    let encoded = serde_json::to_vec_pretty(&payload).map_err(|error| {
        crate::db::MailError::Imap(format!("启动时间线更新序列化失败：{error}"))
    })?;
    let temporary_path = ready_path.with_extension("json.tmp");
    fs::write(&temporary_path, encoded)?;
    fs::rename(temporary_path, ready_path)?;
    Ok(())
}

#[tauri::command]
pub fn mark_benchmark_sync_complete(message: String) -> MailResult<()> {
    let Some(path) = benchmark_env("BETTER_EMAIL_BENCH_SYNC_FILE", "SWIFTMAIL_BENCH_SYNC_FILE")
    else {
        return Ok(());
    };
    if path.trim().is_empty() {
        return Ok(());
    }

    let sync_path = Path::new(&path);
    if let Some(parent) = sync_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let payload = serde_json::json!({
        "completed_at": Utc::now().to_rfc3339(),
        "message": message,
    });
    let encoded = serde_json::to_vec_pretty(&payload)
        .map_err(|error| crate::db::MailError::Imap(format!("同步峰值标记序列化失败：{error}")))?;
    fs::write(sync_path, encoded)?;
    Ok(())
}

#[tauri::command]
pub fn benchmark_sync_requested() -> bool {
    benchmark_env("BETTER_EMAIL_BENCH_SYNC", "SWIFTMAIL_BENCH_SYNC")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}
