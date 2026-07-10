use crate::credentials;
use crate::db::{MailResult, MailStore, MessageRemoteRef};
use crate::imap_probe;
use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, Attachment, AttachmentDownload,
    BackgroundTask, BackgroundTaskInput, ConnectionReport, Contact, ContactCreateInput,
    ContactInput, ContactMergeSuggestion, CredentialInput, CredentialProtocolCheck,
    CredentialStatus, CredentialVerificationReport, DiagnosticAccount, DiagnosticExport,
    DiagnosticOAuthSession, DiagnosticOutboxItem, DraftInput, DraftSaveReport, Folder,
    FolderReadReport, ImapMailboxState, ImapProbeReport, Label, LocalBackup, LocalBackupSummary,
    MailIdentity, MailIdentityInput, MailRule, MailRuleInput, MailStats, Message,
    OAuthCallbackInput, OAuthCallbackReport, OAuthLocalCallbackInput, OAuthRefreshInput,
    OAuthRefreshReport, OAuthSession, OAuthStartInput, OAuthStartReport, OAuthTokenExchangeInput,
    OAuthTokenExchangeReport, OutboundAttachmentInput, OutboundMessage, OutboxItem,
    ParsedMessagePreview, RawMessageInput, RemoteActionReport, RemoteImageTrust,
    RemoteImageTrustInput, RestoreMessageReport, SyncRun, SyncSchedulePlan, ThreadSummary,
    TrashActionReport,
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
const SYNCABLE_IMAP_ROLES: [&str; 6] = ["inbox", "sent", "drafts", "archive", "trash", "spam"];

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
) -> MailResult<RemoteActionReport> {
    store.set_message_starred(message_id, is_starred)?;
    sync_remote_flagged(&store, message_id, is_starred)
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
) -> MailResult<RestoreMessageReport> {
    store.restore_message_to_inbox(message_id)?;
    let mut remote = sync_remote_move(&store, message_id, "inbox")?;
    remote.message = remote
        .message
        .replacen("本地已移动", "本地已恢复到收件箱", 1);
    Ok(RestoreMessageReport {
        restored: store.get_message(message_id)?,
        remote,
    })
}

