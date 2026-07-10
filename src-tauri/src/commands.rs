use crate::credentials;
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, Attachment, AttachmentDownload,
    BackgroundTask, BackgroundTaskInput, ConnectionReport, Contact, ContactCreateInput,
    ContactInput, ContactMergeSuggestion, CredentialInput, CredentialStatus, DiagnosticAccount,
    DiagnosticExport, DiagnosticOAuthSession, DiagnosticOutboxItem, DraftInput, Folder,
    FolderReadReport, ImapMailboxState, ImapProbeReport, Label, LocalBackup, LocalBackupSummary,
    MailIdentity, MailIdentityInput, MailRule, MailRuleInput, MailStats, Message,
    OAuthCallbackInput, OAuthCallbackReport, OAuthLocalCallbackInput, OAuthRefreshInput,
    OAuthRefreshReport, OAuthSession, OAuthStartInput, OAuthStartReport, OAuthTokenExchangeInput,
    OAuthTokenExchangeReport, OutboundAttachmentInput, OutboxItem, ParsedMessagePreview,
    RawMessageInput, RemoteActionReport, RemoteImageTrust, RemoteImageTrustInput, SyncRun,
    SyncSchedulePlan, ThreadSummary,
};
use crate::oauth;
use crate::protocol;
use crate::smtp;
use chrono::Utc;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const MAX_ATTACHMENT_DOWNLOAD_BYTES: i64 = 25 * 1024 * 1024;
const MAX_EML_IMPORT_BYTES: usize = 25 * 1024 * 1024;
const MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH: usize = 2;

fn benchmark_env(primary: &str, legacy: &str) -> Option<String> {
    std::env::var(primary)
        .ok()
        .or_else(|| std::env::var(legacy).ok())
}

#[tauri::command]
pub fn list_accounts(store: State<'_, MailStore>) -> MailResult<Vec<Account>> {
    store.list_accounts()
}

#[tauri::command]
pub fn get_account(store: State<'_, MailStore>, account_id: Option<i64>) -> MailResult<Account> {
    store.get_account_by_id(account_id)
}

#[tauri::command]
pub fn create_account(
    store: State<'_, MailStore>,
    input: AccountCreateInput,
) -> MailResult<Account> {
    store.create_account(input)
}

#[tauri::command]
pub fn set_default_account(store: State<'_, MailStore>, account_id: i64) -> MailResult<Account> {
    store.set_default_account(account_id)
}

#[tauri::command]
pub fn delete_account(store: State<'_, MailStore>, account_id: i64) -> MailResult<Account> {
    store.delete_account(account_id)
}

#[tauri::command]
pub fn update_account_settings(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    input: AccountSettingsInput,
) -> MailResult<Account> {
    store.update_account_settings_for(account_id, input)
}

#[tauri::command]
pub fn list_folders(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<Folder>> {
    store.list_folders_for_account(account_id)
}

#[tauri::command]
pub fn create_custom_folder(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    name: String,
) -> MailResult<Folder> {
    store.create_custom_folder(account_id, name)
}

#[tauri::command]
pub fn rename_custom_folder(
    store: State<'_, MailStore>,
    folder_id: i64,
    name: String,
) -> MailResult<Folder> {
    store.rename_custom_folder(folder_id, name)
}

#[tauri::command]
pub fn delete_custom_folder(store: State<'_, MailStore>, folder_id: i64) -> MailResult<()> {
    store.delete_custom_folder(folder_id)
}

#[tauri::command]
pub fn list_labels(store: State<'_, MailStore>) -> MailResult<Vec<Label>> {
    store.list_labels()
}

#[tauri::command]
pub fn list_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: i64,
    query: Option<String>,
    filter: Option<String>,
    limit: i64,
) -> MailResult<Vec<Message>> {
    store.list_messages_for_scope(account_id, folder_id, query, filter, limit)
}

#[tauri::command]
pub fn list_thread_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    thread_key: String,
    limit: i64,
) -> MailResult<Vec<Message>> {
    store.list_thread_messages(account_id, thread_key, limit)
}

