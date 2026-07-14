use crate::credentials;
use crate::db::{MailResult, MailStore, MessageRemoteRef};
use crate::imap_probe;
use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, Attachment, AttachmentDownload,
    BackgroundTask, BackgroundTaskInput, CacheClearResult, ConnectionReport, Contact,
    ContactCreateInput, ContactExportSummary, ContactImportSummary, ContactInput,
    ContactMergeSuggestion, CredentialInput, CredentialProtocolCheck, CredentialStatus,
    CredentialVerificationInput, CredentialVerificationReport, DiagnosticAccount, DiagnosticExport,
    DiagnosticOAuthSession, DiagnosticOutboxItem, DraftInput, DraftSaveReport, Folder,
    FolderReadReport, ImapMailboxState, ImapProbeReport, Label, LocalBackup, LocalBackupSummary,
    MailIdentity, MailIdentityInput, MailRule, MailRuleInput, MailStats, Message,
    MessageThreadingInput, OAuthCallbackInput, OAuthCallbackReport, OAuthLocalCallbackInput,
    OAuthRefreshInput, OAuthRefreshReport, OAuthSession, OAuthStartInput, OAuthStartReport,
    OAuthTokenExchangeInput, OAuthTokenExchangeReport, OutboundAttachmentInput, OutboundMessage,
    OutboxItem, ParsedMessagePreview, RawMessageInput, RemoteActionReport, RemoteImageTrust,
    RemoteImageTrustInput, RestoreMessageReport, StorageUsage, SyncRun, SyncSchedulePlan,
    ThreadSummary, TrashActionReport,
};
use crate::oauth;
use crate::pop3_probe;
use crate::protocol;
use crate::smtp;
use crate::vcard;
use base64::Engine as _;
use chrono::Utc;
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

const MAX_ATTACHMENT_DOWNLOAD_BYTES: i64 = 25 * 1024 * 1024;
const MAX_ATTACHMENT_TRANSFER_BYTES: i64 = MAX_ATTACHMENT_DOWNLOAD_BYTES * 4;
const MAX_EML_IMPORT_BYTES: usize = 25 * 1024 * 1024;
const MAX_VCARD_IMPORT_BYTES: usize = 5 * 1024 * 1024;
const MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH: usize = 2;
const SYNCABLE_IMAP_ROLES: [&str; 6] = ["inbox", "sent", "drafts", "archive", "trash", "spam"];
const VERBOSE_COMMAND_LOG_ENV: &str = "BETTER_EMAIL_VERBOSE_COMMAND_LOGS";

fn verbose_command_logs_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var(VERBOSE_COMMAND_LOG_ENV)
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
}

fn command_info(message: impl AsRef<str>) {
    if verbose_command_logs_enabled() {
        eprintln!("{}", message.as_ref());
    }
}

fn attachment_resume_offset(bytes: u64) -> Option<usize> {
    if bytes > MAX_ATTACHMENT_TRANSFER_BYTES as u64 {
        return None;
    }
    usize::try_from(bytes).ok()
}

fn format_attachment_progress(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{} KB", bytes.div_ceil(KB))
    } else {
        format!("{bytes} B")
    }
}

fn benchmark_env(primary: &str, legacy: &str) -> Option<String> {
    std::env::var(primary)
        .ok()
        .or_else(|| std::env::var(legacy).ok())
}

fn prompt_save_file_path(
    app: &AppHandle,
    title: &str,
    filename: String,
) -> MailResult<Option<PathBuf>> {
    let (sender, receiver) = mpsc::channel();
    app.dialog()
        .file()
        .set_title(title)
        .set_file_name(filename)
        .save_file(move |path| {
            let _ = sender.send(path);
        });

    let Some(path) = receiver
        .recv()
        .map_err(|error| crate::db::MailError::Imap(format!("保存面板响应失败：{error}")))?
    else {
        return Ok(None);
    };

    path.into_path()
        .map(Some)
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析另存为路径：{error}")))
}

#[tauri::command]
pub fn list_accounts(store: State<'_, MailStore>) -> MailResult<Vec<Account>> {
    store.list_accounts()
}

