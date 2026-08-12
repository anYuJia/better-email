#[cfg(target_os = "windows")]
use super::common::powershell_single_quote;
use super::common::{
    attachment_resume_offset, format_attachment_progress, mime_type_for_path,
    prompt_save_file_path, sanitize_filename, validate_attachment_download_size,
    MAX_ATTACHMENT_DOWNLOAD_BYTES, MAX_EML_IMPORT_BYTES,
};
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{Attachment, AttachmentDownload, Message, OutboundAttachmentInput};
use base64::Engine as _;
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

/// 发件附件授权与大小限制：
/// - 单附件上限与下载侧一致（25 MB），避免一次读入超大文件。
/// - 总大小上限：单封邮件附件总量 100 MB，防止一次外发大量数据。
const MAX_OUTBOUND_ATTACHMENT_BYTES: i64 = 25 * 1024 * 1024;
const MAX_OUTBOUND_TOTAL_BYTES: i64 = 100 * 1024 * 1024;

/// 校验并授权一个发件附件路径。
///
/// - canonicalize 解析符号链接并归一化，得到真实文件路径。
/// - 只允许常规文件（拒绝目录、设备等）。
/// - 单附件大小上限。
/// - 写入授权表：发送时按 canonical path + size 重新校验，未授权路径或
///   symlink/文件替换导致的路径/大小变化都会被拒绝。
fn authorize_outbound_path(
    store: &MailStore,
    path: &Path,
    running_total: i64,
) -> MailResult<OutboundAttachmentInput> {
    let canonical = fs::canonicalize(path).map_err(|error| {
        crate::db::MailError::Io(std::io::Error::new(
            error.kind(),
            format!("无法解析附件路径：{error}"),
        ))
    })?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "附件必须是常规文件，不支持目录或特殊文件。".to_string(),
        )));
    }
    let size_bytes = metadata.len().min(i64::MAX as u64) as i64;
    if size_bytes > MAX_OUTBOUND_ATTACHMENT_BYTES {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "附件超过大小上限（{size_bytes} 字节 > {} 字节）。",
                MAX_OUTBOUND_ATTACHMENT_BYTES
            ),
        )));
    }
    if running_total.saturating_add(size_bytes) > MAX_OUTBOUND_TOTAL_BYTES {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "一封邮件附件总大小超过上限（{} 字节）。",
                MAX_OUTBOUND_TOTAL_BYTES
            ),
        )));
    }
    store.register_outbound_attachment_auth(
        &canonical.to_string_lossy(),
        size_bytes,
    )?;
    let filename = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "attachment".to_string());
    Ok(OutboundAttachmentInput {
        filename,
        mime_type: mime_type_for_path(&canonical),
        size_bytes,
        local_path: canonical.to_string_lossy().into_owned(),
        content_id: String::new(),
        is_inline: false,
    })
}

/// 发送前对单个附件做最终校验：canonical path 与 size 必须匹配授权记录，
/// 且磁盘上仍是相同大小的常规文件（拦截 symlink/文件替换 TOCTOU）。
pub fn validate_outbound_attachment(store: &MailStore, attachment: &Attachment) -> MailResult<()> {
    if attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Smtp(
            "附件没有本地路径，无法读取。".to_string(),
        ));
    }
    let canonical = fs::canonicalize(&attachment.local_path).map_err(|error| {
        crate::db::MailError::Smtp(format!(
            "附件路径无法解析（可能已被移动或删除）：{error}"
        ))
    })?;
    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(crate::db::MailError::Smtp(
            "附件不再是常规文件，已拒绝发送。".to_string(),
        ));
    }
    let current_size = metadata.len().min(i64::MAX as u64) as i64;
    if current_size != attachment.size_bytes {
        return Err(crate::db::MailError::Smtp(format!(
            "附件大小与授权不一致（现在 {current_size} 字节，授权 {} 字节），可能已被替换，已拒绝发送。",
            attachment.size_bytes
        )));
    }
    if !store.is_outbound_attachment_authorized(&canonical.to_string_lossy(), current_size)? {
        return Err(crate::db::MailError::Smtp(format!(
            "附件未经授权或已过期：{}",
            attachment.local_path
        )));
    }
    Ok(())
}