#[tauri::command]
pub fn list_attachments(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Vec<Attachment>> {
    store.list_attachments(message_id)
}

#[tauri::command]
pub fn pick_outbound_attachments(app: AppHandle) -> MailResult<Vec<OutboundAttachmentInput>> {
    let Some(paths) = app
        .dialog()
        .file()
        .set_title("选择附件")
        .blocking_pick_files()
    else {
        return Ok(Vec::new());
    };

    paths
        .into_iter()
        .map(|path| {
            let path = path.into_path().map_err(|error| {
                crate::db::MailError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("无法解析附件路径：{error}"),
                ))
            })?;
            let metadata = fs::metadata(&path)?;
            let filename = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| "attachment".to_string());
            Ok(OutboundAttachmentInput {
                filename,
                mime_type: mime_type_for_path(&path),
                size_bytes: metadata.len().min(i64::MAX as u64) as i64,
                local_path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

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

#[tauri::command]
pub fn list_remote_image_trusts(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<RemoteImageTrust>> {
    store.list_remote_image_trusts(account_id)
}

#[tauri::command]
pub fn trust_remote_images(
    store: State<'_, MailStore>,
    input: RemoteImageTrustInput,
) -> MailResult<RemoteImageTrust> {
    store.upsert_remote_image_trust(input)
}

#[tauri::command]
pub fn delete_remote_image_trust(store: State<'_, MailStore>, trust_id: i64) -> MailResult<()> {
    store.delete_remote_image_trust(trust_id)
}

#[tauri::command]
pub fn render_message_with_remote_image_policy(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    store.message_with_remote_image_policy(message_id)
}

#[tauri::command]
pub fn download_attachment(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<AttachmentDownload> {
    let attachment = store.get_attachment(attachment_id)?;
    let account = store.get_message_account(attachment.message_id)?;
    let secret = credentials::get_account_secret(&account).map_err(crate::db::MailError::Imap)?;
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(attachment.message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Err(crate::db::MailError::Imap(
            "该附件所属邮件没有远端 UID，无法下载附件文件。".to_string(),
        ));
    }
    validate_attachment_download_size(attachment.size_bytes)?;

    let dir = store.attachment_dir(attachment.message_id);
    fs::create_dir_all(&dir)?;
    let temp_path = dir.join(format!("{}.download", attachment.id));
    let mut output = fs::File::create(&temp_path)?;
    let download_result = imap_probe::download_attachment_to_writer(
        &account,
        &secret,
        &remote_mailbox,
        remote_uid,
        &attachment.filename,
        MAX_ATTACHMENT_DOWNLOAD_BYTES,
        &mut output,
    );
    drop(output);
    let downloaded = match download_result {
        Ok(downloaded) => downloaded,
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            return Err(error);
        }
    };
    if let Err(error) = validate_attachment_download_size(downloaded.size_bytes) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    let filename = sanitize_filename(if downloaded.filename.trim().is_empty() {
        &attachment.filename
    } else {
        &downloaded.filename
    });
    let local_path = dir.join(format!("{}-{filename}", attachment.id));
    if local_path.exists() {
        fs::remove_file(&local_path)?;
    }
    fs::rename(&temp_path, &local_path)?;
    let local_path_string = local_path.to_string_lossy().into_owned();
    let updated = store.mark_attachment_downloaded(
        attachment.id,
        &local_path_string,
        downloaded.size_bytes,
    )?;

    Ok(AttachmentDownload {
        attachment: updated,
        local_path: local_path_string.clone(),
        message: format!("附件已下载到 {local_path_string}"),
    })
}

#[allow(deprecated)]
#[tauri::command]
pub fn open_attachment(
    app: AppHandle,
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Imap(
            "附件尚未下载，请先下载后再打开。".to_string(),
        ));
    }
    let path = std::path::PathBuf::from(&attachment.local_path);
    if !path.exists() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "已下载附件文件不存在，请重新下载。",
        )));
    }
    app.shell()
        .open(path.to_string_lossy().into_owned(), None)
        .map_err(|error| crate::db::MailError::Imap(format!("无法打开附件：{error}")))?;
    Ok(format!("已打开附件：{}", attachment.filename))
}

#[tauri::command]
pub fn save_attachment_as(
    app: AppHandle,
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Imap(
            "附件尚未下载，请先下载后再另存为。".to_string(),
        ));
    }

    let source_path = std::path::PathBuf::from(&attachment.local_path);
    if !source_path.exists() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "已下载附件文件不存在，请重新下载。",
        )));
    }

    let target_path = app
        .dialog()
        .file()
        .set_title("另存附件")
        .set_file_name(sanitize_filename(&attachment.filename))
        .blocking_save_file()
        .ok_or_else(|| crate::db::MailError::Imap("已取消附件另存为。".to_string()))?
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析另存为路径：{error}")))?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source_path, &target_path)?;
    let target = target_path.to_string_lossy().into_owned();
    Ok(format!("附件已另存为 {target}"))
}

