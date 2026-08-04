use super::common::benchmark_env;
use crate::db::MailResult;
use chrono::Utc;
use std::fs;
use std::path::Path;
#[tauri::command]
pub fn mark_frontend_ready(message: String) -> MailResult<()> {
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
    });
    let encoded = serde_json::to_vec_pretty(&payload)
        .map_err(|error| crate::db::MailError::Imap(format!("前端启动标记序列化失败：{error}")))?;
    fs::write(ready_path, encoded)?;
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