/// 创建应用受管理的附件临时目录（Unix 上收紧为 0700）。已存在时也检查并收紧。
fn ensure_private_attachment_dir(store: &MailStore, message_id: i64) -> MailResult<PathBuf> {
    let temp_dir = store.attachment_dir(message_id);
    fs::create_dir_all(&temp_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&temp_dir) {
            if metadata.permissions().mode() & 0o077 != 0 {
                let _ = fs::set_permissions(&temp_dir, fs::Permissions::from_mode(0o700));
            }
        }
    }
    Ok(temp_dir)
}

/// 断点续传既有临时文件在打开前的安全检查：必须是受管目录内的常规文件；
/// 权限过宽时直接收紧为 0600；大小超过传输上限则删除重建（从零开始）。
fn private_resume_offset(path: &Path) -> MailResult<usize> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(0),
    };
    if !metadata.is_file() {
        // 目录/设备等异常条目：删除后从零开始，绝不 append 写入。
        let _ = fs::remove_file(path);
        return Ok(0);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
    }
    Ok(attachment_resume_offset(metadata.len()).unwrap_or_else(|| {
        let _ = fs::remove_file(path);
        0
    }))
}

/// 打开/创建断点续传临时文件：Unix 上创建时直接使用 0600，不以宽权限创建后再 chmod。
fn open_private_attachment_file(path: &Path) -> MailResult<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut options = OpenOptions::new();
        options.create(true).append(true).mode(0o600);
        if path.exists() {
            // 既有文件打开前再次收紧权限，防止继承过宽 umask 产生的 0644。
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }
        options.open(path).map_err(Into::into)
    }
    #[cfg(not(unix))]
    {
        Ok(OpenOptions::new().create(true).append(true).open(path)?)
    }
}

/// 创建解码临时文件：Unix 上直接以 0600 创建。
fn create_private_file(path: &Path) -> MailResult<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        Ok(OpenOptions::new().create(true).write(true).truncate(true).mode(0o600).open(path)?)
    }
    #[cfg(not(unix))]
    {
        Ok(File::create(path)?)
    }
}

#[tauri::command]
pub fn list_attachments(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Vec<Attachment>> {
    store.list_attachments(message_id)
}

/// 附件读取路径安全校验：canonicalize 解析符号链接后，必须位于应用受管理
/// 附件目录或用户配置的下载目录内，否则拒绝（防符号链接/.. 绕过，阻止外部
/// 备份借 attachment id 读取 /etc/passwd、SSH key 等任意文件）。
pub(crate) fn validated_attachment_read_path(
    store: &MailStore,
    attachment: &Attachment,
) -> MailResult<PathBuf> {
    if !attachment.is_downloaded || attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "附件尚未下载到本地。",
        )));
    }
    let canonical = fs::canonicalize(&attachment.local_path).map_err(|error| {
        crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("附件文件不可用：{error}"),
        ))
    })?;
    let managed_root = store.attachment_root();
    let download_dir = store.resolve_download_dir()?;
    if !canonical.starts_with(&managed_root) && !canonical.starts_with(&download_dir) {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "附件路径不在受管目录内，已拒绝读取。".to_string(),
        )));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn read_attachment_data_url(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    let path = validated_attachment_read_path(&store, &attachment)?;
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

    let Some(target_path) =
        prompt_save_file_path(&app, "另存图片", sanitize_filename(&filename), None)?
    else {
        return Err(crate::db::MailError::Cancelled);
    };

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, payload)?;
    Ok(format!("图片已另存为 {}", target_path.to_string_lossy()))
}