#[tauri::command]
pub fn export_message_as_eml(
    app: AppHandle,
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<String> {
    let message = store.get_message(message_id)?;
    let attachments = store.list_attachments(message_id)?;
    let payload = render_eml_message(&message, &attachments);
    let filename = sanitize_filename(&format!(
        "{}.eml",
        if message.subject.trim().is_empty() {
            "better-email-message"
        } else {
            message.subject.trim()
        }
    ));
    let target_path = app
        .dialog()
        .file()
        .set_title("导出邮件为 EML")
        .set_file_name(filename)
        .blocking_save_file()
        .ok_or_else(|| crate::db::MailError::Imap("已取消邮件导出。".to_string()))?
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析邮件导出路径：{error}")))?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, payload)?;
    Ok(format!("邮件已导出为 {}", target_path.to_string_lossy()))
}

#[tauri::command]
pub fn import_eml_file(
    app: AppHandle,
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Option<Message>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("导入 EML 邮件")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析 EML 路径：{error}")))?;
    let payload = fs::read(&path)?;
    if payload.is_empty() {
        return Err(crate::db::MailError::Imap(
            "EML 文件为空，无法导入。".to_string(),
        ));
    }
    if payload.len() > MAX_EML_IMPORT_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "EML 文件超过 {} MB 导入上限。",
            MAX_EML_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let raw = String::from_utf8_lossy(&payload);
    store.import_eml_message(account_id, &raw).map(Some)
}

fn render_eml_message(message: &Message, attachments: &[Attachment]) -> String {
    let subject = if message.subject.trim().is_empty() {
        "(无主题)"
    } else {
        message.subject.trim()
    };
    let body = if message.body.trim().is_empty() {
        message.snippet.as_str()
    } else {
        message.body.as_str()
    };
    let attachment_note = if attachments.is_empty() {
        String::new()
    } else {
        format!(
            "\r\n\r\n-- Better Email attachment metadata --\r\n{}",
            attachments
                .iter()
                .map(|attachment| format!(
                    "{}; {}; {} bytes; {}",
                    attachment.filename,
                    attachment.mime_type,
                    attachment.size_bytes,
                    if attachment.is_downloaded {
                        attachment.local_path.as_str()
                    } else {
                        "not downloaded"
                    }
                ))
                .collect::<Vec<_>>()
                .join("\r\n")
        )
    };
    format!(
        "From: {} <{}>\r\nTo: {}\r\n{}{}Subject: {}\r\nDate: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\nX-Better Email-Account: {}\r\n\r\n{}{}",
        message.sender_name.trim(),
        message.sender_email.trim(),
        message.recipients.trim(),
        optional_header("Cc", &message.cc),
        optional_header("Bcc", &message.bcc),
        subject,
        message.received_at.trim(),
        message.account_email.trim(),
        body.replace('\n', "\r\n"),
        attachment_note
    )
}

fn optional_header(name: &str, value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        format!("{name}: {}\r\n", value.trim())
    }
}

#[tauri::command]
pub fn set_message_read(
    store: State<'_, MailStore>,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    store.set_message_read(message_id, is_read)?;
    sync_remote_seen(&store, message_id, is_read)
}

#[tauri::command]
pub fn mark_folder_read(
    store: State<'_, MailStore>,
    folder_id: i64,
    role: String,
    is_virtual: bool,
) -> MailResult<FolderReadReport> {
    let unread_messages = store.mark_folder_read(folder_id, &role, is_virtual)?;
    let updated_count = unread_messages.len() as i64;
    if unread_messages.is_empty() {
        return Ok(FolderReadReport {
            updated_count: 0,
            remote_attempted_count: 0,
            remote_applied_count: 0,
            remote_skipped_count: 0,
            remote_failed_count: 0,
            message: "该文件夹没有未读邮件。".to_string(),
        });
    }

    let mut groups = BTreeMap::<(i64, String), Vec<i64>>::new();
    let mut remote_skipped_count = 0_i64;
    for reference in unread_messages {
        if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
            remote_skipped_count += 1;
            continue;
        }
        groups
            .entry((reference.account_id, reference.remote_mailbox))
            .or_default()
            .push(reference.remote_uid);
    }

    let mut remote_attempted_count = 0_i64;
    let mut remote_applied_count = 0_i64;
    let mut remote_failed_count = 0_i64;
    for ((account_id, remote_mailbox), remote_uids) in groups {
        let account = match store.get_account_by_id(Some(account_id)) {
            Ok(account) => account,
            Err(_) => {
                remote_skipped_count += remote_uids.len() as i64;
                continue;
            }
        };
        let secret = match credentials::get_account_secret(&account) {
            Ok(secret) => secret,
            Err(_) => {
                remote_skipped_count += remote_uids.len() as i64;
                continue;
            }
        };
        let group_count = remote_uids.len() as i64;
        remote_attempted_count += group_count;
        match imap_probe::set_remote_seen_batch(
            &account,
            &secret,
            &remote_mailbox,
            &remote_uids,
            true,
        ) {
            Ok(()) => remote_applied_count += group_count,
            Err(_) => remote_failed_count += group_count,
        }
    }

    let message = if remote_failed_count > 0 {
        format!(
            "已将 {updated_count} 封邮件标为已读；远端同步成功 {remote_applied_count} 封，失败 {remote_failed_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else if remote_attempted_count > 0 {
        format!(
            "已将 {updated_count} 封邮件标为已读；远端同步成功 {remote_applied_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else {
        format!(
            "已将 {updated_count} 封邮件标为已读；{remote_skipped_count} 封没有可用远端状态，已保留本地结果。"
        )
    };

    Ok(FolderReadReport {
        updated_count,
        remote_attempted_count,
        remote_applied_count,
        remote_skipped_count,
        remote_failed_count,
        message,
    })
}

#[tauri::command]
pub fn set_message_starred(
    store: State<'_, MailStore>,
    message_id: i64,
    is_starred: bool,
) -> MailResult<()> {
    store.set_message_starred(message_id, is_starred)
}

#[tauri::command]
pub fn move_message_to_role(
    store: State<'_, MailStore>,
    message_id: i64,
    role: String,
) -> MailResult<RemoteActionReport> {
    store.move_message_to_role(message_id, &role)?;
    sync_remote_move(&store, message_id, &role)
}

#[tauri::command]
pub fn restore_message_to_inbox(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    store.restore_message_to_inbox(message_id)
}

#[tauri::command]
pub fn delete_message_permanently(store: State<'_, MailStore>, message_id: i64) -> MailResult<()> {
    store.delete_message_permanently(message_id)
}

#[tauri::command]
pub fn empty_trash(store: State<'_, MailStore>, account_id: Option<i64>) -> MailResult<i64> {
    store.empty_trash_for_account(account_id)
}

#[tauri::command]
pub fn snooze_message(
    store: State<'_, MailStore>,
    message_id: i64,
    snoozed_until: String,
) -> MailResult<Message> {
    store.snooze_message(message_id, &snoozed_until)
}

#[tauri::command]
pub fn unsnooze_message(store: State<'_, MailStore>, message_id: i64) -> MailResult<Message> {
    store.unsnooze_message(message_id)
}

#[tauri::command]
pub fn release_due_snoozed_messages(
    store: State<'_, MailStore>,
    now: String,
) -> MailResult<Vec<Message>> {
    store.release_due_snoozed_messages(&now)
}

#[tauri::command]
pub fn apply_label_to_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    store.apply_label_to_message(message_id, label_id)
}