#[tauri::command]
pub fn get_account(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Option<Account>> {
    store.get_account_by_id_optional(account_id)
}

#[tauri::command]
pub async fn create_account(
    store: State<'_, MailStore>,
    input: AccountCreateInput,
) -> MailResult<Account> {
    command_info(format!(
        "[better-email][account] create command start email={} provider={} protocol={} imap_host={} smtp_host={}",
        mask_email(&input.email),
        input.provider.trim(),
        input.incoming_protocol.trim(),
        input.imap_host.trim(),
        input.smtp_host.trim(),
    ));
    match store.create_account(input) {
        Ok(account) => {
            command_info(format!(
                "[better-email][account] create command ok account_id={} email={} default={}",
                account.id,
                mask_email(&account.email),
                account.is_default,
            ));
            Ok(account)
        }
        Err(error) => {
            eprintln!("[better-email][account] create command failed error={error}");
            Err(error)
        }
    }
}

#[tauri::command]
pub fn set_default_account(store: State<'_, MailStore>, account_id: i64) -> MailResult<Account> {
    store.set_default_account(account_id)
}

#[tauri::command]
pub async fn delete_account(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Option<Account>> {
    command_info(format!(
        "[better-email][account] delete command start account_id={account_id}"
    ));
    match store.delete_account(account_id) {
        Ok(next_account) => {
            command_info(format!(
                "[better-email][account] delete command ok removed_account_id={} next_account_id={}",
                account_id,
                next_account.as_ref().map(|account| account.id).unwrap_or_default(),
            ));
            Ok(next_account)
        }
        Err(error) => {
            eprintln!(
                "[better-email][account] delete command failed account_id={} error={error}",
                account_id,
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn update_account_settings(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    input: AccountSettingsInput,
) -> MailResult<Account> {
    command_info(format!(
        "[better-email][account] update settings start account_id={account_id:?} provider={} protocol={} sync_mode={}",
        input.provider.trim(),
        input.incoming_protocol.trim(),
        input.sync_mode.trim(),
    ));
    match store.update_account_settings_for(account_id, input) {
        Ok(account) => {
            command_info(format!(
                "[better-email][account] update settings ok account_id={} email={} sync_mode={}",
                account.id,
                mask_email(&account.email),
                account.sync_mode,
            ));
            Ok(account)
        }
        Err(error) => {
            eprintln!(
                "[better-email][account] update settings failed account_id={account_id:?} error={error}"
            );
            Err(error)
        }
    }
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
pub fn create_label(store: State<'_, MailStore>, name: String, color: String) -> MailResult<Label> {
    store.create_label(&name, &color)
}

#[tauri::command]
pub fn update_label(
    store: State<'_, MailStore>,
    id: i64,
    name: String,
    color: String,
) -> MailResult<()> {
    store.update_label(id, &name, &color)
}

#[tauri::command]
pub fn delete_label(store: State<'_, MailStore>, id: i64) -> MailResult<()> {
    store.delete_label(id)
}

#[tauri::command]
pub fn list_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    limit: i64,
) -> MailResult<Vec<Message>> {
    store.list_messages_for_scope_sorted(
        account_id,
        folder_id.unwrap_or_default(),
        query,
        filter,
        sort,
        limit,
    )
}

#[tauri::command]
pub fn list_provider_write_validation_messages(
    store: State<'_, MailStore>,
    account_id: i64,
    validation_id: String,
) -> MailResult<Vec<Message>> {
    store.list_provider_write_validation_messages(account_id, validation_id)
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
pub fn set_threads_muted(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
    muted: bool,
) -> MailResult<i64> {
    store.set_threads_muted_for_messages(&message_ids, muted)
}

#[tauri::command]
pub fn list_muted_thread_keys(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Vec<String>> {
    store.list_muted_thread_keys(account_id)
}

#[tauri::command]
pub fn list_attachments(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Vec<Attachment>> {
    store.list_attachments(message_id)
}

#[tauri::command]
pub fn read_attachment_data_url(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "附件尚未下载到本地。",
        )));
    }

    let path = PathBuf::from(&attachment.local_path);
    let metadata = fs::metadata(&path)?;
    validate_attachment_download_size(metadata.len().min(i64::MAX as u64) as i64)?;
    let bytes = fs::read(&path)?;
    let mime_type = if attachment.mime_type.trim().is_empty()
        || attachment
            .mime_type
            .eq_ignore_ascii_case("application/octet-stream")
    {
        mime_type_for_path(&path).to_string()
    } else {
        attachment.mime_type.trim().to_string()
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime_type};base64,{encoded}"))
}

#[tauri::command]
pub async fn save_image_data_url_as(
    app: AppHandle,
    data_url: String,
    filename: String,
) -> MailResult<String> {
    let Some((metadata, encoded)) = data_url.split_once(',') else {
        return Err(crate::db::MailError::Imap(
            "图片数据无效，无法另存为。".to_string(),
        ));
    };
    let Some(mime_type) = metadata
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
    else {
        return Err(crate::db::MailError::Imap(
            "图片类型无效，无法另存为。".to_string(),
        ));
    };
    if !mime_type.starts_with("image/") || !metadata.contains(";base64") {
        return Err(crate::db::MailError::Imap(
            "仅支持另存为邮件中的图片。".to_string(),
        ));
    }

    let payload = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| crate::db::MailError::Imap(format!("图片数据解析失败：{error}")))?;
    validate_attachment_download_size(payload.len().min(i64::MAX as usize) as i64)?;

    let Some(target_path) = prompt_save_file_path(&app, "另存图片", sanitize_filename(&filename))?
    else {
        return Err(crate::db::MailError::Imap("已取消图片另存为。".to_string()));
    };

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, payload)?;
    Ok(format!("图片已另存为 {}", target_path.to_string_lossy()))
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
pub fn outbound_attachments_from_paths(
    paths: Vec<String>,
) -> MailResult<Vec<OutboundAttachmentInput>> {
    paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .map(|path| attachment_input_from_path(PathBuf::from(path)))
        .collect()
}

fn attachment_input_from_path(path: PathBuf) -> MailResult<OutboundAttachmentInput> {
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
pub fn render_message_with_remote_images_once(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    let mut message = store.get_message(message_id)?;
    if !message.body.trim().is_empty() {
        message.sanitized_html = protocol::sanitize_html_with_remote_images(&message.body);
    }
    message
        .security_warnings
        .retain(|warning| !warning.contains("远程图片"));
    Ok(message)
}

#[tauri::command]
pub async fn download_attachment(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<AttachmentDownload> {
    let attachment = store.get_attachment(attachment_id)?;
    let account = store.get_message_account(attachment.message_id)?;
    let secret = store.get_account_secret(&account)?;
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
    let resume_offset = fs::metadata(&temp_path)
        .ok()
        .and_then(|metadata| attachment_resume_offset(metadata.len()))
        .unwrap_or_else(|| {
            let _ = fs::remove_file(&temp_path);
            0
        });
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&temp_path)?;
    let download_result = imap_probe::download_attachment_to_writer(
        &account,
        &secret,
        imap_probe::AttachmentDownloadOptions {
            remote_name: &remote_mailbox,
            remote_uid,
            filename: &attachment.filename,
            content_id: &attachment.content_id,
            max_bytes: MAX_ATTACHMENT_DOWNLOAD_BYTES,
            start_offset: resume_offset,
        },
        &mut output,
    );
    drop(output);
    let downloaded = match download_result {
        Ok(downloaded) => downloaded,
        Err(error) => {
            let partial_bytes = fs::metadata(&temp_path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            let progress = format_attachment_progress(partial_bytes);
            return Err(crate::db::MailError::Imap(format!(
                "{error}；已保留 {progress} 下载进度，点击重试将继续。"
            )));
        }
    };
    let filename = sanitize_filename(if downloaded.filename.trim().is_empty() {
        &attachment.filename
    } else {
        &downloaded.filename
    });
    let local_path = dir.join(format!("{}-{filename}", attachment.id));
    let decoded_path = dir.join(format!("{}.decoded", attachment.id));
    let decoded_size = match downloaded.transfer_encoding {
        imap_probe::AttachmentTransferEncoding::Identity => {
            if let Err(error) = validate_attachment_download_size(downloaded.size_bytes) {
                let _ = fs::remove_file(&temp_path);
                return Err(error);
            }
            if local_path.exists() {
                fs::remove_file(&local_path)?;
            }
            fs::rename(&temp_path, &local_path)?;
            downloaded.size_bytes
        }
        transfer_encoding => {
            let decode_result = (|| -> MailResult<i64> {
                let mut source = BufReader::new(File::open(&temp_path)?);
                let decoded_file = File::create(&decoded_path)?;
                let mut target = BufWriter::new(decoded_file);
                let decoded_size = imap_probe::decode_attachment_transfer(
                    &mut source,
                    &mut target,
                    &transfer_encoding,
                    MAX_ATTACHMENT_DOWNLOAD_BYTES,
                )?;
                target.flush()?;
                validate_attachment_download_size(decoded_size)?;
                Ok(decoded_size)
            })();
            let decoded_size = match decode_result {
                Ok(size) => size,
                Err(error) => {
                    let _ = fs::remove_file(&decoded_path);
                    let _ = fs::remove_file(&temp_path);
                    return Err(error);
                }
            };
            if local_path.exists() {
                fs::remove_file(&local_path)?;
            }
            fs::rename(&decoded_path, &local_path)?;
            let _ = fs::remove_file(&temp_path);
            decoded_size
        }
    };
    let local_path_string = local_path.to_string_lossy().into_owned();
    let updated =
        store.mark_attachment_downloaded(attachment.id, &local_path_string, decoded_size)?;

    Ok(AttachmentDownload {
        attachment: updated,
        local_path: local_path_string.clone(),
        message: if resume_offset > 0 {
            format!(
                "附件已从 {} 继续下载到 {local_path_string}",
                format_attachment_progress(resume_offset as u64)
            )
        } else {
            format!("附件已下载到 {local_path_string}")
        },
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

#[allow(deprecated)]
#[tauri::command]
pub fn reveal_attachment_in_finder(
    _app: AppHandle,
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Imap(
            "附件尚未下载，请先下载后再定位。".to_string(),
        ));
    }
    let path = std::path::PathBuf::from(&attachment.local_path);
    if !path.exists() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "已下载附件文件不存在，请重新下载。",
        )));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(crate::db::MailError::Io)?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.to_string_lossy()))
            .spawn()
            .map_err(crate::db::MailError::Io)?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let target = path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        _app.shell()
            .open(target, None)
            .map_err(|error| crate::db::MailError::Imap(format!("无法定位附件：{error}")))?;
    }

    Ok(format!("已在 Finder 中显示：{}", attachment.filename))
}

#[tauri::command]
pub fn copy_attachment_file_to_clipboard(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Imap(
            "附件尚未下载，请先下载后再复制。".to_string(),
        ));
    }

    let path = std::path::PathBuf::from(&attachment.local_path);
    if !path.exists() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "已下载附件文件不存在，请重新下载。",
        )));
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg("on run argv")
            .arg("-e")
            .arg("set the clipboard to (POSIX file (item 1 of argv))")
            .arg("-e")
            .arg("end run")
            .arg(path.to_string_lossy().into_owned())
            .output()
            .map_err(crate::db::MailError::Io)?;
        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(crate::db::MailError::Imap(if message.is_empty() {
                "无法复制附件文件到剪切板。".to_string()
            } else {
                format!("无法复制附件文件到剪切板：{message}")
            }));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Set-Clipboard -LiteralPath {}",
            powershell_single_quote(&path.to_string_lossy())
        );
        let output = std::process::Command::new("powershell")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg(script)
            .output()
            .map_err(crate::db::MailError::Io)?;
        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(crate::db::MailError::Imap(if message.is_empty() {
                "无法复制附件文件到剪切板。".to_string()
            } else {
                format!("无法复制附件文件到剪切板：{message}")
            }));
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Err(crate::db::MailError::Imap(
            "当前系统暂不支持复制附件文件对象。".to_string(),
        ))
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    Ok(format!("已复制附件文件：{}", attachment.filename))
}