#[tauri::command]
pub async fn pick_outbound_attachments(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Vec<OutboundAttachmentInput>> {
    let Some(paths) = app
        .dialog()
        .file()
        .set_title("选择附件")
        .blocking_pick_files()
    else {
        return Ok(Vec::new());
    };

    let mut running_total = 0_i64;
    let mut inputs = Vec::new();
    for path in paths {
        let path = path
            .into_path()
            .map_err(|error| {
                crate::db::MailError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("无法解析附件路径：{error}"),
                ))
            })?;
        let input = authorize_outbound_path(&store, &path, running_total)?;
        running_total = running_total.saturating_add(input.size_bytes);
        inputs.push(input);
    }
    Ok(inputs)
}

#[tauri::command]
pub fn outbound_attachments_from_paths(
    store: State<'_, MailStore>,
    paths: Vec<String>,
) -> MailResult<Vec<OutboundAttachmentInput>> {
    let mut running_total = 0_i64;
    let mut inputs = Vec::new();
    // 顺手清理过期的发件附件授权记录，避免无界增长。
    let _ = store.cleanup_outbound_attachment_auths(30);
    for path in paths.into_iter().filter(|path| !path.trim().is_empty()) {
        let input = authorize_outbound_path(&store, &PathBuf::from(path), running_total)?;
        running_total = running_total.saturating_add(input.size_bytes);
        inputs.push(input);
    }
    Ok(inputs)
}