#[tauri::command]
pub fn remove_label_from_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    store.remove_label_from_message(message_id, label_id)
}

#[tauri::command]
pub fn list_identities(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<MailIdentity>> {
    store.list_identities_for_account(account_id)
}

#[tauri::command]
pub fn upsert_identity(
    store: State<'_, MailStore>,
    input: MailIdentityInput,
) -> MailResult<MailIdentity> {
    store.upsert_identity(input)
}

#[tauri::command]
pub fn delete_identity(store: State<'_, MailStore>, identity_id: i64) -> MailResult<()> {
    store.delete_identity(identity_id)
}

#[tauri::command]
pub fn save_draft(store: State<'_, MailStore>, input: DraftInput) -> MailResult<i64> {
    store.save_draft(input)
}

#[tauri::command]
pub fn send_message(store: State<'_, MailStore>, input: DraftInput) -> MailResult<i64> {
    store.send_message(input)
}

#[tauri::command]
pub fn queue_outbox_message(
    store: State<'_, MailStore>,
    input: DraftInput,
) -> MailResult<OutboxItem> {
    store.queue_outbox_message(input)
}

#[tauri::command]
pub fn cancel_outbox_item(store: State<'_, MailStore>, outbox_id: i64) -> MailResult<OutboxItem> {
    store.cancel_outbox_item(outbox_id)
}

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
pub fn export_local_backup(
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
pub fn preview_local_backup(app: AppHandle) -> MailResult<Option<LocalBackupSummary>> {
    let Some((backup, path, size_bytes)) = read_backup_from_dialog(app)? else {
        return Ok(None);
    };
    Ok(Some(MailStore::summarize_local_backup(
        &backup, path, size_bytes,
    )))
}

#[tauri::command]
pub fn import_local_backup(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<LocalBackupSummary>> {
    let Some((backup, path, size_bytes)) = read_backup_from_dialog(app)? else {
        return Ok(None);
    };
    store.import_local_backup(&backup)?;
    Ok(Some(MailStore::summarize_local_backup(
        &backup, path, size_bytes,
    )))
}

#[tauri::command]
pub fn test_connection(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ConnectionReport> {
    let account = store.get_account_by_id(account_id)?;
    protocol::test_endpoints(&account.email, &account.imap_host, &account.smtp_host)
}

#[tauri::command]
pub fn discover_imap_folders(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ImapProbeReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(imap_probe::failed_report(&account.email, error)),
    };

    match imap_probe::discover_folders(&account, &secret) {
        Ok(report) => {
            if report.status == "ok" {
                store.save_imap_mailboxes_for_account(Some(account.id), &report.folders)?;
            }
            Ok(report)
        }
        Err(error) => Ok(imap_probe::failed_report(&account.email, error.to_string())),
    }
}

#[tauri::command]
pub fn list_imap_mailboxes(store: State<'_, MailStore>) -> MailResult<Vec<ImapMailboxState>> {
    store.list_imap_mailboxes()
}

#[tauri::command]
pub fn run_sync_dry_run(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    store.run_sync_dry_run(account_id)
}

#[tauri::command]
pub fn get_sync_schedule_plan(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncSchedulePlan> {
    store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)
}

#[tauri::command]
pub fn sync_imap_headers(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let plan = store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)?;
    let accounts = plan.batch_accounts.clone();
    if account_id.is_some() {
        let account = accounts
            .first()
            .ok_or_else(|| crate::db::MailError::Imap("没有可同步账号。".to_string()))?;
        return sync_imap_headers_for_account(&store, account);
    }

    let started_at = Utc::now().to_rfc3339();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut synced_accounts = 0;
    let mut failures = Vec::new();

    for account in accounts {
        match sync_imap_headers_for_account(&store, &account) {
            Ok(run) => {
                scanned_folders += run.scanned_folders;
                imported_messages += run.imported_messages;
                synced_accounts += 1;
            }
            Err(error) => failures.push(format!("{}: {error}", account.email)),
        }
    }

    let finished_at = Utc::now().to_rfc3339();
    let delayed_count = plan.delayed_accounts.len();
    let status = if failures.is_empty() {
        if delayed_count > 0 {
            "imap_headers_limited"
        } else {
            "imap_headers_multi"
        }
    } else if synced_accounts > 0 {
        "imap_headers_partial"
    } else {
        "imap_headers_failed"
    };
    let message = if failures.is_empty() {
        if delayed_count > 0 {
            format!(
                "统一邮箱限流同步完成：本轮 {} / {} 个账号，扫描 {} 个文件夹，新增 {} 封；{} 个账号留到下一轮。",
                synced_accounts,
                plan.total_accounts,
                scanned_folders,
                imported_messages,
                delayed_count
            )
        } else {
            format!(
                "统一邮箱同步完成：{} 个账号，扫描 {} 个文件夹，新增 {} 封。",
                synced_accounts, scanned_folders, imported_messages
            )
        }
    } else if synced_accounts > 0 {
        format!(
            "统一邮箱同步部分完成：{} 个账号成功，{} 个账号失败，{} 个账号延后，扫描 {} 个文件夹，新增 {} 封。{}",
            synced_accounts,
            failures.len(),
            delayed_count,
            scanned_folders,
            imported_messages,
            failures.join("；")
        )
    } else {
        format!(
            "统一邮箱同步失败：{} 个账号失败。{}",
            failures.len(),
            failures.join("；")
        )
    };

    store.record_sync_run(
        &started_at,
        &finished_at,
        status,
        scanned_folders,
        imported_messages,
        &message,
    )
}

fn sync_imap_headers_for_account(store: &MailStore, account: &Account) -> MailResult<SyncRun> {
    let secret = credentials::get_account_secret(account).map_err(crate::db::MailError::Imap)?;
    let mailbox = match store.next_mailbox_for_header_sync(Some(account.id))? {
        Some(mailbox) => mailbox,
        None => {
            let report = imap_probe::discover_folders(account, &secret)?;
            store.save_imap_mailboxes_for_account(Some(account.id), &report.folders)?;
            store
                .next_mailbox_for_header_sync(Some(account.id))?
                .ok_or_else(|| {
                    crate::db::MailError::Imap("IMAP 未发现可同步文件夹。".to_string())
                })?
        }
    };
    let batch = imap_probe::fetch_recent_headers(
        account,
        &secret,
        &mailbox.remote_name,
        mailbox.highest_uid,
    )?;
    store.import_imap_headers(mailbox.id, &batch)
}

#[tauri::command]
pub fn fetch_message_body(store: State<'_, MailStore>, message_id: i64) -> MailResult<Message> {
    let account = store.get_message_account(message_id)?;
    let secret = credentials::get_account_secret(&account).map_err(crate::db::MailError::Imap)?;
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Err(crate::db::MailError::Imap(
            "该邮件没有远端 UID，无法按需拉取正文。".to_string(),
        ));
    }
    let body = imap_probe::fetch_message_body(&account, &secret, &remote_mailbox, remote_uid)?;
    store.update_message_body(message_id, &body)
}

#[tauri::command]
pub fn list_sync_runs(store: State<'_, MailStore>) -> MailResult<Vec<SyncRun>> {
    store.list_sync_runs()
}

#[tauri::command]
pub fn parse_raw_message(input: RawMessageInput) -> ParsedMessagePreview {
    protocol::parse_message_preview(&input.raw)
}

#[tauri::command]
pub fn store_account_secret(input: CredentialInput) -> CredentialStatus {
    credentials::store_secret(&input.account_email, &input.secret)
}

#[tauri::command]
pub fn check_account_secret(account_email: String) -> CredentialStatus {
    credentials::check_secret(&account_email)
}

#[tauri::command]
pub fn delete_account_secret(account_email: String) -> CredentialStatus {
    credentials::delete_secret(&account_email)
}

#[tauri::command]
#[allow(deprecated)]
pub fn start_oauth2_pkce(
    app: AppHandle,
    store: State<'_, MailStore>,
    input: OAuthStartInput,
) -> MailResult<OAuthStartReport> {
    let draft = oauth::start_pkce_authorization(input).map_err(crate::db::MailError::Imap)?;
    let report = store.save_oauth_session(draft.report, &draft.code_verifier)?;
    app.shell()
        .open(report.authorization_url.clone(), None)
        .map_err(|error| crate::db::MailError::Imap(format!("无法打开 OAuth2 授权页：{error}")))?;
    Ok(report)
}

#[tauri::command]
pub fn list_oauth_sessions(store: State<'_, MailStore>) -> MailResult<Vec<OAuthSession>> {
    store.list_oauth_sessions()
}

#[tauri::command]
pub fn complete_oauth2_callback(
    store: State<'_, MailStore>,
    input: OAuthCallbackInput,
) -> MailResult<OAuthCallbackReport> {
    store.complete_oauth_callback(&input.state, &input.code)
}

#[tauri::command]
pub fn wait_for_oauth2_callback(
    store: State<'_, MailStore>,
    input: OAuthLocalCallbackInput,
) -> MailResult<OAuthCallbackReport> {
    let payload = oauth::wait_for_local_callback(&input.redirect_uri, input.timeout_seconds)
        .map_err(crate::db::MailError::Imap)?;
    store.complete_oauth_callback(&payload.state, &payload.code)
}

#[tauri::command]
pub fn exchange_oauth2_token(
    store: State<'_, MailStore>,
    input: OAuthTokenExchangeInput,
) -> MailResult<OAuthTokenExchangeReport> {
    let session = store.oauth_session_for_token_exchange(input.session_id)?;
    match oauth::exchange_token(&session, &input.client_id, &input.client_secret) {
        Ok(bundle) => {
            let expires_at = bundle.expires_at.clone();
            let secret = serde_json::to_string(&bundle).map_err(|error| {
                crate::db::MailError::Imap(format!("OAuth2 token 序列化失败：{error}"))
            })?;
            let status = credentials::store_secret(&session.account_email, &secret);
            if !status.exists {
                let report = store.mark_oauth_token_exchange_failed(session.id, &status.message)?;
                return Err(crate::db::MailError::Imap(report.message));
            }
            store.mark_oauth_token_stored(session.id, &expires_at)
        }
        Err(error) => {
            let report = store.mark_oauth_token_exchange_failed(session.id, &error)?;
            Err(crate::db::MailError::Imap(report.message))
        }
    }
}

#[tauri::command]
pub fn refresh_oauth2_token(
    store: State<'_, MailStore>,
    input: OAuthRefreshInput,
) -> MailResult<OAuthRefreshReport> {
    let account = store.get_account()?;
    let raw = credentials::get_secret(&account.email).map_err(crate::db::MailError::Imap)?;
    let secret = credentials::account_secret_from_raw(&account.auth_type, &raw)
        .map_err(crate::db::MailError::Imap)?;
    let bundle = match secret {
        credentials::AccountSecret::OAuth2(bundle) => bundle,
        credentials::AccountSecret::Password(_) => {
            return Err(crate::db::MailError::Imap(
                "当前账号不是 OAuth2 模式，无法刷新 token。".to_string(),
            ));
        }
    };
    let refreshed = oauth::refresh_token(&bundle, &input.client_id, &input.client_secret)
        .map_err(crate::db::MailError::Imap)?;
    let secret = serde_json::to_string(&refreshed)
        .map_err(|error| crate::db::MailError::Imap(format!("OAuth2 token 序列化失败：{error}")))?;
    let status = credentials::store_secret(&account.email, &secret);
    if !status.exists {
        return Err(crate::db::MailError::Imap(status.message));
    }
    Ok(OAuthRefreshReport {
        provider: refreshed.provider,
        status: "token_refreshed".to_string(),
        expires_at: refreshed.expires_at,
        message: "OAuth2 token 已刷新并保存到系统 Keychain。".to_string(),
    })
}

fn sync_remote_seen(
    store: &MailStore,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Ok(local_only_report(
            "本地已更新；该邮件没有远端 UID，跳过远端已读回写。",
        ));
    }
    let account = store.get_message_account(message_id)?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已更新；无法读取系统凭据，远端已读回写已跳过：{error}"
            )));
        }
    };
    match imap_probe::set_remote_seen(&account, &secret, &remote_mailbox, remote_uid, is_read) {
        Ok(()) => Ok(remote_ok_report(if is_read {
            "本地已标为已读，远端 \\Seen 状态已同步。"
        } else {
            "本地已标为未读，远端 \\Seen 状态已同步。"
        })),
        Err(error) => Ok(remote_failed_report(format!(
            "本地已更新；远端已读状态回写失败：{error}"
        ))),
    }
}

