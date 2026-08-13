#[cfg(target_os = "windows")]
use super::common::powershell_single_quote;
use super::common::{
    attachment_resume_offset, format_attachment_progress, mime_type_for_path,
    prompt_save_file_path, read_file_with_limit, sanitize_filename,
    validate_attachment_download_size, MAX_ATTACHMENT_DOWNLOAD_BYTES, MAX_EML_IMPORT_BYTES,
};
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{Attachment, AttachmentDownload, Message, OutboundAttachmentInput};
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

/// 发件附件授权与大小限制：
/// - 单附件上限与下载侧一致（25 MB），避免一次读入超大文件。
/// - 总大小上限：单封邮件附件总量 100 MB，防止一次外发大量数据。
const MAX_OUTBOUND_ATTACHMENT_BYTES: i64 = 25 * 1024 * 1024;
pub(crate) const MAX_OUTBOUND_TOTAL_BYTES: i64 = 100 * 1024 * 1024;

/// base64 编码长度上限：N 字节解码结果最多需要 4*ceil(N/3) 字符，
/// 超过该长度即可在解码前安全拒绝，避免恶意输入先被整体解码到内存。
fn max_base64_encoded_len(max_decoded_bytes: usize) -> usize {
    max_decoded_bytes.div_ceil(3) * 4
}

/// 校验并授权一个发件附件路径。
///
/// - canonicalize 解析符号链接并归一化，得到真实文件路径。
/// - 只允许常规文件（拒绝目录、设备等）。
/// - 单附件大小上限。
/// - 将用户选取的内容复制到应用私有目录并授权该副本。发送时只读取私有
///   副本，因此路径、大小相同但内容不同的原文件替换无法影响邮件内容。
pub(crate) fn authorize_outbound_path(
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
    let filename = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "attachment".to_string());
    let private_path =
        copy_to_private_outbound_attachment(store, &canonical, &filename, size_bytes)?;
    let private_size = fs::metadata(&private_path)?.len().min(i64::MAX as u64) as i64;
    let digest = file_sha256(&private_path, private_size)?;
    store.register_outbound_attachment_auth(
        &private_path.to_string_lossy(),
        private_size,
        &digest,
    )?;
    Ok(OutboundAttachmentInput {
        filename,
        mime_type: mime_type_for_path(&private_path),
        size_bytes: private_size,
        local_path: private_path.to_string_lossy().into_owned(),
        content_id: String::new(),
        is_inline: false,
    })
}

/// 单次打开、读取并验证发件附件。返回的字节是 SMTP/MIME 唯一允许使用的附件
/// 内容，避免「先校验摘要、再按路径重新读取」之间的 TOCTOU 窗口。
pub(crate) fn read_verified_outbound_attachment(
    store: &MailStore,
    attachment: &Attachment,
) -> MailResult<Vec<u8>> {
    if attachment.local_path.trim().is_empty() {
        return Err(crate::db::MailError::Smtp(
            "附件没有本地路径，无法读取。".to_string(),
        ));
    }
    let link_metadata = fs::symlink_metadata(&attachment.local_path).map_err(|error| {
        crate::db::MailError::Smtp(format!("附件路径无法读取（可能已被移动或删除）：{error}"))
    })?;
    if link_metadata.file_type().is_symlink() {
        return Err(crate::db::MailError::Smtp(
            "附件路径不能是符号链接，已拒绝发送。".to_string(),
        ));
    }
    let canonical = fs::canonicalize(&attachment.local_path).map_err(|error| {
        crate::db::MailError::Smtp(format!("附件路径无法解析（可能已被移动或删除）：{error}"))
    })?;
    let mut file = open_outbound_attachment_file(&canonical)?;
    let metadata = file.metadata()?;
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
    if current_size > MAX_OUTBOUND_ATTACHMENT_BYTES {
        return Err(crate::db::MailError::Smtp(
            "附件超过大小上限，已拒绝发送。".to_string(),
        ));
    }
    let mut bytes = Vec::with_capacity(current_size.max(0) as usize);
    let mut digest = Sha256::new();
    let mut read_total = 0_i64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        read_total = read_total.saturating_add(read.min(i64::MAX as usize) as i64);
        if read_total > MAX_OUTBOUND_ATTACHMENT_BYTES {
            return Err(crate::db::MailError::Smtp(
                "附件在读取期间超过大小上限，已拒绝发送。".to_string(),
            ));
        }
        digest.update(&buffer[..read]);
        bytes.extend_from_slice(&buffer[..read]);
    }
    if read_total != current_size {
        return Err(crate::db::MailError::Smtp(
            "附件在读取期间发生变化，已拒绝发送。".to_string(),
        ));
    }
    let digest = sha256_hex(digest.finalize());
    let authorized_in_table = store.is_outbound_attachment_authorized(
        &canonical.to_string_lossy(),
        current_size,
        &digest,
    )?;
    // 转发/回填等流程会引用应用「实际下载」的源附件：仅当该具体文件存在于
    // 已下载附件数据库记录（is_downloaded=1 且大小一致，所属邮件非草稿/发件箱）
    // 时才放行。绝不能因文件恰好位于受管附件目录或用户下载目录等宽目录就放行
    // 任意文件——用户下载目录可能是 Downloads/Home 等，目录内任意文件必须被拒绝。
    let source_attachment =
        store.is_downloaded_source_attachment(&canonical, current_size, &digest)?;
    if !authorized_in_table && !source_attachment {
        return Err(crate::db::MailError::Smtp(format!(
            "附件未经授权或已过期：{}",
            attachment.local_path
        )));
    }
    Ok(bytes)
}