#[tauri::command]
pub fn delete_message_permanently(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RemoteActionReport> {
    let reference = store.delete_message_permanently(message_id)?;
    sync_remote_delete_reference(&store, &reference, "本地已永久删除")
}

#[tauri::command]
pub fn empty_trash(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<TrashActionReport> {
    let (local_deleted_count, references) = store.empty_trash_for_account(account_id)?;
    let mut groups = BTreeMap::<(i64, String), Vec<MessageRemoteRef>>::new();
    let mut remote_skipped_count = 0_i64;
    for reference in references {
        if reference.remote_mailbox.trim().is_empty() {
            remote_skipped_count += 1;
            continue;
        }
        groups
            .entry((reference.account_id, reference.remote_mailbox.clone()))
            .or_default()
            .push(reference);
    }

    let mut remote_attempted_count = 0_i64;
    let mut remote_applied_count = 0_i64;
    let mut remote_failed_count = 0_i64;
    for ((account_id, remote_mailbox), references) in groups {
        let group_count = references.len() as i64;
        let account = match store.get_account_by_id(Some(account_id)) {
            Ok(account) => account,
            Err(_) => {
                remote_skipped_count += group_count;
                continue;
            }
        };
        let secret = match credentials::get_account_secret(&account) {
            Ok(secret) => secret,
            Err(_) => {
                remote_skipped_count += group_count;
                continue;
            }
        };
        remote_attempted_count += group_count;
        let candidates = references
            .iter()
            .map(|reference| imap_probe::RemoteDeleteCandidate {
                remote_uid: reference.remote_uid,
                message_id_header: reference.message_id_header.clone(),
            })
            .collect::<Vec<_>>();
        match imap_probe::delete_remote_messages(&account, &secret, &remote_mailbox, &candidates) {
            Ok(result) => {
                remote_applied_count += result.deleted_count;
                remote_skipped_count += result.skipped_count;
            }
            Err(_) => remote_failed_count += group_count,
        }
    }

    let message = if local_deleted_count == 0 {
        "废纸篓已经为空。".to_string()
    } else if remote_failed_count > 0 {
        format!(
            "本地已永久删除 {local_deleted_count} 封；远端成功 {remote_applied_count} 封，失败 {remote_failed_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else if remote_attempted_count > 0 {
        format!(
            "本地已永久删除 {local_deleted_count} 封；远端成功 {remote_applied_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else {
        format!(
            "本地已永久删除 {local_deleted_count} 封；{remote_skipped_count} 封没有可用远端状态。"
        )
    };

    Ok(TrashActionReport {
        local_deleted_count,
        remote_attempted_count,
        remote_applied_count,
        remote_skipped_count,
        remote_failed_count,
        message,
    })
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
pub fn save_draft(store: State<'_, MailStore>, input: DraftInput) -> MailResult<DraftSaveReport> {
    let was_update = input.draft_id > 0;
    let previous_reference = if was_update {
        Some(store.get_message_remote_reference(input.draft_id)?)
    } else {
        None
    };
    let draft_id = store.save_draft(input)?;
    let message = store.get_outbound_message(draft_id)?;
    let message_id_header = smtp::outbound_message_id(&message);
    let account = store.get_account_by_id(Some(message.account_id))?;
    let local_action = if was_update {
        "草稿已更新"
    } else {
        "草稿已保存"
    };
    let Some(remote_mailbox) = store.remote_mailbox_for_account_role(account.id, "drafts")? else {
        return Ok(DraftSaveReport {
            draft_id,
            remote_attempted: false,
            remote_synced: false,
            remote_mailbox: String::new(),
            remote_uid: 0,
            message: format!("{local_action}到本地；未发现已映射的远端草稿目录。"),
        });
    };

    if let Some(previous) = previous_reference.as_ref() {
        let previous_mailbox = if previous.remote_mailbox.trim().is_empty() {
            store
                .remote_mailbox_for_account_role(previous.account_id, "drafts")?
                .unwrap_or_default()
        } else {
            previous.remote_mailbox.clone()
        };
        let moved_between_mailboxes = previous.account_id != account.id
            || (!previous_mailbox.trim().is_empty()
                && previous_mailbox.trim() != remote_mailbox.trim());
        if moved_between_mailboxes
            && !previous_mailbox.trim().is_empty()
            && (previous.remote_uid > 0 || !previous.message_id_header.trim().is_empty())
        {
            let previous_account = store.get_account_by_id(Some(previous.account_id))?;
            let previous_secret = match credentials::get_account_secret(&previous_account) {
                Ok(secret) => secret,
                Err(error) => {
                    return Ok(DraftSaveReport {
                        draft_id,
                        remote_attempted: false,
                        remote_synced: false,
                        remote_mailbox,
                        remote_uid: 0,
                        message: format!(
                            "{local_action}到本地；读取旧账号凭据以清理远端草稿失败：{error}"
                        ),
                    });
                }
            };
            let candidates = [imap_probe::RemoteDeleteCandidate {
                remote_uid: previous.remote_uid,
                message_id_header: previous.message_id_header.clone(),
            }];
            if let Err(error) = imap_probe::delete_remote_messages(
                &previous_account,
                &previous_secret,
                &previous_mailbox,
                &candidates,
            ) {
                return Ok(DraftSaveReport {
                    draft_id,
                    remote_attempted: true,
                    remote_synced: false,
                    remote_mailbox,
                    remote_uid: 0,
                    message: format!("{local_action}到本地；清理旧远端草稿失败：{error}"),
                });
            }
        }
    }

    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(DraftSaveReport {
                draft_id,
                remote_attempted: false,
                remote_synced: false,
                remote_mailbox,
                remote_uid: 0,
                message: format!("{local_action}到本地；读取凭据以同步远端草稿失败：{error}"),
            });
        }
    };
    let raw_message = match smtp::render_outbound(&message) {
        Ok(raw_message) => raw_message,
        Err(error) => {
            return Ok(DraftSaveReport {
                draft_id,
                remote_attempted: false,
                remote_synced: false,
                remote_mailbox,
                remote_uid: 0,
                message: format!("{local_action}到本地；构建远端草稿 MIME 失败：{error}"),
            });
        }
    };
    let previous_message_id_header = previous_reference
        .as_ref()
        .filter(|previous| previous.account_id == account.id)
        .map(|previous| previous.message_id_header.as_str())
        .unwrap_or_default();
    match imap_probe::replace_draft_message(
        &account,
        &secret,
        &remote_mailbox,
        previous_message_id_header,
        &message_id_header,
        &raw_message,
    ) {
        Ok(result) => {
            store.set_message_remote_identity(
                draft_id,
                &remote_mailbox,
                result.remote_uid,
                &message_id_header,
            )?;
            Ok(DraftSaveReport {
                draft_id,
                remote_attempted: true,
                remote_synced: true,
                remote_mailbox,
                remote_uid: result.remote_uid,
                message: format!("{local_action}并同步到远端草稿箱。"),
            })
        }
        Err(error) => Ok(DraftSaveReport {
            draft_id,
            remote_attempted: true,
            remote_synced: false,
            remote_mailbox,
            remote_uid: 0,
            message: format!("{local_action}到本地；远端草稿同步失败：{error}"),
        }),
    }
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
pub fn verify_account_credentials(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<CredentialVerificationReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(credential_error_report(&account, error)),
    };
    let imap_result =
        imap_probe::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    let smtp_result =
        smtp::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    Ok(credential_verification_report(
        &account,
        imap_result,
        smtp_result,
    ))
}

fn credential_error_report(account: &Account, error: String) -> CredentialVerificationReport {
    let message = format!("系统凭据不可用，未发起 IMAP/SMTP 登录验证：{error}");
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        checks: vec![
            CredentialProtocolCheck {
                name: "IMAP".to_string(),
                address: account.imap_host.clone(),
                authenticated: false,
                message: "未发起登录：系统凭据不可用。".to_string(),
            },
            CredentialProtocolCheck {
                name: "SMTP".to_string(),
                address: account.smtp_host.clone(),
                authenticated: false,
                message: "未发起登录：系统凭据不可用。".to_string(),
            },
        ],
        authenticated: false,
        status: "credential_error".to_string(),
        message,
    }
}

fn credential_verification_report(
    account: &Account,
    imap_result: Result<(), String>,
    smtp_result: Result<(), String>,
) -> CredentialVerificationReport {
    let checks = vec![
        credential_protocol_check("IMAP", &account.imap_host, imap_result),
        credential_protocol_check("SMTP", &account.smtp_host, smtp_result),
    ];
    let passed = checks.iter().filter(|check| check.authenticated).count();
    let (status, message) = match passed {
        2 => ("ok", "IMAP 与 SMTP 登录验证通过，未发送任何邮件。"),
        1 => (
            "partial",
            "仅一个协议登录成功，请检查失败协议的服务器、授权码或 OAuth2 配置。",
        ),
        _ => (
            "error",
            "IMAP 与 SMTP 登录均未通过，请先确认系统凭据和服务商设置。",
        ),
    };
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        authenticated: passed == checks.len(),
        checks,
        status: status.to_string(),
        message: message.to_string(),
    }
}

fn credential_protocol_check(
    name: &str,
    address: &str,
    result: Result<(), String>,
) -> CredentialProtocolCheck {
    match result {
        Ok(()) => CredentialProtocolCheck {
            name: name.to_string(),
            address: address.to_string(),
            authenticated: true,
            message: format!("{name} 登录认证成功。"),
        },
        Err(message) => CredentialProtocolCheck {
            name: name.to_string(),
            address: address.to_string(),
            authenticated: false,
            message,
        },
    }
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
pub fn map_imap_mailbox(
    store: State<'_, MailStore>,
    mailbox_id: i64,
    folder_id: Option<i64>,
) -> MailResult<ImapMailboxState> {
    store.map_imap_mailbox(mailbox_id, folder_id)
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
        return sync_imap_headers_for_account(&store, account, false);
    }

    let started_at = Utc::now().to_rfc3339();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut synced_accounts = 0;
    let mut failures = Vec::new();
    let mut warnings = Vec::new();

    for account in accounts {
        match sync_imap_headers_for_account(&store, &account, false) {
            Ok(run) => {
                scanned_folders += run.scanned_folders;
                imported_messages += run.imported_messages;
                synced_accounts += 1;
                if run.status == "imap_headers_account_partial" {
                    warnings.push(format!("{}: {}", account.email, run.message));
                }
            }
            Err(error) => failures.push(format!("{}: {error}", account.email)),
        }
    }

    let finished_at = Utc::now().to_rfc3339();
    let delayed_count = plan.delayed_accounts.len();
    let status = if failures.is_empty() && warnings.is_empty() {
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
    let message = if failures.is_empty() && warnings.is_empty() {
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
            "统一邮箱同步部分完成：{} 个账号完成，{} 个账号失败，{} 个账号存在目录警告，{} 个账号延后，扫描 {} 个文件夹，新增 {} 封。{}{}",
            synced_accounts,
            failures.len(),
            warnings.len(),
            delayed_count,
            scanned_folders,
            imported_messages,
            warnings.join("；"),
            if warnings.is_empty() || failures.is_empty() {
                failures.join("；")
            } else {
                format!("；{}", failures.join("；"))
            }
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

#[tauri::command]
pub fn sync_imap_history(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let account = store.get_account_by_id(account_id)?;
    sync_imap_headers_for_account(&store, &account, true)
}

fn sync_imap_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    let secret = credentials::get_account_secret(account).map_err(crate::db::MailError::Imap)?;
    let started_at = Utc::now().to_rfc3339();
    let mut mailboxes = store.list_imap_mailboxes_for_account(Some(account.id))?;
    if mailboxes.is_empty() {
        let report = imap_probe::discover_folders(account, &secret)?;
        mailboxes = store.save_imap_mailboxes_for_account(Some(account.id), &report.folders)?;
    }
    let (mailboxes, skipped_custom_folders) = syncable_mailboxes(mailboxes);
    if mailboxes.is_empty() {
        return Err(crate::db::MailError::Imap(
            "IMAP 未发现可同步的核心文件夹。".to_string(),
        ));
    }

    let total_mapped_folders = mailboxes.len();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut updated_remote_states = 0;
    let mut removed_remote_messages = 0;
    let mut failures = Vec::new();
    let mut completed_history_folders = 0;
    for mailbox in mailboxes {
        if history_only && mailbox.history_complete {
            completed_history_folders += 1;
            continue;
        }
        match imap_probe::fetch_header_page(
            account,
            &secret,
            &mailbox.remote_name,
            imap_probe::ImapHeaderFetchOptions {
                uid_validity: &mailbox.uid_validity,
                highest_uid: mailbox.highest_uid,
                lowest_uid: mailbox.lowest_uid,
                history_complete: mailbox.history_complete,
                include_recent: !history_only,
                include_history: true,
            },
        ) {
            Ok(fetch) => {
                let reconcile = store.reconcile_imap_flag_snapshot(mailbox.id, &fetch.flags);
                let imported = store.import_imap_headers_batch(mailbox.id, &fetch.headers);
                match (reconcile, imported) {
                    (Ok(reconciled), Ok(imported)) => {
                        scanned_folders += 1;
                        imported_messages += imported;
                        updated_remote_states += reconciled.updated_messages;
                        removed_remote_messages += reconciled.removed_messages;
                    }
                    (Err(error), _) | (_, Err(error)) => {
                        failures.push(format!("{}: {error}", mailbox.remote_name));
                    }
                }
            }
            Err(error) => failures.push(format!("{}: {error}", mailbox.remote_name)),
        }
    }

    let finished_at = Utc::now().to_rfc3339();
    let custom_note = if skipped_custom_folders > 0 {
        format!(
            " 跳过 {} 个尚未建立本地映射的自定义目录。",
            skipped_custom_folders
        )
    } else {
        String::new()
    };
    if history_only && scanned_folders == 0 && failures.is_empty() {
        let message = format!(
            "{} 的 {} 个已映射文件夹历史邮件已全部回填。{}",
            account.email, completed_history_folders, custom_note
        );
        return store.record_sync_run(
            &started_at,
            &finished_at,
            "imap_history_complete",
            0,
            0,
            &message,
        );
    }
    if scanned_folders == 0 {
        let message = format!(
            "{} 的 {} 个已映射文件夹{}均失败。{}{}",
            account.email,
            total_mapped_folders,
            if history_only {
                "历史回填"
            } else {
                "同步"
            },
            failures.join("；"),
            custom_note
        );
        store.record_sync_run(
            &started_at,
            &finished_at,
            if history_only {
                "imap_history_account_failed"
            } else {
                "imap_headers_account_failed"
            },
            0,
            0,
            &message,
        )?;
        return Err(crate::db::MailError::Imap(message));
    }

    let (status, message) = if failures.is_empty() {
        (
            if history_only {
                "imap_history_account"
            } else {
                "imap_headers_account"
            },
            if history_only {
                format!(
                    "{} 历史回填完成：扫描 {} 个文件夹，补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录此前已完成。{}",
                    account.email,
                    scanned_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    completed_history_folders,
                    custom_note
                )
            } else {
                format!(
                    "{} 同步完成：扫描 {} 个已映射文件夹，新增或补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封，并推进历史回填。{}",
                    account.email,
                    scanned_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    custom_note
                )
            },
        )
    } else {
        (
            if history_only {
                "imap_history_account_partial"
            } else {
                "imap_headers_account_partial"
            },
            if history_only {
                format!(
                    "{} 历史回填部分完成：扫描 {}/{} 个文件夹，补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录失败：{}。{}",
                    account.email,
                    scanned_folders,
                    total_mapped_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    failures.len(),
                    failures.join("；"),
                    custom_note
                )
            } else {
                format!(
                    "{} 同步部分完成：扫描 {}/{} 个已映射文件夹，新增或补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录失败：{}。{}",
                    account.email,
                    scanned_folders,
                    total_mapped_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    failures.len(),
                    failures.join("；"),
                    custom_note
                )
            },
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

fn syncable_mailboxes(mailboxes: Vec<ImapMailboxState>) -> (Vec<ImapMailboxState>, usize) {
    let mut syncable = Vec::new();
    let mut skipped_custom = 0;
    for mailbox in mailboxes {
        if SYNCABLE_IMAP_ROLES.contains(&mailbox.local_role.as_str())
            || (mailbox.local_role == "custom" && mailbox.local_folder_id.is_some())
        {
            syncable.push(mailbox);
        } else {
            skipped_custom += 1;
        }
    }
    (syncable, skipped_custom)
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

fn sync_remote_flagged(
    store: &MailStore,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Ok(local_only_report(
            "本地星标已更新；该邮件没有远端 UID，跳过远端星标回写。",
        ));
    }
    let account = store.get_message_account(message_id)?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地星标已更新；无法读取系统凭据，远端星标回写已跳过：{error}"
            )));
        }
    };
    match imap_probe::set_remote_flagged(&account, &secret, &remote_mailbox, remote_uid, is_starred)
    {
        Ok(()) => Ok(remote_ok_report(if is_starred {
            "本地已添加星标，远端 \\Flagged 状态已同步。"
        } else {
            "本地已取消星标，远端 \\Flagged 状态已同步。"
        })),
        Err(error) => Ok(remote_failed_report(format!(
            "本地星标已更新；远端星标状态回写失败：{error}"
        ))),
    }
}

fn sync_remote_move(
    store: &MailStore,
    message_id: i64,
    role: &str,
) -> MailResult<RemoteActionReport> {
    let reference = store.get_message_remote_reference(message_id)?;
    if reference.remote_mailbox.trim().is_empty()
        || (reference.remote_uid <= 0 && reference.message_id_header.trim().is_empty())
    {
        return Ok(local_only_report(
            "本地已移动；该邮件没有远端 UID，跳过远端移动。",
        ));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
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
            &reference.remote_mailbox,
            reference.remote_uid,
            &target_mailbox,
            &reference.message_id_header,
        ) {
            Ok(target_uid) => {
                store.set_message_remote_ref(
                    message_id,
                    &target_mailbox,
                    target_uid.unwrap_or(0),
                )?;
                Ok(remote_ok_report(if target_uid.is_some() {
                    format!("本地已移动；远端邮件已移动到 {target_mailbox}，UID 已重绑定。")
                } else {
                    format!(
                        "本地已移动；远端邮件已移动到 {target_mailbox}，目标 UID 将在下次同步时重绑定。"
                    )
                }))
            }
            Err(error) => Ok(remote_failed_report(format!(
                "本地已移动；远端移动失败：{error}"
            ))),
        },
        None if role == "trash" => {
            let candidates = [imap_probe::RemoteDeleteCandidate {
                remote_uid: reference.remote_uid,
                message_id_header: reference.message_id_header.clone(),
            }];
            match imap_probe::delete_remote_messages(
                &account,
                &secret,
                &reference.remote_mailbox,
                &candidates,
            ) {
                Ok(result) if result.deleted_count == 1 => {
                    store.set_message_remote_ref(message_id, "", 0)?;
                    Ok(remote_ok_report(
                        "本地已移到废纸篓；远端没有废纸篓映射，邮件已直接删除并 expunge。",
                    ))
                }
                Ok(_) => Ok(remote_skipped_report(
                    "本地已移到废纸篓；远端邮件无法唯一定位，删除已跳过。",
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

fn sync_remote_delete_reference(
    store: &MailStore,
    reference: &MessageRemoteRef,
    local_action: &str,
) -> MailResult<RemoteActionReport> {
    if reference.remote_mailbox.trim().is_empty()
        || (reference.remote_uid <= 0 && reference.message_id_header.trim().is_empty())
    {
        return Ok(local_only_report(format!(
            "{local_action}；该邮件没有可用远端状态，跳过远端删除。"
        )));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    let secret = match credentials::get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "{local_action}；无法读取系统凭据，远端删除已跳过：{error}"
            )));
        }
    };
    let candidates = [imap_probe::RemoteDeleteCandidate {
        remote_uid: reference.remote_uid,
        message_id_header: reference.message_id_header.clone(),
    }];
    match imap_probe::delete_remote_messages(
        &account,
        &secret,
        &reference.remote_mailbox,
        &candidates,
    ) {
        Ok(result) if result.deleted_count == 1 => Ok(remote_ok_report(format!(
            "{local_action}；远端邮件已标记删除并 expunge。"
        ))),
        Ok(_) => Ok(remote_skipped_report(format!(
            "{local_action}；远端邮件无法唯一定位，删除已跳过。"
        ))),
        Err(error) => Ok(remote_failed_report(format!(
            "{local_action}；远端删除失败：{error}"
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
        credential_error_report, credential_verification_report, mask_email, mask_recipient_list,
        render_eml_message, sanitize_filename, syncable_mailboxes,
        validate_attachment_download_size, MAX_ATTACHMENT_DOWNLOAD_BYTES,
    };
    use crate::models::{Account, Attachment, ImapMailboxState, Message};

    fn sample_account() -> Account {
        Account {
            id: 1,
            email: "me@example.com".to_string(),
            display_name: "Me".to_string(),
            provider: "custom".to_string(),
            imap_host: "imap.example.com:993".to_string(),
            smtp_host: "smtp.example.com:465".to_string(),
            auth_type: "password".to_string(),
            sync_mode: "manual".to_string(),
            remote_images_allowed: false,
            signature: String::new(),
            is_default: true,
        }
    }

    fn sample_mailbox(id: i64, remote_name: &str, local_role: &str) -> ImapMailboxState {
        ImapMailboxState {
            id,
            account_id: 1,
            account_email: "me@example.com".to_string(),
            remote_name: remote_name.to_string(),
            delimiter: "/".to_string(),
            attributes: String::new(),
            local_role: local_role.to_string(),
            local_folder_id: None,
            local_folder_name: String::new(),
            uid_validity: String::new(),
            highest_uid: 0,
            lowest_uid: 0,
            history_complete: false,
            history_last_sync_at: String::new(),
            last_seen_at: String::new(),
            last_sync_at: String::new(),
        }
    }

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

    #[test]
    fn credential_verification_report_tracks_success_and_partial_failure() {
        let account = sample_account();
        let success = credential_verification_report(&account, Ok(()), Ok(()));
        assert!(success.authenticated);
        assert_eq!(success.status, "ok");
        assert!(success.checks.iter().all(|check| check.authenticated));

        let partial =
            credential_verification_report(&account, Ok(()), Err("SMTP 登录验证失败".to_string()));
        assert!(!partial.authenticated);
        assert_eq!(partial.status, "partial");
        assert!(partial.checks[0].authenticated);
        assert!(!partial.checks[1].authenticated);
        assert!(partial.checks[1].message.contains("SMTP 登录验证失败"));

        let missing = credential_error_report(&account, "未读取到系统凭据".to_string());
        assert_eq!(missing.status, "credential_error");
        assert!(!missing.authenticated);
        assert!(missing.message.contains("未发起"));
    }

    #[test]
    fn syncable_mailboxes_keep_core_and_mapped_custom_roles() {
        let roles = [
            ("INBOX", "inbox"),
            ("Sent", "sent"),
            ("Drafts", "drafts"),
            ("Archive", "archive"),
            ("Trash", "trash"),
            ("Junk", "spam"),
            ("Projects/Alpha", "custom"),
        ];
        let mut mailboxes = roles
            .into_iter()
            .enumerate()
            .map(|(index, (remote_name, local_role))| {
                sample_mailbox(index as i64 + 1, remote_name, local_role)
            })
            .collect::<Vec<_>>();
        mailboxes.push(ImapMailboxState {
            local_folder_id: Some(42),
            local_folder_name: "项目 Alpha".to_string(),
            ..sample_mailbox(8, "Projects/Mapped", "custom")
        });

        let (mapped, skipped_custom) = syncable_mailboxes(mailboxes);

        assert_eq!(mapped.len(), 7);
        assert_eq!(skipped_custom, 1);
        assert!(mapped
            .iter()
            .any(|mailbox| mailbox.local_folder_name == "项目 Alpha"));
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

fn archive_sent_message(
    store: &MailStore,
    account: &Account,
    secret: &credentials::AccountSecret,
    message: &OutboundMessage,
    raw_message: &[u8],
) -> MailResult<()> {
    let Some(remote_name) = store.remote_mailbox_for_account_role(account.id, "sent")? else {
        return store.mark_outbox_remote_archive_failed(
            message.id,
            "SMTP 已发送；未发现已映射的远端已发送目录，稍后仅重试留档。",
        );
    };
    let message_id_header = smtp::outbound_message_id(message);
    match imap_probe::append_sent_message(
        account,
        secret,
        &remote_name,
        &message_id_header,
        raw_message,
    ) {
        Ok(result) => {
            store.mark_outbox_remote_archived(message.id, &remote_name, result.remote_uid)
        }
        Err(error) => store.mark_outbox_remote_archive_failed(
            message.id,
            &format!("SMTP 已发送；远端已发送留档失败：{error}"),
        ),
    }
}

fn retry_pending_remote_archives(store: &MailStore) -> MailResult<()> {
    for message in store.pending_remote_archive_messages()? {
        let account = store.get_account_by_id(Some(message.account_id))?;
        let secret = match credentials::get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                store.mark_outbox_remote_archive_failed(
                    message.id,
                    &format!("SMTP 已发送；读取凭据以重试远端留档失败：{error}"),
                )?;
                continue;
            }
        };
        let raw_message = match smtp::render_outbound(&message) {
            Ok(raw_message) => raw_message,
            Err(error) => {
                store.mark_outbox_remote_archive_failed(
                    message.id,
                    &format!("SMTP 已发送；重建原始邮件以重试远端留档失败：{error}"),
                )?;
                continue;
            }
        };
        archive_sent_message(store, &account, &secret, &message, &raw_message)?;
    }
    Ok(())
}

#[tauri::command]
pub fn flush_outbox_smtp(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    retry_pending_remote_archives(store.inner())?;

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
            Ok(raw_message) => {
                let message_id_header = smtp::outbound_message_id(&message);
                store.mark_outbox_smtp_sent_pending_archive(message.id, &message_id_header)?;
                archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
            }
            Err(error) => store.mark_outbox_failed(message.id, &error.to_string())?,
        }
    }

    store.list_outbox()
}