fn sync_remote_move(
    store: &MailStore,
    message_id: i64,
    role: &str,
) -> MailResult<RemoteActionReport> {
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Ok(local_only_report(
            "本地已移动；该邮件没有远端 UID，跳过远端移动。",
        ));
    }
    let account = store.get_message_account(message_id)?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已移动；无法读取系统凭据，远端移动已跳过：{error}"
            )));
        }
    };
    let target = store.remote_mailbox_for_account_role(account.id, role)?;
    match target {
        Some(target_mailbox) => match imap_probe::move_remote_message(
            &account,
            &secret,
            &remote_mailbox,
            remote_uid,
            &target_mailbox,
        ) {
            Ok(()) => Ok(remote_ok_report(format!(
                "本地已移动；远端邮件已移动到 {target_mailbox}。"
            ))),
            Err(error) => Ok(remote_failed_report(format!(
                "本地已移动；远端移动失败：{error}"
            ))),
        },
        None if role == "trash" => {
            match imap_probe::delete_remote_message(&account, &secret, &remote_mailbox, remote_uid)
            {
                Ok(()) => Ok(remote_ok_report(
                    "本地已移到废纸篓；远端邮件已标记删除并 expunge。",
                )),
                Err(error) => Ok(remote_failed_report(format!(
                    "本地已移到废纸篓；远端删除失败：{error}"
                ))),
            }
        }
        None => Ok(remote_skipped_report(format!(
            "本地已移动；未发现角色 {role} 对应的远端文件夹，远端移动已跳过。"
        ))),
    }
}

