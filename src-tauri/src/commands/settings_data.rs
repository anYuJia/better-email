use super::common::{mask_email, mask_recipient_list, read_backup_from_dialog};
use crate::db::{MailError, MailResult, MailStore};
use crate::models::{
    AppSettingsReport, CacheClearResult, DiagnosticAccount, DiagnosticExport,
    DiagnosticOAuthSession, DiagnosticOutboxItem, DownloadDirSetResult, LocalBackupSummary,
    MailStats, StorageUsage,
};
use chrono::Utc;
use std::fs;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
#[tauri::command]
pub fn get_stats(store: State<'_, MailStore>, account_id: Option<i64>) -> MailResult<MailStats> {
    store.get_stats_for_account(account_id)
}

#[tauri::command]
pub fn export_diagnostics(store: State<'_, MailStore>) -> MailResult<String> {
    let accounts = store
        .list_accounts()?
        .into_iter()
        .map(|account| DiagnosticAccount {
            id: account.id,
            email_masked: mask_email(&account.email),
            display_name: account.display_name,
            provider: account.provider,
            imap_host: account.imap_host,
            smtp_host: account.smtp_host,
            incoming_protocol: account.incoming_protocol,
            auth_type: account.auth_type,
            sync_mode: account.sync_mode,
            remote_images_allowed: account.remote_images_allowed,
            signature_enabled: !account.signature.trim().is_empty(),
        })
        .collect();
    let oauth_sessions = store
        .list_oauth_sessions()?
        .into_iter()
        .map(|session| DiagnosticOAuthSession {
            id: session.id,
            provider: session.provider,
            redirect_uri: session.redirect_uri,
            scopes: session.scopes,
            status: session.status,
            created_at: session.created_at,
            completed_at: session.completed_at,
            message: session.message,
        })
        .collect();
    let outbox = store
        .list_outbox()?
        .into_iter()
        .map(|item| DiagnosticOutboxItem {
            id: item.id,
            message_id: item.message_id,
            recipients_masked: mask_recipient_list(&item.recipients),
            subject_present: !item.subject.trim().is_empty(),
            status: item.status,
            attempts: item.attempts,
            last_error: item.last_error,
            queued_at: item.queued_at,
            next_attempt_at: item.next_attempt_at,
        })
        .collect();
    let export = DiagnosticExport {
        generated_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        accounts,
        unified_stats: store.get_stats_for_account(None)?,
        imap_mailboxes: store.list_imap_mailboxes()?,
        sync_runs: store.list_sync_runs()?,
        oauth_sessions,
        outbox,
    };

    serde_json::to_string_pretty(&export)
        .map_err(|error| crate::db::MailError::Imap(format!("诊断导出序列化失败：{error}")))
}

#[tauri::command]
pub async fn export_local_backup(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<LocalBackupSummary> {
    let backup = store.export_local_backup()?;
    let payload = serde_json::to_vec_pretty(&backup)
        .map_err(|error| crate::db::MailError::Imap(format!("本地备份序列化失败：{error}")))?;
    let target_path = app
        .dialog()
        .file()
        .set_title("导出 Better Email 本地备份")
        .set_file_name(format!(
            "better-email-backup-{}.json",
            Utc::now().format("%Y%m%d-%H%M%S")
        ))
        .blocking_save_file()
        .ok_or_else(|| crate::db::MailError::Imap("已取消本地备份导出。".to_string()))?
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析备份路径：{error}")))?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, &payload)?;
    Ok(MailStore::summarize_local_backup(
        &backup,
        target_path.to_string_lossy().into_owned(),
        payload.len().min(i64::MAX as usize) as i64,
    ))
}

#[tauri::command]
pub async fn preview_local_backup(app: AppHandle) -> MailResult<Option<LocalBackupSummary>> {
    let Some((backup, path, size_bytes)) = read_backup_from_dialog(app).await? else {
        return Ok(None);
    };
    Ok(Some(MailStore::summarize_local_backup(
        &backup, path, size_bytes,
    )))
}

#[tauri::command]
pub async fn import_local_backup(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<LocalBackupSummary>> {
    let Some((backup, path, size_bytes)) = read_backup_from_dialog(app).await? else {
        return Ok(None);
    };
    store.import_local_backup(&backup)?;
    Ok(Some(MailStore::summarize_local_backup(
        &backup, path, size_bytes,
    )))
}

#[tauri::command]
pub fn get_storage_usage(store: State<'_, MailStore>) -> MailResult<StorageUsage> {
    store.storage_usage()
}

#[tauri::command]
pub async fn clear_attachment_cache(store: State<'_, MailStore>) -> MailResult<CacheClearResult> {
    store.clear_reclaimable_attachment_cache()
}

#[tauri::command]
pub fn get_app_settings(store: State<'_, MailStore>) -> MailResult<AppSettingsReport> {
    app_settings_report(&store)
}

/// 弹出原生文件夹选择器，让用户设置「默认附件下载位置」。
/// 取消选择时不修改设置；选择不可写或危险位置时不保存并返回可操作错误。
#[cfg(desktop)]
#[tauri::command]
pub async fn set_download_dir(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<DownloadDirSetResult> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("选择默认附件下载位置的文件夹")
        .blocking_pick_folder()
    else {
        // 用户取消：保持原设置不变。
        return Ok(DownloadDirSetResult {
            settings: app_settings_report(&store)?,
            cancelled: true,
        });
    };
    let path = path
        .into_path()
        .map_err(|error| MailError::Imap(format!("无法解析所选文件夹路径：{error}")))?;
    let selected = path.to_string_lossy().into_owned();
    store.validate_and_save_download_dir(&selected)?;
    Ok(DownloadDirSetResult {
        settings: app_settings_report(&store)?,
        cancelled: false,
    })
}

#[cfg(not(desktop))]
#[tauri::command]
pub async fn set_download_dir(store: State<'_, MailStore>) -> MailResult<DownloadDirSetResult> {
    // Android/iOS 没有可用的文件夹选择器；保持命令可调用并报告未选择。
    Ok(DownloadDirSetResult {
        settings: app_settings_report(&store)?,
        cancelled: true,
    })
}

#[tauri::command]
pub fn reset_download_dir(store: State<'_, MailStore>) -> MailResult<AppSettingsReport> {
    store.reset_download_dir()?;
    app_settings_report(&store)
}

fn app_settings_report(store: &MailStore) -> MailResult<AppSettingsReport> {
    let settings = store.load_app_settings()?;
    let effective = store.resolve_download_dir()?;
    let using_default = settings.default_download_dir.trim().is_empty();
    Ok(AppSettingsReport {
        configured_dir: settings.default_download_dir,
        effective_dir: effective.to_string_lossy().into_owned(),
        using_default,
    })
}