/// 发送前对单个附件做最终校验。实际 SMTP/MIME 发送必须使用
/// `read_verified_outbound_attachment` 返回的同一批字节。
pub fn validate_outbound_attachment(store: &MailStore, attachment: &Attachment) -> MailResult<()> {
    read_verified_outbound_attachment(store, attachment).map(|_| ())
}

fn file_sha256(path: &Path, expected_size: i64) -> MailResult<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut read_total = 0_i64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        read_total = read_total.saturating_add(read.min(i64::MAX as usize) as i64);
        if read_total > MAX_OUTBOUND_ATTACHMENT_BYTES {
            return Err(crate::db::MailError::Smtp(
                "附件超过大小上限，已拒绝发送。".to_string(),
            ));
        }
        digest.update(&buffer[..read]);
    }
    if read_total != expected_size {
        return Err(crate::db::MailError::Smtp(
            "附件在读取期间发生变化，已拒绝发送。".to_string(),
        ));
    }
    Ok(sha256_hex(digest.finalize()))
}

fn sha256_hex(bytes: impl AsRef<[u8]>) -> String {
    let bytes = bytes.as_ref();
    let mut encoded = String::with_capacity(bytes.len() * 2);
    use std::fmt::Write as _;
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

fn open_outbound_attachment_file(path: &Path) -> MailResult<File> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .map_err(Into::into)
    }
    #[cfg(not(unix))]
    {
        File::open(path).map_err(Into::into)
    }
}