fn local_only_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: message.into(),
    }
}

fn remote_skipped_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: message.into(),
    }
}

fn remote_ok_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: true,
        remote_applied: true,
        message: message.into(),
    }
}

fn remote_failed_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: true,
        remote_applied: false,
        message: message.into(),
    }
}

fn validate_attachment_download_size(size_bytes: i64) -> MailResult<()> {
    if size_bytes > MAX_ATTACHMENT_DOWNLOAD_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "附件大小超过当前安全下载上限（{} MB），已阻止一次性拉取以避免占用过多内存。后续分段下载版本会支持更大的附件。",
            MAX_ATTACHMENT_DOWNLOAD_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}

fn mask_recipient_list(value: &str) -> String {
    value
        .split([',', ';', '，', '；'])
        .map(mask_email)
        .filter(|email| !email.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn mask_email(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }
    let email = trimmed
        .split_once('<')
        .and_then(|(_, rest)| rest.split('>').next())
        .unwrap_or(trimmed)
        .trim();
    let Some((local, domain)) = email.split_once('@') else {
        return "***".to_string();
    };
    let first = local.chars().next().unwrap_or('*');
    format!("{first}***@{}", domain.trim())
}

fn sanitize_filename(filename: &str) -> String {
    let sanitized = filename
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect::<String>()
        .trim()
        .trim_start_matches('.')
        .to_string();
    if sanitized.is_empty() || sanitized.chars().all(|ch| ch == '_' || ch == '.') {
        "attachment".to_string()
    } else {
        sanitized
    }
}

fn mime_type_for_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "txt" | "log" | "md" => "text/plain",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "zip" => "application/zip",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        _ => "application/octet-stream",
    }
    .to_string()
}