#[tauri::command]
pub async fn save_attachment_as(
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

    let Some(target_path) =
        prompt_save_file_path(&app, "另存附件", sanitize_filename(&attachment.filename))?
    else {
        return Err(crate::db::MailError::Imap("已取消附件另存为。".to_string()));
    };

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
    store.import_eml_message(account_id, &payload).map(Some)
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
pub async fn set_message_read(
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
        let secret = match store.get_account_secret(&account) {
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
pub async fn set_message_starred(
    store: State<'_, MailStore>,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    store.set_message_starred(message_id, is_starred)?;
    sync_remote_flagged(&store, message_id, is_starred)
}

#[tauri::command]
pub async fn move_message_to_role(
    store: State<'_, MailStore>,
    message_id: i64,
    role: String,
) -> MailResult<RemoteActionReport> {
    store.move_message_to_role(message_id, &role)?;
    sync_remote_move(&store, message_id, &role)
}

#[tauri::command]
pub async fn restore_message_to_inbox(
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
pub async fn delete_message_permanently(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RemoteActionReport> {
    let reference = store.delete_message_permanently(message_id)?;
    sync_remote_delete_reference(&store, &reference, "本地已永久删除")
}

#[tauri::command]
pub async fn empty_trash(
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
        let secret = match store.get_account_secret(&account) {
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
pub fn save_draft(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<DraftSaveReport> {
    let was_update = input.draft_id > 0;
    let previous_reference = if was_update {
        Some(store.get_message_remote_reference(input.draft_id)?)
    } else {
        None
    };
    let draft_id = store.save_draft(input)?;
    store.set_message_threading(draft_id, threading)?;
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
            let previous_secret = match store.get_account_secret(&previous_account) {
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

    let secret = match store.get_account_secret(&account) {
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
pub async fn send_message(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<i64> {
    let started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][send] direct smtp start account_id={} to={} subject_len={} attachments={}",
        input.account_id,
        mask_recipient_list(&input.to),
        input.subject.trim().chars().count(),
        input.attachments.len(),
    ));
    let message_id = store.send_message(input)?;
    store.set_message_threading(message_id, threading)?;
    let message = store.get_outbound_message(message_id)?;
    let account = store.get_account_by_id(Some(message.account_id))?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            let blocked_error =
                "缺少账号授权码，请在账号设置中重新保存授权码；邮件已留在发件箱。".to_string();
            eprintln!(
                "[better-email][send] direct smtp credential missing message_id={} account_id={} email={} error={}",
                message_id,
                message.account_id,
                mask_email(&account.email),
                error,
            );
            store.mark_outbox_blocked(message_id, &blocked_error)?;
            return Err(crate::db::MailError::Smtp(blocked_error));
        }
    };
    let raw_message = match smtp::send_outbound(&account, &message, &secret) {
        Ok(raw_message) => raw_message,
        Err(error) => {
            let error_message = error.to_string();
            eprintln!(
                "[better-email][send] direct smtp failed message_id={} account_id={} error={}",
                message_id, message.account_id, error,
            );
            store.mark_outbox_failed(message_id, &error_message)?;
            return Err(error);
        }
    };
    let message_id_header = smtp::outbound_message_id(&message);
    store.mark_outbox_smtp_sent_pending_archive(message_id, &message_id_header)?;
    archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
    command_info(format!(
        "[better-email][send] direct smtp ok message_id={} account_id={} duration_ms={}",
        message_id,
        message.account_id,
        started_at.elapsed().as_millis(),
    ));
    Ok(message_id)
}

#[tauri::command]
pub fn queue_outbox_message(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<OutboxItem> {
    let started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][send] queue start account_id={} to={} send_at={} attachments={}",
        input.account_id,
        mask_recipient_list(&input.to),
        if input.send_at.trim().is_empty() {
            "now"
        } else {
            "scheduled"
        },
        input.attachments.len(),
    ));
    let item = store.queue_outbox_message(input)?;
    store.set_message_threading(item.message_id, threading)?;
    command_info(format!(
        "[better-email][send] queue ok outbox_id={} message_id={} status={} duration_ms={}",
        item.id,
        item.message_id,
        item.status,
        started_at.elapsed().as_millis(),
    ));
    Ok(item)
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
pub fn get_storage_usage(store: State<'_, MailStore>) -> MailResult<StorageUsage> {
    store.storage_usage()
}

#[tauri::command]
pub fn clear_attachment_cache(store: State<'_, MailStore>) -> MailResult<CacheClearResult> {
    store.clear_reclaimable_attachment_cache()
}

#[tauri::command]
pub fn test_connection(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ConnectionReport> {
    let account = store.get_account_by_id(account_id)?;
    protocol::test_endpoints(
        &account.email,
        &account.incoming_protocol,
        &account.imap_host,
        &account.smtp_host,
    )
}

#[tauri::command]
pub async fn verify_account_credentials(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<CredentialVerificationReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(credential_error_report(&account, error.to_string())),
    };
    let incoming_result = verify_incoming_credentials(&account, &secret);
    let smtp_result =
        smtp::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    Ok(credential_verification_report(
        &account,
        incoming_result,
        smtp_result,
    ))
}

#[tauri::command]
pub async fn verify_account_credentials_with_secret(
    store: State<'_, MailStore>,
    input: CredentialVerificationInput,
) -> MailResult<CredentialVerificationReport> {
    let account = store.get_account_by_id(input.account_id)?;
    let raw_secret = input.secret.trim();
    if raw_secret.is_empty() {
        return Ok(credential_error_report(
            &account,
            "请输入授权码或密码后再验证。".to_string(),
        ));
    }
    let secret = match credentials::account_secret_from_raw(&account.auth_type, raw_secret) {
        Ok(secret) => secret,
        Err(error) => return Ok(credential_error_report(&account, error)),
    };
    let incoming_result = verify_incoming_credentials(&account, &secret);
    let smtp_result =
        smtp::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    Ok(credential_verification_report(
        &account,
        incoming_result,
        smtp_result,
    ))
}

fn incoming_protocol_name(account: &Account) -> &'static str {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        "POP3"
    } else {
        "IMAP"
    }
}

fn is_pop3_account(account: &Account) -> bool {
    account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
}

fn verify_incoming_credentials(
    account: &Account,
    secret: &credentials::AccountSecret,
) -> Result<(), String> {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        pop3_probe::verify_credentials(account, secret).map_err(|error| error.to_string())
    } else {
        imap_probe::verify_credentials(account, secret).map_err(|error| error.to_string())
    }
}

fn credential_error_report(account: &Account, error: String) -> CredentialVerificationReport {
    let incoming_name = incoming_protocol_name(account);
    let message = format!("系统凭据不可用，未发起 {incoming_name}/SMTP 登录验证：{error}");
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        checks: vec![
            CredentialProtocolCheck {
                name: incoming_name.to_string(),
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
    incoming_result: Result<(), String>,
    smtp_result: Result<(), String>,
) -> CredentialVerificationReport {
    let incoming_name = incoming_protocol_name(account);
    let checks = vec![
        credential_protocol_check(incoming_name, &account.imap_host, incoming_result),
        credential_protocol_check("SMTP", &account.smtp_host, smtp_result),
    ];
    let passed = checks.iter().filter(|check| check.authenticated).count();
    let (status, message) = match passed {
        2 => (
            "ok",
            format!("{incoming_name} 与 SMTP 登录验证通过，未发送任何邮件。"),
        ),
        1 => (
            "partial",
            "仅一个协议登录成功，请检查失败协议的服务器、授权码或 OAuth2 配置。".to_string(),
        ),
        _ => (
            "error",
            format!("{incoming_name} 与 SMTP 登录均未通过，请先确认系统凭据和服务商设置。"),
        ),
    };
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        authenticated: passed == checks.len(),
        checks,
        status: status.to_string(),
        message,
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
pub async fn discover_imap_folders(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ImapProbeReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(imap_probe::failed_report(&account.email, error.to_string())),
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
    let plan = store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)?;
    command_info(format!(
        "[better-email][sync] plan account_id={account_id:?} total_accounts={} batch_accounts={} delayed_accounts={}",
        plan.total_accounts,
        plan.batch_accounts.len(),
        plan.delayed_accounts.len()
    ));
    Ok(plan)
}

#[tauri::command]
pub async fn sync_imap_headers(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let command_started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][sync] command start account_id={account_id:?}"
    ));
    let plan = store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)?;
    let accounts = plan.batch_accounts.clone();
    command_info(format!(
        "[better-email][sync] command plan account_id={account_id:?} total_accounts={} batch_accounts={} delayed_accounts={}",
        plan.total_accounts,
        accounts.len(),
        plan.delayed_accounts.len()
    ));
    if account_id.is_some() {
        let account = accounts
            .first()
            .ok_or_else(|| crate::db::MailError::Imap("没有可同步账号。".to_string()))?;
        let result = sync_headers_for_account(&store, account, false);
        match &result {
            Ok(run) => command_info(format!(
                "[better-email][sync] command done account_id={account_id:?} status={} scanned_folders={} imported_messages={} duration_ms={}",
                run.status,
                run.scanned_folders,
                run.imported_messages,
                command_started_at.elapsed().as_millis()
            )),
            Err(error) => eprintln!(
                "[better-email][sync] command failed account_id={account_id:?} error={error} duration_ms={}",
                command_started_at.elapsed().as_millis()
            ),
        }
        return result;
    }

    let started_at = Utc::now().to_rfc3339();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut synced_accounts = 0;
    let mut failures = Vec::new();
    let mut warnings = Vec::new();

    for account in accounts {
        match sync_headers_for_account(&store, &account, false) {
            Ok(run) => {
                scanned_folders += run.scanned_folders;
                imported_messages += run.imported_messages;
                synced_accounts += 1;
                if run.status.ends_with("_account_partial") {
                    warnings.push(format!("{}: {}", account.email, run.message));
                }
            }
            Err(error) => {
                eprintln!(
                    "[better-email][sync] account failed account_id={} email={} error={error}",
                    account.id,
                    mask_email(&account.email),
                );
                failures.push(format!("{}: {error}", account.email));
            }
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

    let result = store.record_sync_run(
        &started_at,
        &finished_at,
        status,
        scanned_folders,
        imported_messages,
        &message,
    );
    match &result {
        Ok(run) => command_info(format!(
            "[better-email][sync] command done account_id={account_id:?} status={} scanned_folders={} imported_messages={} synced_accounts={} failures={} warnings={} duration_ms={} message={}",
            run.status,
            run.scanned_folders,
            run.imported_messages,
            synced_accounts,
            failures.len(),
            warnings.len(),
            command_started_at.elapsed().as_millis(),
            run.message,
        )),
        Err(error) => eprintln!(
            "[better-email][sync] record failed account_id={account_id:?} error={error} duration_ms={}",
            command_started_at.elapsed().as_millis()
        ),
    }
    result
}

#[tauri::command]
pub async fn sync_imap_history(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let account = store.get_account_by_id(account_id)?;
    sync_headers_for_account(&store, &account, true)
}

fn sync_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        sync_pop3_headers_for_account(store, account, history_only)
    } else {
        sync_imap_headers_for_account(store, account, history_only)
    }
}

fn sync_pop3_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    let started_at = Utc::now().to_rfc3339();
    if history_only {
        let finished_at = Utc::now().to_rfc3339();
        let message = format!(
            "{} 使用 POP3 收信；POP3 无远端文件夹历史游标，本地收件箱同步已覆盖最近邮件。",
            account.email
        );
        return store.record_sync_run(
            &started_at,
            &finished_at,
            "pop3_history_complete",
            0,
            0,
            &message,
        );
    }

    let secret = store.get_account_secret(account)?;
    let messages = pop3_probe::fetch_recent_messages(account, &secret)?;
    let fetched_messages = messages.len() as i64;
    let imported_messages = store.import_pop3_messages(account.id, &messages)?;
    let finished_at = Utc::now().to_rfc3339();
    let message = format!(
        "{} POP3 同步完成：检查 {} 封最近邮件，新增 {} 封到收件箱。",
        account.email, fetched_messages, imported_messages
    );
    store.record_sync_run(
        &started_at,
        &finished_at,
        "pop3_headers_account",
        1,
        imported_messages,
        &message,
    )
}