fn copy_to_private_outbound_attachment(
    store: &MailStore,
    source: &Path,
    filename: &str,
    expected_size: i64,
) -> MailResult<PathBuf> {
    let directory = store.outbound_attachment_dir();
    ensure_private_temp_dir(&directory)?;
    let safe_filename = sanitize_filename(filename);
    for _ in 0..16 {
        let destination = directory.join(format!("{}-{safe_filename}", Uuid::new_v4().simple()));
        match copy_private_file_new(source, &destination, expected_size) {
            Ok(()) => return fs::canonicalize(&destination).map_err(Into::into),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    Err(crate::db::MailError::Io(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "无法为附件创建唯一私有副本。",
    )))
}

fn copy_private_file_new(
    source: &Path,
    destination: &Path,
    expected_size: i64,
) -> std::io::Result<()> {
    #[cfg(unix)]
    let mut output = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(destination)?
    };
    #[cfg(not(unix))]
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;

    let result = (|| -> std::io::Result<()> {
        let mut input = File::open(source)?;
        let copied = std::io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        if copied.min(i64::MAX as u64) as i64 != expected_size {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "附件在复制期间发生变化。",
            ));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

/// 校验一批发件附件的声明总大小不超限（与授权时一致的上限）。
fn enforce_outbound_total_size(attachments: impl Iterator<Item = i64>) -> MailResult<()> {
    let running_total = attachments
        .map(|size| size.max(0))
        .fold(0_i64, i64::saturating_add);
    if running_total > MAX_OUTBOUND_TOTAL_BYTES {
        return Err(crate::db::MailError::Smtp(format!(
            "一封邮件附件总大小超过上限（{running_total} 字节 > {} 字节）。",
            MAX_OUTBOUND_TOTAL_BYTES
        )));
    }
    Ok(())
}

/// 保存/发送前对 IPC 传入的发件附件执行与「正常发送」一致的全部校验：
/// canonical 常规文件、大小与声明一致、单附件/总大小上限、授权表匹配。
/// 仅校验带文件名的条目（与 DB 持久化逻辑一致，空文件名条目不会落库）。
pub(crate) fn validate_outbound_attachment_inputs(
    store: &MailStore,
    attachments: &[OutboundAttachmentInput],
) -> MailResult<()> {
    for attachment in attachments {
        if attachment.filename.trim().is_empty() {
            continue;
        }
        let db_attachment = Attachment {
            id: 0,
            message_id: 0,
            filename: attachment.filename.clone(),
            mime_type: attachment.mime_type.clone(),
            size_bytes: attachment.size_bytes,
            is_downloaded: true,
            local_path: attachment.local_path.clone(),
            content_id: attachment.content_id.clone(),
            is_inline: attachment.is_inline,
        };
        validate_outbound_attachment(store, &db_attachment)?;
    }
    enforce_outbound_total_size(
        attachments
            .iter()
            .filter(|attachment| !attachment.filename.trim().is_empty())
            .map(|attachment| attachment.size_bytes),
    )
}

/// 发送前校验持久化的发件邮件附件声明总大小（每条已由 validate_outbound_attachment 校验）。
pub(crate) fn validate_outbound_message_total_size(
    message: &crate::models::OutboundMessage,
) -> MailResult<()> {
    enforce_outbound_total_size(
        message
            .attachments
            .iter()
            .map(|attachment| attachment.size_bytes),
    )
}

/// 返回与 `message.attachments` 同序、且已经在单次打开读取中验证过的附件字节。
/// 调用方必须把它直接传入 SMTP/MIME 渲染函数，绝不再由路径读取附件。
pub(crate) fn read_verified_outbound_message_attachments(
    store: &MailStore,
    message: &crate::models::OutboundMessage,
) -> MailResult<Vec<Vec<u8>>> {
    validate_outbound_message_total_size(message)?;
    message
        .attachments
        .iter()
        .map(|attachment| read_verified_outbound_attachment(store, attachment))
        .collect()
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
        Ok(OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?)
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
    // 受管目录与用户下载目录也做 canonicalize：macOS 的 /var→/private/var 等
    // 符号链接若不归一化，会误伤合法路径。
    let managed_root = store.attachment_root();
    let download_dir = store.resolve_download_dir()?;
    let allowed_roots = [
        managed_root.canonicalize().unwrap_or(managed_root),
        download_dir.canonicalize().unwrap_or(download_dir),
    ];
    if !allowed_roots.iter().any(|root| canonical.starts_with(root)) {
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
    // 解码前先按编码长度限制，避免恶意超长 payload 先被整体解码到内存。
    let encoded_len = encoded.len();
    let max_encoded_len = max_base64_encoded_len(MAX_ATTACHMENT_DOWNLOAD_BYTES as usize);
    if encoded_len > max_encoded_len {
        return Err(crate::db::MailError::Imap(format!(
            "图片数据超过大小上限（编码长度 {encoded_len} 字节 > {max_encoded_len} 字节）。"
        )));
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
    // 顺手清理过期的发件附件授权记录，避免无界增长。
    let _ = store.cleanup_outbound_attachment_auths(30);
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
        let path = path.into_path().map_err(|error| {
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
    let (payload, skipped_attachments) = render_eml_message(&store, &message, &attachments)?;
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
    let mut message = format!("邮件已导出为 {}", target_path.to_string_lossy());
    if skipped_attachments > 0 {
        message.push_str(&format!(
            "（{skipped_attachments} 个附件尚未下载，未包含在导出中）"
        ));
    }
    Ok(message)
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
    // 先 metadata 预检，再按上限流式读取，避免超大 EML 被整体读入内存。
    let payload = read_file_with_limit(&path, MAX_EML_IMPORT_BYTES)?;
    if payload.is_empty() {
        return Err(crate::db::MailError::Imap(
            "EML 文件为空，无法导入。".to_string(),
        ));
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

/// EML 导出附件的读取上限：与下载侧一致，超过则拒绝导出该附件。
const MAX_EML_EXPORT_ATTACHMENT_BYTES: usize = MAX_ATTACHMENT_DOWNLOAD_BYTES as usize;

/// 校验并清理用于 EML 导出 Content-Type 的 media type。
/// 非法值（含 CR/LF、控制字符、非法 token、异常参数）一律回退到
/// application/octet-stream，防止经 IPC/数据库进入的 mime_type 注入额外 RFC 822 header。
fn safe_media_type_for_export(mime: &str) -> String {
    const FALLBACK: &str = "application/octet-stream";
    let trimmed = mime.trim();
    if trimmed.is_empty() {
        return FALLBACK.to_string();
    }
    // 控制字符（含 \r \n）直接拒绝。
    if trimmed.chars().any(|ch| ch.is_control()) {
        return FALLBACK.to_string();
    }
    // 只取第一个分号前的 type/subtype，忽略所有参数。
    let type_subtype = trimmed.split(';').next().unwrap_or_default().trim();
    let Some((type_name, subtype)) = type_subtype.split_once('/') else {
        return FALLBACK.to_string();
    };
    let valid_token = |token: &str| {
        !token.is_empty()
            && token.len() <= 127
            && token.chars().all(|ch| {
                ch.is_ascii_alphanumeric()
                    || matches!(
                        ch,
                        '-' | '.'
                            | '_'
                            | '+'
                            | '#'
                            | '!'
                            | '$'
                            | '&'
                            | '^'
                            | '*'
                            | '='
                            | '{'
                            | '}'
                            | '|'
                            | '~'
                            | '\''
                    )
            })
    };
    if !valid_token(type_name) || !valid_token(subtype) {
        return FALLBACK.to_string();
    }
    format!("{type_name}/{subtype}")
}

/// 渲染导出用的 RFC 822 邮件字节：
/// - 不包含 Bcc、本地绝对路径或内部账户信息（如账号邮箱）；
/// - 已下载附件以标准 multipart/mixed 与 base64 嵌入二进制内容；
/// - 未下载附件被跳过，并在返回的 usize 中报告数量，由调用方在 UI/结果中明确说明。
/// - 所有动态 header（From/To/Cc/Subject/Date/Content-Type/Content-Disposition/boundary）
///   都经过清理，杜绝 CRLF / 非法 MIME 值注入额外 header。
fn render_eml_message(
    store: &MailStore,
    message: &Message,
    attachments: &[Attachment],
) -> MailResult<(Vec<u8>, usize)> {
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
    let downloaded = attachments
        .iter()
        .filter(|attachment| attachment.is_downloaded && !attachment.local_path.trim().is_empty())
        .collect::<Vec<_>>();
    let skipped = attachments.len() - downloaded.len();

    let mut header = String::new();
    header.push_str(&format!(
        "From: {} <{}>\r\n",
        sanitize_eml_display_name(&message.sender_name),
        sanitize_eml_display_name(&message.sender_email),
    ));
    header.push_str(&format!(
        "To: {}\r\n",
        sanitize_eml_header_value(&message.recipients)
    ));
    header.push_str(&optional_header("Cc", &message.cc));
    // 刻意不导出 Bcc、本地绝对路径与内部账户信息。
    header.push_str(&format!("Subject: {subject}\r\n"));
    header.push_str(&format!(
        "Date: {}\r\n",
        sanitize_eml_header_value(&message.received_at)
    ));
    header.push_str("MIME-Version: 1.0\r\n");

    let body_text = body.replace('\n', "\r\n");
    if downloaded.is_empty() {
        header.push_str("Content-Type: text/plain; charset=utf-8\r\n");
        header.push_str("Content-Transfer-Encoding: 8bit\r\n\r\n");
        let mut output = header.into_bytes();
        output.extend_from_slice(body_text.as_bytes());
        output.extend_from_slice(b"\r\n");
        return Ok((output, skipped));
    }

    // boundary：仅字母数字与连字符，无 CRLF，附带毫秒时间戳增强碰撞防护。
    let boundary = format!(
        "better-email-export-{}-{}",
        message.id,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    header.push_str(&format!(
        "Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"
    ));
    let mut output = header.into_bytes();
    let mut push = |text: &str| output.extend_from_slice(text.as_bytes());

    push(&format!("--{boundary}\r\n"));
    push("Content-Type: text/plain; charset=utf-8\r\n");
    push("Content-Transfer-Encoding: 8bit\r\n\r\n");
    push(&body_text);
    push("\r\n");

    for attachment in downloaded {
        let path = validated_attachment_read_path(store, attachment)?;
        let bytes = read_file_with_limit(&path, MAX_EML_EXPORT_ATTACHMENT_BYTES)?;
        let filename = sanitize_eml_header_value(&sanitize_filename(&attachment.filename))
            .replace(['"', '\\'], "_");
        let mime_type = if attachment.mime_type.trim().is_empty()
            || attachment
                .mime_type
                .eq_ignore_ascii_case("application/octet-stream")
        {
            mime_type_for_path(&path)
        } else {
            safe_media_type_for_export(&attachment.mime_type)
        };
        push(&format!("--{boundary}\r\n"));
        push(&format!("Content-Type: {mime_type}\r\n"));
        push(&format!(
            "Content-Disposition: attachment; filename=\"{filename}\"\r\n"
        ));
        push("Content-Transfer-Encoding: base64\r\n\r\n");
        push(&base64_mime_payload(&bytes));
        push("\r\n");
    }
    push(&format!("--{boundary}--\r\n"));
    Ok((output, skipped))
}

/// 清洗写进 `From:` 的显示名/邮箱：移除 CR/LF 以及会破坏 mailbox 语法的 `<`、`>`、`"`。
fn sanitize_eml_display_name(value: &str) -> String {
    sanitize_eml_header_value(value)
        .chars()
        .filter(|ch| !matches!(ch, '<' | '>' | '"'))
        .collect()
}

/// 把二进制附件内容转成 MIME 允许的 base64 文本（每行 76 字符，CRLF 结尾）。
fn base64_mime_payload(bytes: &[u8]) -> String {
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mut lines = String::with_capacity(encoded.len() + encoded.len().div_ceil(76) + 1);
    for chunk in encoded.as_bytes().chunks(76) {
        // chunks(76) 边界永远是 ASCII base64 字符，from_utf8 不会失败。
        lines.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        lines.push_str("\r\n");
    }
    lines
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
    // 解码前先按编码长度限制：base64 长度 ≤ 4*ceil(N/3)，超过即解码结果必然超限，
    // 避免恶意输入先被整体解码到内存再被截断。
    let encoded_len = base64_data.trim().len();
    let max_encoded_len = max_base64_encoded_len(MAX_OUTBOUND_ATTACHMENT_BYTES as usize);
    if encoded_len > max_encoded_len {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "附件 Base64 数据超过大小上限（编码长度 {encoded_len} 字节 > {max_encoded_len} 字节）。"
            ),
        )));
    }
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
    ensure_private_temp_dir(&temp_dir)?;

    let file_path = create_private_temp_attachment_file(&temp_dir, &filename, &bytes)?;
    let canonical = fs::canonicalize(&file_path)?;
    let digest = file_sha256(&canonical, bytes.len().min(i64::MAX as usize) as i64)?;
    store.register_outbound_attachment_auth(
        &canonical.to_string_lossy(),
        bytes.len().min(i64::MAX as usize) as i64,
        &digest,
    )?;

    Ok(canonical.to_string_lossy().into_owned())
}

/// 创建粘贴/拖入附件的私有临时目录；Unix 下收紧为 0700（即使已存在也重新收紧）。
fn ensure_private_temp_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// 使用不可预测 UUID 和 create_new 原子创建，避免并发同名附件相互覆盖。
fn create_private_temp_attachment_file(
    directory: &Path,
    filename: &str,
    bytes: &[u8],
) -> std::io::Result<PathBuf> {
    let safe_filename = sanitize_filename(filename);
    for _ in 0..16 {
        let path = directory.join(format!("{}-{safe_filename}", Uuid::new_v4().simple()));
        match write_private_temp_file(&path, bytes) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "无法为临时附件创建唯一文件。",
    ))
}

/// 以 0600（Unix）原子创建临时附件文件，避免宽权限与并发覆盖。
fn write_private_temp_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)?;
        file.write_all(bytes)?;
        file.sync_all()
    }
}

/// 清理不再被任何草稿/发件箱/待归档邮件引用的临时附件（TTL=0，立即删除）。
/// IPC 不接受任何路径参数：只删除后端确认位于 temp_attachment_dir 且未被数据库
/// 引用的文件，绝不允许按任意路径删除。
#[tauri::command]
pub fn cleanup_temp_attachments(store: State<'_, MailStore>) -> MailResult<usize> {
    store.prune_temp_attachments(std::time::Duration::from_secs(0))
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
        authorize_outbound_path, create_private_file, create_private_temp_attachment_file,
        ensure_private_attachment_dir, ensure_private_temp_dir, max_base64_encoded_len,
        open_private_attachment_file, private_resume_offset, read_verified_outbound_attachment,
        render_eml_message, split_extension, unique_download_path, validate_outbound_attachment,
        validate_outbound_attachment_inputs, MAX_OUTBOUND_TOTAL_BYTES,
    };
    use crate::db::MailStore;
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

    fn sample_message() -> Message {
        Message {
            id: 1,
            account_id: 1,
            account_email: "me@example.com".to_string(),
            folder_id: 1,
            folder_role: "inbox".to_string(),
            sender_name: "Ada".to_string(),
            sender_email: "ada@example.com".to_string(),
            recipients: "me@example.com".to_string(),
            cc: "team@example.com".to_string(),
            bcc: "hidden@example.com".to_string(),
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
        }
    }

    #[test]
    fn renders_plain_eml_without_bcc_or_internal_account_info() {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        let (eml, skipped) =
            render_eml_message(&store, &sample_message(), &[]).expect("eml renders");

        let rendered = String::from_utf8_lossy(&eml).to_string();
        assert!(rendered.contains("From: Ada <ada@example.com>"));
        assert!(rendered.contains("To: me@example.com"));
        assert!(rendered.contains("Cc: team@example.com"));
        assert!(!rendered.contains("Bcc:"), "导出不得包含 Bcc：{rendered}");
        assert!(
            !rendered.contains("X-Better Email-Account"),
            "导出不得包含内部账户信息：{rendered}"
        );
        assert!(!rendered.contains("me@example.com\r\nX"));
        assert!(rendered.contains("Hello\r\nworld"));
        assert_eq!(skipped, 0);
    }

    #[test]
    fn eml_export_embeds_downloaded_attachments_and_skips_missing_ones() {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        // 已下载附件：写入受管附件目录，导出应嵌入其二进制内容。
        let managed_dir = store.attachment_dir(1);
        fs::create_dir_all(&managed_dir).unwrap();
        let downloaded_path = managed_dir.join("brief.bin");
        fs::write(&downloaded_path, b"attachment-binary-payload").unwrap();
        let downloaded = Attachment {
            id: 1,
            message_id: 1,
            filename: "brief.bin".to_string(),
            mime_type: "application/octet-stream".to_string(),
            size_bytes: 25,
            is_downloaded: true,
            local_path: downloaded_path.to_string_lossy().into_owned(),
            content_id: String::new(),
            is_inline: false,
        };
        let missing = Attachment {
            id: 2,
            message_id: 1,
            filename: "not-downloaded.txt".to_string(),
            mime_type: "text/plain".to_string(),
            size_bytes: 4,
            is_downloaded: false,
            local_path: String::new(),
            content_id: String::new(),
            is_inline: false,
        };

        let (eml, skipped) = render_eml_message(&store, &sample_message(), &[downloaded, missing])
            .expect("eml renders");
        assert_eq!(skipped, 1, "未下载附件应被跳过并报告数量");
        let rendered = String::from_utf8_lossy(&eml).to_string();
        assert!(rendered.contains("multipart/mixed"));
        assert!(rendered.contains("Content-Disposition: attachment; filename=\"brief.bin\""));
        assert!(
            rendered.contains("YXR0YWNobWVudC1iaW5hcnktcGF5bG9hZA"),
            "已下载附件的二进制内容应以 base64 嵌入：{rendered}"
        );
        assert!(
            !rendered.contains("not-downloaded.txt"),
            "未下载附件不应出现在导出中：{rendered}"
        );
        assert!(
            !rendered.contains(&downloaded_path.to_string_lossy().into_owned()),
            "导出不得包含本地绝对路径：{rendered}"
        );
    }

    #[test]
    fn eml_export_strips_crlf_from_header_fields_to_block_injection() {
        // 所有写入 RFC822 header 的动态字段都必须移除 \r \n，
        // 否则构造出的 EML 会被解析出伪造的 Bcc: / X-Injected: 等 header。
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        let message = Message {
            account_email: "me@example.com\r\nX-Better Email-Account: forged".to_string(),
            sender_name: "Ada\r\nX-Injected: sender".to_string(),
            sender_email: "ada@example.com".to_string(),
            recipients: "me@example.com\r\nBcc: victim@example.com".to_string(),
            cc: "team@example.com".to_string(),
            bcc: "secret@example.com\r\nX-Bcc-Injected: true".to_string(),
            subject: "Hi\r\nBcc: forged@example.com".to_string(),
            body: "第一行\n第二行\nX-Injected: body-only".to_string(),
            ..sample_message()
        };
        let (eml, _) = render_eml_message(&store, &message, &[]).expect("eml renders");
        let rendered = String::from_utf8_lossy(&eml).to_string();

        // 不得出现任何伪造的 header 行；Bcc 与内部账户 header 整行不导出。
        assert!(!rendered.contains("\r\nBcc: forged@example.com"));
        assert!(!rendered.contains("\r\nBcc: victim@example.com"));
        assert!(!rendered.contains("Bcc: secret@example.com"));
        assert!(
            !rendered.lines().any(|line| line.starts_with("Bcc:")),
            "任何一行都不得以 Bcc: 开头：{rendered}"
        );
        assert!(!rendered.contains("\r\nX-Injected: sender"));
        assert!(!rendered.contains("\r\nX-Injected: forged"));
        assert!(!rendered.contains("\r\nX-Better Email-Account: forged"));
        assert!(!rendered.contains("\r\nX-Bcc-Injected: true"));

        // 动态值被清洗（移除换行后保留内容），合法 header 仍然完整。
        assert!(rendered.contains("From: AdaX-Injected: sender <ada@example.com>"));
        assert!(rendered.contains("To: me@example.comBcc: victim@example.com"));
        assert!(rendered.contains("Subject: HiBcc: forged@example.com"));

        // 正文换行保持不变；正文中的“注入”内容只是正文，不属于 header。
        assert!(rendered.contains("第一行\r\n第二行\r\nX-Injected: body-only"));
        let body_section = rendered
            .split_once("\r\n\r\n")
            .expect("body follows the header block");
        assert!(
            body_section.1.contains("X-Injected: body-only"),
            "正文中的注入内容原样保留在正文区"
        );
    }

    #[test]
    fn eml_export_rejects_mime_type_header_injection() {
        // attachment.mime_type 可经 IPC/数据库进入：CRLF 或非法 MIME 值必须回退到
        // application/octet-stream，绝不能在 Content-Type 中注入额外 RFC 822 header。
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        let managed_dir = store.attachment_dir(1);
        fs::create_dir_all(&managed_dir).unwrap();
        let downloaded_path = managed_dir.join("evil.bin");
        fs::write(&downloaded_path, b"payload").unwrap();
        let size = fs::metadata(&downloaded_path).unwrap().len() as i64;

        let cases = [
            "text/plain\r\nBcc: attacker@example.com",
            "text/plain\nX-Injected: yes",
            "application/pdf\r\nContent-Disposition: attachment; filename=\"evil\"",
            "text/plain; boundary=\"injected\r\nBcc: x@example.com\"",
            "text/plain/extra",
            "application/octet-stream;\r\nBcc: y@example.com",
            "text/plain\x00null-byte",
        ];
        for malicious_mime in cases {
            let attachment = Attachment {
                id: 1,
                message_id: 1,
                filename: "evil.bin".to_string(),
                mime_type: malicious_mime.to_string(),
                size_bytes: size,
                is_downloaded: true,
                local_path: downloaded_path.to_string_lossy().into_owned(),
                content_id: String::new(),
                is_inline: false,
            };
            let (eml, _) = render_eml_message(&store, &sample_message(), &[attachment])
                .unwrap_or_else(|error| panic!("mime={malicious_mime:?} 应可渲染：{error}"));
            let rendered = String::from_utf8_lossy(&eml).to_string();
            // 注入的 header 不得作为独立 header 行出现。
            assert!(
                !rendered.contains("\r\nBcc: attacker@example.com"),
                "mime={malicious_mime:?} 不得注入 Bcc：{rendered}"
            );
            assert!(
                !rendered.contains("\r\nX-Injected: yes"),
                "mime={malicious_mime:?} 不得注入 X-Injected：{rendered}"
            );
            assert!(
                !rendered.contains("Bcc: x@example.com")
                    && !rendered.contains("Bcc: y@example.com"),
                "mime={malicious_mime:?} 不得注入任意 Bcc：{rendered}"
            );
            // 非法 MIME 回退到 application/octet-stream。
            assert!(
                rendered.contains("Content-Type: application/octet-stream\r\n"),
                "mime={malicious_mime:?} 应回退到 octet-stream：{rendered}"
            );
        }

        // 合法 MIME 保留（含参数时仅保留 type/subtype）。
        let ok_attachment = Attachment {
            id: 2,
            message_id: 1,
            filename: "ok.txt".to_string(),
            mime_type: "text/plain; charset=utf-8".to_string(),
            size_bytes: size,
            is_downloaded: true,
            local_path: downloaded_path.to_string_lossy().into_owned(),
            content_id: String::new(),
            is_inline: false,
        };
        let (eml, _) = render_eml_message(&store, &sample_message(), &[ok_attachment]).expect("ok");
        let rendered = String::from_utf8_lossy(&eml).to_string();
        // 附件部分的 Content-Type 只保留 type/subtype，不携带参数（正文部分的 charset 不受影响）。
        assert!(
            rendered.contains(
                "Content-Type: text/plain\r\nContent-Disposition: attachment; filename=\"ok.txt\""
            ),
            "导出仅保留 type/subtype：{rendered}"
        );
    }

    #[test]
    fn eml_export_sanitizes_display_name_and_filename_headers() {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        let managed_dir = store.attachment_dir(1);
        fs::create_dir_all(&managed_dir).unwrap();
        let downloaded_path = managed_dir.join("weird.bin");
        fs::write(&downloaded_path, b"payload").unwrap();
        let size = fs::metadata(&downloaded_path).unwrap().len() as i64;

        let mut message = sample_message();
        message.sender_name = "A<b>\"c\"\r\nX-Injected: name".to_string();
        let attachment = Attachment {
            id: 1,
            message_id: 1,
            filename:
                "evil\"quoted\"\\backslash.bin\r\nContent-Disposition: attachment; filename=\"x\""
                    .to_string(),
            mime_type: "application/octet-stream".to_string(),
            size_bytes: size,
            is_downloaded: true,
            local_path: downloaded_path.to_string_lossy().into_owned(),
            content_id: String::new(),
            is_inline: false,
        };
        let (eml, _) = render_eml_message(&store, &message, &[attachment]).expect("render");
        let rendered = String::from_utf8_lossy(&eml).to_string();
        // From 显示名不得包含 < > " 或注入换行。
        assert!(!rendered.contains("\r\nX-Injected: name"));
        assert!(
            rendered.contains("From: AbcX-Injected: name <ada@example.com>"),
            "显示名中的 < > \" 应被清洗：{rendered}"
        );
        // Content-Disposition 文件名中的引号/反斜杠/换行不得形成新 header。
        assert!(!rendered.contains("\r\nContent-Disposition: attachment; filename=\"x\""));
        assert!(
            rendered.contains("filename=\"evil_quoted__backslash.bin__Content-Disposition_ attachment; filename=_x_\""),
            "文件名中的控制字符/引号/反斜杠应被清洗：{rendered}"
        );
    }

    #[test]
    fn base64_encoded_length_guard_rejects_oversized_payloads_before_decode() {
        // base64 长度 > 4*ceil(MAX/3) 时，解码结果必然超过上限。
        let max_decoded = 25 * 1024 * 1024;
        let max_encoded = max_base64_encoded_len(max_decoded);
        assert_eq!(max_encoded, 34_952_536);
        // 恰好处于编码上限内、解码后正好等于上限的最大合法长度。
        assert!(max_base64_encoded_len(max_decoded - 1) <= max_base64_encoded_len(max_decoded));
        // 编码长度再多 1 个字符对应的解码结果必然超限。
        assert!(max_encoded + 1 > (max_decoded * 4) / 3);
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
    fn file_in_wide_download_dir_is_not_forwardable_without_db_record() {
        // 用户下载目录可能是 Downloads/Home 等宽目录：目录内任意文件仍不能外发，
        // 除非该具体文件存在「已下载源附件」数据库记录或授权记录。
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let wide_dir = std::env::temp_dir().join(format!(
            "better-email-wide-download-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        store
            .validate_and_save_download_dir(&wide_dir.to_string_lossy())
            .expect("save wide download dir");
        fs::create_dir_all(&wide_dir).unwrap();
        let file = wide_dir.join("secret-from-home.txt");
        fs::write(&file, b"private file in downloads").unwrap();
        let size = fs::metadata(&file).unwrap().len() as i64;

        // 位于宽下载目录、但没有任何授权/源附件记录：必须拒绝。
        let input = outbound_input("secret-from-home.txt", &file.to_string_lossy(), size);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "宽下载目录内无记录文件不得外发：{err}"
        );

        // 同一目录内由后端登记授权（原生选择器）的具体文件：允许。
        let authorized = authorize_outbound_path(&store, &file, 0).expect("authorized via picker");
        let input = outbound_input(
            "secret-from-home.txt",
            &authorized.local_path,
            authorized.size_bytes,
        );
        validate_outbound_attachment_inputs(&store, &[input]).expect("authorized file allowed");
        let _ = std::fs::remove_dir_all(&wide_dir);
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
        let digest = super::file_sha256(std::path::Path::new(&input.local_path), input.size_bytes)
            .expect("digest");
        assert!(store
            .is_outbound_attachment_authorized(&input.local_path, input.size_bytes, &digest)
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

        // 外部原文件已不参与发送：授权时后端已复制出私有副本。替换原路径必须
        // 不会影响私有副本；随后再尝试替换私有副本，验证必须拒绝。
        let _ = std::fs::remove_file(&original);
        let sensitive = dir.join("passwd");
        std::fs::write(&sensitive, b"root:x:0:0").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&sensitive, &original).unwrap();

        let attachment = sample_attachment("original.bin", &input.local_path, input.size_bytes);
        #[cfg(unix)]
        {
            validate_outbound_attachment(&store, &attachment)
                .expect("外部路径替换不得影响私有授权副本");
            let _ = std::fs::remove_file(&input.local_path);
            std::os::unix::fs::symlink(&sensitive, &input.local_path).unwrap();
            let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
            assert!(
                err.to_string().contains("符号链接"),
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

        // 外部源文件替换不会影响私有副本；替换私有副本本身才必须被拒绝。
        std::fs::write(&file, b"1234567890").unwrap();
        let attachment = sample_attachment("data.bin", &input.local_path, input.size_bytes);
        validate_outbound_attachment(&store, &attachment)
            .expect("外部路径替换不得影响私有授权副本");
        std::fs::write(&input.local_path, b"1234567890").unwrap();
        let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
        assert!(
            err.to_string().contains("大小与授权不一致"),
            "大小变化应被拒绝：{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn outbound_attachment_rejects_same_size_content_replacement() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let source_dir = std::env::temp_dir().join(format!(
            "better-email-auth-content-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("report.bin");
        fs::write(&source, b"AAAA").unwrap();
        let input = authorize_outbound_path(&store, &source, 0).expect("authorized");

        // 攻击者替换的是后端私有副本的同一路径、相同长度、不同内容。摘要绑定
        // 必须拒绝，不能只检查 canonical path 和大小。
        fs::write(&input.local_path, b"BBBB").unwrap();
        let attachment = sample_attachment("report.bin", &input.local_path, input.size_bytes);
        let err = validate_outbound_attachment(&store, &attachment).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "同大小内容替换必须被摘要校验拒绝：{err}"
        );
        let _ = fs::remove_dir_all(&source_dir);
    }

    #[test]
    fn verified_attachment_bytes_remain_safe_after_path_replacement() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let source_dir = std::env::temp_dir().join(format!(
            "better-email-auth-toctou-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("report.bin");
        fs::write(&source, b"safe").unwrap();
        let input = authorize_outbound_path(&store, &source, 0).expect("authorized");
        let attachment = sample_attachment("report.bin", &input.local_path, input.size_bytes);

        let verified = read_verified_outbound_attachment(&store, &attachment).expect("verified");
        fs::write(&input.local_path, b"evil").unwrap();
        let message = crate::models::OutboundMessage {
            id: 7,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "TOCTOU".to_string(),
            body: "body".to_string(),
            html_body: String::new(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![attachment],
        };
        let rendered = crate::smtp::render_outbound_with_attachment_bytes(&message, &[verified])
            .expect("rendered from verified bytes");
        let rendered = String::from_utf8_lossy(&rendered);
        assert!(rendered.contains("safe"));
        assert!(!rendered.contains("evil"));
        let _ = fs::remove_dir_all(&source_dir);
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

    fn outbound_input(
        filename: &str,
        local_path: &str,
        size_bytes: i64,
    ) -> crate::models::OutboundAttachmentInput {
        crate::models::OutboundAttachmentInput {
            filename: filename.to_string(),
            mime_type: "application/octet-stream".to_string(),
            size_bytes,
            local_path: local_path.to_string(),
            content_id: String::new(),
            is_inline: false,
        }
    }

    #[test]
    fn unauthorized_attachment_input_is_rejected_even_with_zero_size() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-input-auth-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let sensitive = dir.join("sensitive.txt");
        std::fs::write(&sensitive, b"private content").unwrap();
        let real_size = std::fs::metadata(&sensitive).unwrap().len() as i64;

        // size_bytes=0 不得绕过校验：非空文件声明为 0 会被大小一致性检查拒绝。
        let input = outbound_input("sensitive.txt", &sensitive.to_string_lossy(), 0);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("大小与授权不一致"),
            "size_bytes=0 不得跳过大小校验：{err}"
        );

        // 声明大小与真实一致但仍未授权：授权表匹配必须拒绝。
        let input = outbound_input("sensitive.txt", &sensitive.to_string_lossy(), real_size);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "已匹配大小但未授权路径应被拒绝：{err}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn authorized_attachment_input_passes() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        let dir = std::env::temp_dir().join(format!(
            "better-email-input-ok-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("report.pdf");
        std::fs::write(&file, b"authorized content").unwrap();
        let input = authorize_outbound_path(&store, &file, 0).expect("authorized");

        // 已授权输入通过校验。
        validate_outbound_attachment_inputs(&store, &[input]).expect("validated");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backend_downloaded_source_attachment_is_forwardable() {
        // 转发/回填引用的是应用「实际下载」的源附件：文件与数据库中的
        // 已下载附件记录（is_downloaded=1）绑定后放行，而不是按目录放行。
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        store
            .create_account(crate::models::AccountCreateInput {
                email: "src@example.com".to_string(),
                display_name: "Source".to_string(),
                provider: "Local".to_string(),
                imap_host: "imap.example.com:993".to_string(),
                smtp_host: "smtp.example.com:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .expect("account created");

        // 导入一封带附件的历史邮件（进入收件箱，附件未下载）。
        let raw_eml = b"From: sender@example.com\r\n\
            To: me@example.com\r\n\
            Subject: Source mail\r\n\
            MIME-Version: 1.0\r\n\
            Content-Type: multipart/mixed; boundary=\"abc123\"\r\n\r\n\
            --abc123\r\n\
            Content-Type: text/plain\r\n\
            Content-Transfer-Encoding: 8bit\r\n\r\n\
            Hello body\r\n\
            --abc123\r\n\
            Content-Type: application/octet-stream\r\n\
            Content-Disposition: attachment; filename=\"downloaded.bin\"\r\n\
            Content-Transfer-Encoding: base64\r\n\r\n\
            RG93bmxvYWRlZC1jb250ZW50\r\n\
            --abc123--\r\n";
        let message = store.import_eml_message(None, raw_eml).expect("import eml");
        let attachments = store
            .list_attachments(message.id)
            .expect("list attachments");
        assert!(!attachments.is_empty(), "导入邮件应带附件");

        // 后端把该附件实际下载到受管附件目录并记录 is_downloaded=1。
        let managed_dir = store.attachment_dir(message.id);
        fs::create_dir_all(&managed_dir).unwrap();
        let file = managed_dir.join("downloaded.bin");
        fs::write(&file, b"Downloaded-Content").unwrap();
        let size = fs::metadata(&file).unwrap().len() as i64;
        store
            .mark_attachment_downloaded(attachments[0].id, &file.to_string_lossy(), size)
            .expect("mark downloaded");

        // 转发引用该已下载源附件：无需授权表记录，但因存在 DB 源附件记录而放行。
        let input = outbound_input("downloaded.bin", &file.to_string_lossy(), size);
        validate_outbound_attachment_inputs(&store, &[input])
            .expect("downloaded source attachment allowed");

        // 同一受管目录内、没有任何 DB 记录的文件仍必须被拒绝（目录本身不可信）。
        let orphan = managed_dir.join("orphan.bin");
        fs::write(&orphan, b"orphan").unwrap();
        let orphan_size = fs::metadata(&orphan).unwrap().len() as i64;
        let input = outbound_input("orphan.bin", &orphan.to_string_lossy(), orphan_size);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "受管目录内无记录文件也不得外发：{err}"
        );
    }

    #[test]
    fn concurrent_same_name_temp_attachments_are_independent() {
        let directory = std::env::temp_dir().join(format!(
            "better-email-temp-attachment-concurrent-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        ensure_private_temp_dir(&directory).expect("private temp dir");
        let first_dir = directory.clone();
        let first = std::thread::spawn(move || {
            create_private_temp_attachment_file(&first_dir, "same-name.txt", b"first")
                .expect("first file")
        });
        let second_dir = directory.clone();
        let second = std::thread::spawn(move || {
            create_private_temp_attachment_file(&second_dir, "same-name.txt", b"second")
                .expect("second file")
        });
        let first = first.join().expect("first thread");
        let second = second.join().expect("second thread");
        assert_ne!(first, second, "并发同名上传必须获得不同文件路径");
        assert_eq!(fs::read(first).unwrap(), b"first");
        assert_eq!(fs::read(second).unwrap(), b"second");
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn empty_filename_attachment_rows_are_skipped_in_validation() {
        let store =
            crate::db::MailStore::open_at(unique_test_database_path()).expect("store opens");
        // 与 DB 持久化逻辑一致：空文件名条目不落库，也不参与校验。
        let input = outbound_input("", "", 0);
        validate_outbound_attachment_inputs(&store, &[input]).expect("empty rows skipped");
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
    fn temp_attachment_dir_and_files_use_private_permissions() {
        // 粘贴/拖入附件：目录 0700、文件 0600（即使已存在也重新收紧目录）。
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!(
            "better-email-temp-attachment-perm-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        // 预先以宽权限创建目录，验证 ensure_private_temp_dir 会收紧。
        fs::create_dir_all(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        super::ensure_private_temp_dir(&dir).expect("temp dir ensured");
        assert_eq!(
            fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
            0o700,
            "粘贴/拖入附件目录应为 0700"
        );

        let file = dir.join("pasted.bin");
        super::write_private_temp_file(&file, b"content").expect("written");
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600,
            "粘贴/拖入附件文件应为 0600"
        );
        assert_eq!(fs::read(&file).unwrap(), b"content");
        let _ = fs::remove_dir_all(&dir);
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