#[tauri::command]
pub async fn download_attachment(
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<AttachmentDownload> {
    let attachment = store.get_attachment(attachment_id)?;
    download_attachment_file(&store, &attachment)
}

pub fn download_attachment_file(
    store: &MailStore,
    attachment: &Attachment,
) -> MailResult<AttachmentDownload> {
    let account = store.get_message_account(attachment.message_id)?;
    let secret = store.get_account_secret(&account)?;
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(attachment.message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Err(crate::db::MailError::Imap(
            "该附件所属邮件没有远端 UID，无法下载附件文件。".to_string(),
        ));
    }
    validate_attachment_download_size(attachment.size_bytes)?;

    // 用户配置的下载目录只存放最终完成的附件文件；断点续传与解码临时文件
    // 放回应用受管理的缓存目录，避免在用户目录中写 .download/.decoded。
    let final_dir = store.resolve_download_dir()?;
    fs::create_dir_all(&final_dir)?;
    let temp_dir = ensure_private_attachment_dir(store, attachment.message_id)?;
    let temp_path = temp_dir.join(format!("{}.download", attachment.id));
    // 断点续传既有临时文件在打开前检查：受管目录内的常规文件、权限收紧、
    // 大小未超限；异常文件删除后从零开始。
    let resume_offset = private_resume_offset(&temp_path)?;
    let mut output = open_private_attachment_file(&temp_path)?;
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
    let decoded_path = temp_dir.join(format!("{}.decoded", attachment.id));
    let (local_path, decoded_size) = match downloaded.transfer_encoding {
        imap_probe::AttachmentTransferEncoding::Identity => {
            if let Err(error) = validate_attachment_download_size(downloaded.size_bytes) {
                let _ = fs::remove_file(&temp_path);
                return Err(error);
            }
            let local_path = copy_download_to_user_dir(&temp_path, &final_dir, &filename)?;
            // 已成功落盘到用户目录，清理断点临时文件。
            let _ = fs::remove_file(&temp_path);
            (local_path, downloaded.size_bytes)
        }
        transfer_encoding => {
            let decode_result = (|| -> MailResult<i64> {
                let mut source = BufReader::new(File::open(&temp_path)?);
                let decoded_file = create_private_file(&decoded_path)?;
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
            let local_path = copy_download_to_user_dir(&decoded_path, &final_dir, &filename)?;
            let _ = fs::remove_file(&temp_path);
            let _ = fs::remove_file(&decoded_path);
            (local_path, decoded_size)
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

pub struct AutoDownloadOutcome {
    pub downloaded: usize,
    pub failures: usize,
}

pub fn auto_download_attachments_for_message(
    store: &MailStore,
    message_id: i64,
) -> AutoDownloadOutcome {
    let mut outcome = AutoDownloadOutcome {
        downloaded: 0,
        failures: 0,
    };
    let Ok(attachments) = store.list_attachments(message_id) else {
        return outcome;
    };
    for attachment in attachments {
        if attachment.is_inline || attachment.is_downloaded {
            continue;
        }
        match download_attachment_file(store, &attachment) {
            Ok(_) => outcome.downloaded += 1,
            Err(error) => {
                crate::logging::log_line(format!(
                    "[better-email][attachment] auto download failed message_id={} attachment_id={} filename={} error={error}",
                    message_id,
                    attachment.id,
                    attachment.filename
                ));
                outcome.failures += 1;
            }
        }
    }
    outcome
}

#[allow(deprecated)]
#[tauri::command]
pub fn open_attachment(
    app: AppHandle,
    store: State<'_, MailStore>,
    attachment_id: i64,
) -> MailResult<String> {
    let attachment = store.get_attachment(attachment_id)?;
    let path = validated_attachment_read_path(&store, &attachment)?;
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
    let path = validated_attachment_read_path(&store, &attachment)?;

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
    let path = validated_attachment_read_path(&store, &attachment)?;

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

    let source_path = validated_attachment_read_path(&store, &attachment)?;

    // 另存为对话框初始目录为配置的默认附件下载位置；用户显式更改则以用户选择为准。
    let initial_dir = store.resolve_download_dir().ok();
    let Some(target_path) = prompt_save_file_path(
        &app,
        "另存附件",
        sanitize_filename(&attachment.filename),
        initial_dir.as_deref(),
    )?
    else {
        return Err(crate::db::MailError::Cancelled);
    };

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&source_path, &target_path)?;
    let target = target_path.to_string_lossy().into_owned();
    Ok(format!("附件已另存为 {target}"))
}

#[tauri::command]
pub async fn export_message_as_eml(
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
pub async fn import_eml_file(
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

/// 清洗将要写入 RFC 822 header 的动态字段：移除 `\r` 与 `\n`。
///
/// subject、sender、recipients、cc、bcc、date、account_email 都来自数据库或
/// 远端邮件头，可能是不可信内容；任何残留的换行都可能被解析成额外 header 行，
/// 从而伪造 `Bcc:`、`X-Injected:` 等。清洗后再 trim，确保一个字段永远不会
/// 产生多于一行 header。
fn sanitize_eml_header_value(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch != '\r' && ch != '\n' {
            sanitized.push(ch);
        }
    }
    sanitized.trim().to_string()
}

fn render_eml_message(message: &Message, attachments: &[Attachment]) -> String {
    let subject = if message.subject.trim().is_empty() {
        "(无主题)".to_string()
    } else {
        sanitize_eml_header_value(&message.subject)
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
    // 附件元信息属于正文，不经过 header 清洗；正文换行保持原样。
    format!(
        "From: {} <{}>\r\nTo: {}\r\n{}{}Subject: {}\r\nDate: {}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\nX-Better Email-Account: {}\r\n\r\n{}{}",
        sanitize_eml_header_value(&message.sender_name),
        sanitize_eml_header_value(&message.sender_email),
        sanitize_eml_header_value(&message.recipients),
        optional_header("Cc", &message.cc),
        optional_header("Bcc", &message.bcc),
        subject,
        sanitize_eml_header_value(&message.received_at),
        sanitize_eml_header_value(&message.account_email),
        body.replace('\n', "\r\n"),
        attachment_note
    )
}

fn optional_header(name: &str, value: &str) -> String {
    let sanitized = sanitize_eml_header_value(value);
    if sanitized.is_empty() {
        String::new()
    } else {
        format!("{name}: {sanitized}\r\n")
    }
}

#[tauri::command]
pub fn save_temp_attachment(
    app: AppHandle,
    store: State<'_, MailStore>,
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
    if bytes.len().min(i64::MAX as usize) as i64 > MAX_OUTBOUND_ATTACHMENT_BYTES {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "附件超过大小上限（{} 字节 > {} 字节）。",
                bytes.len(),
                MAX_OUTBOUND_ATTACHMENT_BYTES
            ),
        )));
    }

    let data_dir = app.path().app_data_dir().map_err(|error| {
        crate::db::MailError::Io(std::io::Error::other(format!("获取数据目录失败：{error}")))
    })?;

    let temp_dir = data_dir.join("temp_attachments");
    std::fs::create_dir_all(&temp_dir)?;

    let unique_filename = format!(
        "{}_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        sanitize_filename(&filename)
    );
    let file_path = temp_dir.join(unique_filename);
    std::fs::write(&file_path, &bytes)?;
    let canonical = fs::canonicalize(&file_path)?;
    store.register_outbound_attachment_auth(
        &canonical.to_string_lossy(),
        bytes.len().min(i64::MAX as usize) as i64,
    )?;

    Ok(canonical.to_string_lossy().into_owned())
}

/// 按「文件名、文件名 (1).ext、文件名 (2).ext…」返回第 index 个候选文件名。
fn candidate_name(filename: &str, index: u64) -> String {
    if index == 0 {
        return filename.to_string();
    }
    let (stem, extension) = split_extension(filename);
    if extension.is_empty() {
        format!("{stem} ({index})")
    } else {
        format!("{stem} ({index}).{extension}")
    }
}

/// 在同名文件已存在时不覆盖，而是按「文件名、文件名 (1).ext、文件名 (2).ext…」
/// 追加序号返回一个当前尚未占用的目标路径。
#[cfg(test)]
pub(crate) fn unique_download_path(dir: &Path, filename: &str) -> PathBuf {
    let mut index = 0_u64;
    loop {
        let candidate = dir.join(candidate_name(filename, index));
        if !candidate.exists() {
            return candidate;
        }
        index += 1;
    }
}

/// 把已完成的下载结果安全落到用户配置目录：
/// - 用 create_new(true) 原子占用最终文件名，绝不对已存在的用户文件做截断或覆盖；
/// - 与已有文件冲突时按「文件名 (1).ext」追加序号重试，消除「先检查再落盘」的并发窗口；
/// - 失败时只清理本次调用创建的目标文件。
fn copy_download_to_user_dir(source: &Path, dir: &Path, filename: &str) -> MailResult<PathBuf> {
    use std::io::ErrorKind;
    fs::create_dir_all(dir)?;
    let mut index = 0_u64;
    loop {
        let candidate = dir.join(candidate_name(filename, index));
        let mut dest = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(dest) => dest,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                index += 1;
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        let copy_result = (|| -> std::io::Result<()> {
            let mut src = File::open(source)?;
            std::io::copy(&mut src, &mut dest)?;
            dest.sync_all()
        })();
        if let Err(error) = copy_result {
            let _ = fs::remove_file(&candidate);
            return Err(error.into());
        }
        return Ok(candidate);
    }
}

fn split_extension(filename: &str) -> (String, String) {
    match filename.rsplit_once('.') {
        Some((stem, extension)) if !extension.is_empty() && !stem.is_empty() => {
            (stem.to_string(), extension.to_string())
        }
        _ => (filename.to_string(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_outbound_path, create_private_file, ensure_private_attachment_dir,
        open_private_attachment_file, private_resume_offset, render_eml_message, split_extension,
        unique_download_path, validate_outbound_attachment, MAX_OUTBOUND_TOTAL_BYTES,
    };
    use crate::models::{Attachment, Message};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DATABASE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_database_path() -> std::path::PathBuf {
        let unique = TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "better-email-download-dir-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("test data dir created");
        dir.join("better-email.sqlite3")
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
    fn eml_export_strips_crlf_from_header_fields_to_block_injection() {
        // 所有写入 RFC822 header 的动态字段都必须移除 \r \n，
        // 否则构造出的 EML 会被解析出伪造的 Bcc: / X-Injected: 等 header。
        let message = Message {
            id: 1,
            account_id: 1,
            account_email: "me@example.com\r\nX-Better Email-Account: forged".to_string(),
            folder_id: 1,
            folder_role: "inbox".to_string(),
            sender_name: "Ada\r\nX-Injected: sender".to_string(),
            sender_email: "ada@example.com".to_string(),
            recipients: "me@example.com\r\nBcc: victim@example.com".to_string(),
            cc: "team@example.com".to_string(),
            bcc: "secret@example.com\r\nX-Bcc-Injected: true".to_string(),
            subject: "Hi\r\nBcc: forged@example.com".to_string(),
            snippet: "Snippet".to_string(),
            body: "第一行\n第二行\nX-Injected: body-only".to_string(),
            sanitized_html: String::new(),
            security_warnings: Vec::new(),
            received_at: "2026-07-09T10:00:00+08:00".to_string(),
            is_read: true,
            is_starred: false,
            has_attachments: false,
            snoozed_until: String::new(),
            labels: Vec::new(),
            attachment_count: 0,
            remote_mailbox: "INBOX".to_string(),
            remote_uid: 1,
            message_id_header: String::new(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
        };
        let eml = render_eml_message(&message, &[]);

        // 不得出现任何伪造的 header 行。
        assert!(!eml.contains("\r\nBcc: forged@example.com"));
        assert!(!eml.contains("\r\nBcc: victim@example.com"));
        assert!(!eml.contains("\r\nX-Injected: sender"));
        assert!(!eml.contains("\r\nX-Injected: forged"));
        assert!(!eml.contains("\r\nX-Better Email-Account: forged"));
        assert!(!eml.contains("\r\nX-Bcc-Injected: true"));

        // 动态值被清洗（移除换行后保留内容），合法 header 仍然完整。
        assert!(eml.contains("From: AdaX-Injected: sender <ada@example.com>"));
        assert!(eml.contains("To: me@example.comBcc: victim@example.com"));
        assert!(eml.contains("Bcc: secret@example.comX-Bcc-Injected: true"));
        assert!(eml.contains("Subject: HiBcc: forged@example.com"));
        assert!(
            eml.contains("X-Better Email-Account: me@example.comX-Better Email-Account: forged")
        );

        // 正文换行保持不变；正文中的“注入”内容只是正文，不属于 header。
        assert!(eml.contains("第一行\r\n第二行\r\nX-Injected: body-only"));
        let body_section = eml
            .split_once("\r\n\r\n")
            .expect("body follows the header block");
        assert!(
            body_section.1.contains("X-Injected: body-only"),
            "正文中的注入内容原样保留在正文区"
        );
    }

    #[test]
    fn unique_path_avoids_clobbering_existing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();

        // 不存在时直接使用原名。
        let first = unique_download_path(root, "report.pdf");
        assert_eq!(first, root.join("report.pdf"));

        // 创建后应追加序号 (1)。
        std::fs::write(&first, b"a").expect("write first");
        let second = unique_download_path(root, "report.pdf");
        assert_eq!(second, root.join("report (1).pdf"));

        // 连续同名应继续递增 (2)、(3)。
        std::fs::write(&second, b"b").expect("write second");
        let third = unique_download_path(root, "report.pdf");
        assert_eq!(third, root.join("report (2).pdf"));

        // 无扩展名文件同样追加序号。
        std::fs::write(root.join("LICENSE"), b"x").expect("write LICENSE");
        assert_eq!(
            unique_download_path(root, "LICENSE"),
            root.join("LICENSE (1)")
        );
    }

    #[test]
    fn split_extension_handles_dotted_and_bare_names() {
        assert_eq!(
            split_extension("report.pdf"),
            ("report".to_string(), "pdf".to_string())
        );
        assert_eq!(
            split_extension("archive.tar.gz"),
            ("archive.tar".to_string(), "gz".to_string())
        );
        assert_eq!(
            split_extension(".gitignore"),
            (".gitignore".to_string(), String::new())
        );
        assert_eq!(
            split_extension("LICENSE"),
            ("LICENSE".to_string(), String::new())
        );
    }

    #[test]
    fn download_resolution_and_unique_path_drive_configured_directory() {
        // 手动/自动下载都会先 resolve_download_dir 再经 unique_download_path 落盘：
        // 这里直接验证两者组合会落在用户配置目录，而非数据库缓存目录。
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let custom_dir = std::env::temp_dir().join("better-email-download-uses-config");
        store
            .validate_and_save_download_dir(&custom_dir.to_string_lossy())
            .expect("save custom download dir");
        let dir = store.resolve_download_dir().expect("resolve");
        let target = unique_download_path(&dir, "报告.pdf");
        assert_eq!(target, custom_dir.join("报告.pdf"), "下载应落在配置目录");
        let _ = std::fs::remove_dir_all(&custom_dir);
    }

    #[test]
    fn final_download_copy_never_overwrites_or_touches_user_files() {
        // 用户目录中预置哨兵：同名最终文件、旧式 {id}.download / {id}.decoded。
        let temp = tempfile::tempdir().expect("tempdir");
        let user_dir = temp.path().join("downloads");
        std::fs::create_dir_all(&user_dir).expect("user dir created");

        let source = temp.path().join("source.bin");
        std::fs::write(&source, b"downloaded-content").expect("source written");

        let final_sentinel = user_dir.join("report.pdf");
        let download_sentinel = user_dir.join("7.download");
        let decoded_sentinel = user_dir.join("7.decoded");
        std::fs::write(&final_sentinel, b"final-sentinel").expect("final sentinel");
        std::fs::write(&download_sentinel, b"download-sentinel").expect("download sentinel");
        std::fs::write(&decoded_sentinel, b"decoded-sentinel").expect("decoded sentinel");

        let target = super::copy_download_to_user_dir(&source, &user_dir, "report.pdf")
            .expect("copy succeeds");
        assert_eq!(
            target.file_name().and_then(|name| name.to_str()),
            Some("report (1).pdf"),
            "同名最终文件应追加序号而非覆盖"
        );
        // 预置的哨兵文件必须原样保留。
        assert_eq!(std::fs::read(&final_sentinel).unwrap(), b"final-sentinel");
        assert_eq!(
            std::fs::read(&download_sentinel).unwrap(),
            b"download-sentinel"
        );
        assert_eq!(
            std::fs::read(&decoded_sentinel).unwrap(),
            b"decoded-sentinel"
        );
        // 新落盘内容正确。
        assert_eq!(std::fs::read(&target).unwrap(), b"downloaded-content");
    }

    #[test]
    fn download_temp_files_live_in_managed_cache_not_user_dir() {
        // 断点续传与解码临时文件必须留在应用受管理缓存目录，而不是用户下载目录。
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let user_dir = std::env::temp_dir().join("better-email-user-downloads");
        store
            .validate_and_save_download_dir(&user_dir.to_string_lossy())
            .expect("save custom download dir");
        let resolved = store.resolve_download_dir().expect("resolve");
        assert_eq!(resolved, user_dir);

        let temp_download = store.attachment_dir(1234).join("56.download");
        let temp_decoded = store.attachment_dir(1234).join("56.decoded");
        assert!(
            !temp_download.starts_with(&user_dir),
            "断点文件不得写入用户下载目录"
        );
        assert!(
            !temp_decoded.starts_with(&user_dir),
            "解码文件不得写入用户下载目录"
        );
        let _ = std::fs::remove_dir_all(&user_dir);
    }

    fn sample_attachment(filename: &str, local_path: &str, size_bytes: i64) -> Attachment {
        Attachment {
            id: 1,
            message_id: 1,
            filename: filename.to_string(),
            mime_type: "application/octet-stream".to_string(),
            size_bytes,
            is_downloaded: true,
            local_path: local_path.to_string(),
            content_id: String::new(),
            is_inline: false,
        }
    }

    #[test]
    fn outbound_attachment_requires_prior_authorization() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-auth-test-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("secret.txt");
        std::fs::write(&file, b"sensitive content").unwrap();

        // 未授权路径：直接引用敏感系统文件不应通过发送前校验。
        let attachment = sample_attachment("secret.txt", &file.to_string_lossy(), 17);
        let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "未授权路径应被拒绝：{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn outbound_attachment_valid_authorized_path_passes() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-auth-ok-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("report.pdf");
        std::fs::write(&file, b"authorized attachment content").unwrap();

        // 授权后：校验通过，且能读取内容。
        let input = authorize_outbound_path(&store, &file, 0).expect("authorized");
        let attachment = sample_attachment("report.pdf", &input.local_path, input.size_bytes);
        validate_outbound_attachment(&store, &attachment).expect("validated");
        assert!(store
            .is_outbound_attachment_authorized(&input.local_path, input.size_bytes)
            .unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn outbound_attachment_rejects_symlink_swap_after_authorization() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-auth-symlink-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.bin");
        std::fs::write(&original, b"benign payload").unwrap();
        let input = authorize_outbound_path(&store, &original, 0).expect("authorized");

        // 授权后把原文件替换为指向敏感文件的符号链接：canonicalize 会解析到目标，
        // 授权记录按 canonical path 匹配，因此校验必须失败。
        let _ = std::fs::remove_file(&original);
        let sensitive = dir.join("passwd");
        std::fs::write(&sensitive, b"root:x:0:0").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&sensitive, &original).unwrap();

        let attachment = sample_attachment("original.bin", &input.local_path, input.size_bytes);
        #[cfg(unix)]
        {
            let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
            assert!(
                err.to_string().contains("未经授权")
                    || err.to_string().contains("大小与授权不一致"),
                "symlink 替换应被拒绝：{err}"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn outbound_attachment_rejects_size_change_after_authorization() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-auth-size-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("data.bin");
        std::fs::write(&file, b"12345").unwrap();
        let input = authorize_outbound_path(&store, &file, 0).expect("authorized");

        // 授权后文件被替换成不同大小的内容：校验必须失败。
        std::fs::write(&file, b"1234567890").unwrap();
        let attachment = sample_attachment("data.bin", &input.local_path, input.size_bytes);
        let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
        assert!(
            err.to_string().contains("大小与授权不一致"),
            "大小变化应被拒绝：{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn outbound_attachment_total_size_limit_is_enforced() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-auth-total-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        // 两个小文件足以让 total 超限（通过把 running_total 设为接近上限）。
        let file = dir.join("a.bin");
        std::fs::write(&file, b"a").unwrap();
        let err = authorize_outbound_path(&store, &file, MAX_OUTBOUND_TOTAL_BYTES).unwrap_err();
        assert!(
            err.to_string().contains("总大小超过上限"),
            "总大小超限应被拒绝：{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn download_temp_files_use_private_unix_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let message_id = 777;
        let temp_dir = ensure_private_attachment_dir(&store, message_id).expect("temp dir");
        assert_eq!(
            fs::metadata(&temp_dir).unwrap().permissions().mode() & 0o777,
            0o700,
            "附件临时目录应为 0700"
        );

        let download_path = temp_dir.join("1.download");
        let decoded_path = temp_dir.join("1.decoded");
        let _download = open_private_attachment_file(&download_path).expect("download file");
        let _decoded = create_private_file(&decoded_path).expect("decoded file");
        assert_eq!(
            fs::metadata(&download_path).unwrap().permissions().mode() & 0o777,
            0o600,
            ".download 临时文件应为 0600"
        );
        assert_eq!(
            fs::metadata(&decoded_path).unwrap().permissions().mode() & 0o777,
            0o600,
            ".decoded 临时文件应为 0600"
        );
    }

    #[cfg(unix)]
    #[test]
    fn existing_wide_permission_resume_file_is_tightened() {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let message_id = 778;
        let temp_dir = ensure_private_attachment_dir(&store, message_id).expect("temp dir");
        let download_path = temp_dir.join("2.download");
        // 模拟历史版本以宽权限（0644）创建的断点文件。
        let file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o644)
            .open(&download_path)
            .unwrap();
        file.set_len(42).unwrap();
        drop(file);

        let offset = private_resume_offset(&download_path).expect("resume offset");
        assert_eq!(offset, 42, "常规大小的断点文件应返回可续传偏移");
        assert_eq!(
            fs::metadata(&download_path).unwrap().permissions().mode() & 0o777,
            0o600,
            "既有断点文件打开前应收紧为 0600"
        );
    }
}