fn sync_imap_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    let secret = store.get_account_secret(account)?;
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
pub async fn fetch_message_body(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    command_info(format!(
        "[better-email][body] fetch command start message_id={message_id}"
    ));
    let account = store.get_message_account(message_id)?;
    if is_pop3_account(&account) {
        command_info(format!(
            "[better-email][body] fetch command skipped pop3 message_id={} account_id={}",
            message_id, account.id
        ));
        return store.get_message(message_id);
    }
    let secret = store.get_account_secret(&account)?;
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        command_info(format!(
            "[better-email][body] fetch command missing remote ref message_id={} account_id={} mailbox={} uid={}",
            message_id, account.id, remote_mailbox, remote_uid
        ));
        return Err(crate::db::MailError::Imap(
            "该邮件没有远端 UID，无法按需拉取正文。".to_string(),
        ));
    }
    let body = imap_probe::fetch_message_body(&account, &secret, &remote_mailbox, remote_uid)?;
    let updated = store.update_message_body(message_id, &body)?;
    command_info(format!(
        "[better-email][body] fetch command ok message_id={} account_id={} mailbox={} uid={} body_chars={} html_chars={} attachments={}",
        message_id,
        account.id,
        remote_mailbox,
        remote_uid,
        updated.body.chars().count(),
        updated.sanitized_html.chars().count(),
        body.attachments.len()
    ));
    Ok(updated)
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
pub fn store_account_secret(
    store: State<'_, MailStore>,
    input: CredentialInput,
) -> CredentialStatus {
    command_info(format!(
        "[better-email][credential] store start email={} has_secret={}",
        mask_email(&input.account_email),
        !input.secret.trim().is_empty(),
    ));
    let status = match store.store_account_secret(&input.account_email, &input.secret) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: input.account_email.trim().to_ascii_lowercase(),
            exists: false,
            message: error.to_string(),
        },
    };
    command_info(format!(
        "[better-email][credential] store done email={} exists={} message={}",
        mask_email(&input.account_email),
        status.exists,
        status.message,
    ));
    status
}