fn read_backup_from_dialog(app: AppHandle) -> MailResult<Option<(LocalBackup, String, i64)>> {
    let Some(path) = app
        .dialog()
        .file()
        .set_title("选择 Better Email 本地备份")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析备份路径：{error}")))?;
    read_local_backup_file(path).map(Some)
}

fn read_local_backup_file(path: PathBuf) -> MailResult<(LocalBackup, String, i64)> {
    let payload = fs::read(&path)?;
    let backup = serde_json::from_slice::<LocalBackup>(&payload)
        .map_err(|error| crate::db::MailError::Imap(format!("备份 JSON 解析失败：{error}")))?;
    Ok((
        backup,
        path.to_string_lossy().into_owned(),
        payload.len().min(i64::MAX as usize) as i64,
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        mask_email, mask_recipient_list, render_eml_message, sanitize_filename,
        validate_attachment_download_size, MAX_ATTACHMENT_DOWNLOAD_BYTES,
    };
    use crate::models::{Attachment, Message};

    #[test]
    fn filename_sanitizer_removes_path_and_control_chars() {
        assert_eq!(sanitize_filename("../invoice?.pdf"), "_invoice_.pdf");
        assert_eq!(sanitize_filename("\u{0000}"), "attachment");
    }

    #[test]
    fn renders_plain_eml_with_attachment_metadata() {
        let message = Message {
            id: 1,
            account_id: 1,
            account_email: "me@example.com".to_string(),
            folder_id: 1,
            folder_role: "inbox".to_string(),
            sender_name: "Ada".to_string(),
            sender_email: "ada@example.com".to_string(),
            recipients: "me@example.com".to_string(),
            cc: "team@example.com".to_string(),
            bcc: String::new(),
            subject: "Export".to_string(),
            snippet: "Snippet".to_string(),
            body: "Hello\nworld".to_string(),
            sanitized_html: String::new(),
            security_warnings: Vec::new(),
            received_at: "2026-07-09T10:00:00+08:00".to_string(),
            is_read: true,
            is_starred: false,
            has_attachments: true,
            snoozed_until: String::new(),
            labels: Vec::new(),
            attachment_count: 1,
            remote_mailbox: "INBOX".to_string(),
            remote_uid: 1,
        };
        let eml = render_eml_message(
            &message,
            &[Attachment {
                id: 1,
                message_id: 1,
                filename: "brief.txt".to_string(),
                mime_type: "text/plain".to_string(),
                size_bytes: 12,
                is_downloaded: false,
                local_path: String::new(),
            }],
        );

        assert!(eml.contains("From: Ada <ada@example.com>"));
        assert!(eml.contains("Cc: team@example.com"));
        assert!(eml.contains("Hello\r\nworld"));
        assert!(eml.contains("brief.txt; text/plain; 12 bytes; not downloaded"));
    }

    #[test]
    fn attachment_download_size_guard_rejects_large_payloads() {
        assert!(validate_attachment_download_size(MAX_ATTACHMENT_DOWNLOAD_BYTES).is_ok());

        let error = validate_attachment_download_size(MAX_ATTACHMENT_DOWNLOAD_BYTES + 1)
            .expect_err("oversized attachment should be rejected");
        assert!(error.to_string().contains("安全下载上限"));
    }

    #[test]
    fn diagnostic_email_masking_removes_local_parts() {
        assert_eq!(mask_email("Ada <ada@example.com>"), "a***@example.com");
        assert_eq!(
            mask_recipient_list("ada@example.com; bob@example.org"),
            "a***@example.com, b***@example.org"
        );
        assert_eq!(mask_email("not-an-email"), "***");
    }
}

#[tauri::command]
pub fn list_contacts(store: State<'_, MailStore>) -> MailResult<Vec<Contact>> {
    store.list_contacts()
}

#[tauri::command]
pub fn list_contact_merge_suggestions(
    store: State<'_, MailStore>,
) -> MailResult<Vec<ContactMergeSuggestion>> {
    store.list_contact_merge_suggestions()
}

#[tauri::command]
pub fn create_contact(
    store: State<'_, MailStore>,
    input: ContactCreateInput,
) -> MailResult<Contact> {
    store.create_contact(input)
}

#[tauri::command]
pub fn update_contact(
    store: State<'_, MailStore>,
    contact_id: i64,
    input: ContactInput,
) -> MailResult<Contact> {
    store.update_contact(contact_id, input)
}

#[tauri::command]
pub fn delete_contact(store: State<'_, MailStore>, contact_id: i64) -> MailResult<()> {
    store.delete_contact(contact_id)
}

#[tauri::command]
pub fn merge_contacts(
    store: State<'_, MailStore>,
    target_contact_id: i64,
    source_contact_id: i64,
) -> MailResult<Contact> {
    store.merge_contacts(target_contact_id, source_contact_id)
}

#[tauri::command]
pub fn list_rules(store: State<'_, MailStore>) -> MailResult<Vec<MailRule>> {
    store.list_rules()
}

#[tauri::command]
pub fn upsert_rule(
    store: State<'_, MailStore>,
    rule_id: Option<i64>,
    input: MailRuleInput,
) -> MailResult<MailRule> {
    store.upsert_rule(rule_id, input)
}

#[tauri::command]
pub fn set_rule_enabled(
    store: State<'_, MailStore>,
    rule_id: i64,
    enabled: bool,
) -> MailResult<MailRule> {
    store.set_rule_enabled(rule_id, enabled)
}

#[tauri::command]
pub fn delete_rule(store: State<'_, MailStore>, rule_id: i64) -> MailResult<()> {
    store.delete_rule(rule_id)
}

#[tauri::command]
pub fn list_threads(store: State<'_, MailStore>) -> MailResult<Vec<ThreadSummary>> {
    store.list_threads()
}

#[tauri::command]
pub fn list_outbox(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    store.list_outbox()
}

#[tauri::command]
pub fn enqueue_background_task(
    store: State<'_, MailStore>,
    input: BackgroundTaskInput,
) -> MailResult<BackgroundTask> {
    store.enqueue_background_task(input)
}

#[tauri::command]
pub fn list_background_tasks(store: State<'_, MailStore>) -> MailResult<Vec<BackgroundTask>> {
    store.list_background_tasks()
}

#[tauri::command]
pub fn next_background_task(store: State<'_, MailStore>) -> MailResult<Option<BackgroundTask>> {
    store.next_background_task()
}

#[tauri::command]
pub fn mark_background_task_running(
    store: State<'_, MailStore>,
    task_id: i64,
) -> MailResult<BackgroundTask> {
    store.mark_background_task_running(task_id)
}

#[tauri::command]
pub fn complete_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
    message: String,
) -> MailResult<BackgroundTask> {
    store.complete_background_task(task_id, &message)
}

#[tauri::command]
pub fn fail_background_task(
    store: State<'_, MailStore>,
    task_id: i64,
    message: String,
) -> MailResult<BackgroundTask> {
    store.fail_background_task(task_id, &message)
}

#[tauri::command]
pub fn flush_outbox_dry_run(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    store.flush_outbox_dry_run()
}

#[tauri::command]
pub fn flush_outbox_smtp(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    for message in store.pending_outbox_messages()? {
        let account = store.get_account_by_id(Some(message.account_id))?;
        let secret = match credentials::get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                store.mark_outbox_failed(message.id, &error)?;
                continue;
            }
        };
        match smtp::send_outbound(&account, &message, &secret) {
            Ok(()) => store.mark_outbox_sent(message.id)?,
            Err(error) => store.mark_outbox_failed(message.id, &error.to_string())?,
        }
    }

    store.list_outbox()
}