#[tauri::command]
pub fn check_account_secret(
    store: State<'_, MailStore>,
    account_email: String,
) -> CredentialStatus {
    match store.check_account_secret(&account_email) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: account_email.trim().to_ascii_lowercase(),
            exists: false,
            message: error.to_string(),
        },
    }
}

#[tauri::command]
pub fn delete_account_secret(
    store: State<'_, MailStore>,
    account_email: String,
) -> CredentialStatus {
    command_info(format!(
        "[better-email][credential] delete start email={}",
        mask_email(&account_email),
    ));
    let status = match store.delete_account_secret(&account_email) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: account_email.trim().to_ascii_lowercase(),
            exists: false,
            message: error.to_string(),
        },
    };
    command_info(format!(
        "[better-email][credential] delete done email={} exists={} message={}",
        mask_email(&account_email),
        status.exists,
        status.message,
    ));
    status
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
            let status = store.store_account_secret(&session.account_email, &secret)?;
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
    let raw = store.get_account_secret_raw(&account)?;
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
    let status = store.store_account_secret(&account.email, &secret)?;
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
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地已更新；POP3 不支持远端已读状态回写。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
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
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地星标已更新；POP3 不支持远端星标回写。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
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
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地已移动；POP3 不支持远端移动，远端邮件保持不变。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
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
    if is_pop3_account(&account) {
        return Ok(local_only_report(format!(
            "{local_action}；POP3 不执行远端删除，远端邮件保持不变。"
        )));
    }
    let secret = match store.get_account_secret(&account) {
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

#[cfg(target_os = "windows")]
fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
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
        attachment_resume_offset, credential_error_report, credential_verification_report,
        format_attachment_progress, mask_email, mask_recipient_list, render_eml_message,
        sanitize_filename, syncable_mailboxes, validate_attachment_download_size,
        MAX_ATTACHMENT_DOWNLOAD_BYTES, MAX_ATTACHMENT_TRANSFER_BYTES,
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
            incoming_protocol: "imap".to_string(),
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
            message_id_header: "<export@example.com>".to_string(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
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
                content_id: String::new(),
                is_inline: false,
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
    fn attachment_resume_offset_keeps_only_safe_partial_files() {
        assert_eq!(attachment_resume_offset(64 * 1024), Some(64 * 1024));
        assert_eq!(
            attachment_resume_offset(MAX_ATTACHMENT_TRANSFER_BYTES as u64),
            Some(MAX_ATTACHMENT_TRANSFER_BYTES as usize)
        );
        assert_eq!(
            attachment_resume_offset(MAX_ATTACHMENT_TRANSFER_BYTES as u64 + 1),
            None
        );
        assert_eq!(format_attachment_progress(64 * 1024), "64 KB");
        assert_eq!(format_attachment_progress(3 * 1024 * 1024 / 2), "1.5 MB");
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
pub fn export_contacts_vcard(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<ContactExportSummary>> {
    let contacts = store.list_all_contacts()?;
    let payload = vcard::render_contacts(&contacts);
    let Some(target_path) = app
        .dialog()
        .file()
        .set_title("导出联系人 vCard")
        .set_file_name(format!(
            "better-email-contacts-{}.vcf",
            Utc::now().format("%Y%m%d-%H%M%S")
        ))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let target_path = target_path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析联系人导出路径：{error}")))?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, payload.as_bytes())?;
    Ok(Some(ContactExportSummary {
        path: target_path.to_string_lossy().into_owned(),
        contacts: contacts.len().min(i64::MAX as usize) as i64,
        size_bytes: payload.len().min(i64::MAX as usize) as i64,
    }))
}

#[tauri::command]
pub fn import_contacts_vcard(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<ContactImportSummary>> {
    let Some(source_path) = app
        .dialog()
        .file()
        .set_title("导入联系人 vCard")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source_path = source_path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析联系人导入路径：{error}")))?;
    let payload = fs::read(&source_path)?;
    if payload.is_empty() {
        return Err(crate::db::MailError::Imap(
            "vCard 文件为空，无法导入。".to_string(),
        ));
    }
    if payload.len() > MAX_VCARD_IMPORT_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "vCard 文件超过 {} MB 导入上限。",
            MAX_VCARD_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let raw = String::from_utf8(payload.clone())
        .map_err(|_| crate::db::MailError::Imap("vCard 文件不是有效的 UTF-8 文本。".to_string()))?;
    let parsed = vcard::parse_contacts(&raw);
    if parsed.contacts.is_empty() {
        return Err(crate::db::MailError::Imap(
            "vCard 中没有可导入的有效邮箱联系人。".to_string(),
        ));
    }
    let (created, updated) = store.import_contacts(parsed.contacts)?;
    Ok(Some(ContactImportSummary {
        path: source_path.to_string_lossy().into_owned(),
        total_cards: parsed.total_cards,
        created,
        updated,
        skipped: parsed.skipped,
        size_bytes: payload.len().min(i64::MAX as usize) as i64,
    }))
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
pub fn list_threads(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    limit: i64,
) -> MailResult<Vec<ThreadSummary>> {
    store.list_threads_for_scope_sorted(account_id, folder_id, query, filter, sort, limit)
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

#[tauri::command]
pub fn flush_outbox_dry_run(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    store.flush_outbox_dry_run()
}

#[tauri::command]
pub fn release_due_outbox_items(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    command_info("[better-email][send] release due outbox start");
    let outbox = store.release_due_outbox_items()?;
    command_info(format!(
        "[better-email][send] release due outbox done outbox_items={}",
        outbox.len(),
    ));
    Ok(outbox)
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
        let secret = match store.get_account_secret(&account) {
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
    let started_at = std::time::Instant::now();
    command_info("[better-email][send] flush smtp start");
    retry_pending_remote_archives(store.inner())?;

    for message in store.pending_outbox_messages()? {
        let account = store.get_account_by_id(Some(message.account_id))?;
        command_info(format!(
            "[better-email][send] smtp item start message_id={} account_id={} email={} to={} attachments={}",
            message.id,
            message.account_id,
            mask_email(&account.email),
            mask_recipient_list(&message.recipients),
            message.attachments.len(),
        ));
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                let blocked_error =
                    "缺少账号授权码，请在账号设置中重新保存授权码；已暂停自动发送。".to_string();
                eprintln!(
                    "[better-email][send] smtp item credential blocked message_id={} account_id={} email={} error={}",
                    message.id,
                    message.account_id,
                    mask_email(&account.email),
                    error,
                );
                store.mark_outbox_blocked(message.id, &blocked_error)?;
                continue;
            }
        };
        match smtp::send_outbound(&account, &message, &secret) {
            Ok(raw_message) => {
                let message_id_header = smtp::outbound_message_id(&message);
                store.mark_outbox_smtp_sent_pending_archive(message.id, &message_id_header)?;
                archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
                command_info(format!(
                    "[better-email][send] smtp item ok message_id={} account_id={}",
                    message.id, message.account_id,
                ));
            }
            Err(error) => {
                eprintln!(
                    "[better-email][send] smtp item failed message_id={} account_id={} error={}",
                    message.id, message.account_id, error,
                );
                store.mark_outbox_failed(message.id, &error.to_string())?;
            }
        }
    }

    let outbox = store.list_outbox()?;
    command_info(format!(
        "[better-email][send] flush smtp done outbox_items={} duration_ms={}",
        outbox.len(),
        started_at.elapsed().as_millis(),
    ));
    Ok(outbox)
}

#[tauri::command]
pub fn save_temp_attachment(
    app: AppHandle,
    filename: String,
    base64_data: String,
) -> MailResult<String> {
    use base64::prelude::*;
    let bytes = BASE64_STANDARD
        .decode(base64_data.trim())
        .map_err(|error| {
            crate::db::MailError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("Base64 解码失败：{error}"),
            ))
        })?;

    let data_dir = app.path().app_data_dir().map_err(|error| {
        crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            format!("获取数据目录失败：{error}"),
        ))
    })?;

    let temp_dir = data_dir.join("temp_attachments");
    std::fs::create_dir_all(&temp_dir)?;

    let unique_filename = format!(
        "{}_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        filename
    );
    let file_path = temp_dir.join(unique_filename);
    std::fs::write(&file_path, bytes)?;

    Ok(file_path.to_string_lossy().into_owned())
}
