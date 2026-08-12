use crate::db::MailResult;
use crate::models::{Account, LocalBackup};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
pub(super) const MAX_ATTACHMENT_DOWNLOAD_BYTES: i64 = 25 * 1024 * 1024;
pub(super) const MAX_ATTACHMENT_TRANSFER_BYTES: i64 = MAX_ATTACHMENT_DOWNLOAD_BYTES * 4;
pub(super) const MAX_EML_IMPORT_BYTES: usize = 25 * 1024 * 1024;
pub(super) const MAX_VCARD_IMPORT_BYTES: usize = 5 * 1024 * 1024;
pub(super) const MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH: usize = 2;
pub(super) const SYNCABLE_IMAP_ROLES: [&str; 6] =
    ["inbox", "sent", "drafts", "archive", "trash", "spam"];
pub(super) const VERBOSE_COMMAND_LOG_ENV: &str = "BETTER_EMAIL_VERBOSE_COMMAND_LOGS";

pub(super) fn verbose_command_logs_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var(VERBOSE_COMMAND_LOG_ENV)
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
}

pub(super) fn command_info(message: impl AsRef<str>) {
    if verbose_command_logs_enabled() {
        crate::logging::log_line(message);
    }
}

pub(super) fn attachment_resume_offset(bytes: u64) -> Option<usize> {
    if bytes > MAX_ATTACHMENT_TRANSFER_BYTES as u64 {
        return None;
    }
    usize::try_from(bytes).ok()
}

pub(super) fn format_attachment_progress(bytes: u64) -> String {
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

pub(super) fn benchmark_env(primary: &str, legacy: &str) -> Option<String> {
    std::env::var(primary)
        .ok()
        .or_else(|| std::env::var(legacy).ok())
}

pub(super) fn prompt_save_file_path(
    app: &AppHandle,
    title: &str,
    filename: String,
    directory: Option<&Path>,
) -> MailResult<Option<PathBuf>> {
    let (sender, receiver) = mpsc::channel();
    let mut builder = app.dialog().file().set_title(title).set_file_name(filename);
    if let Some(directory) = directory {
        builder = builder.set_directory(directory);
    }
    builder.save_file(move |path| {
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

pub(super) fn is_pop3_account(account: &Account) -> bool {
    account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
}

pub fn validate_external_url(url: &str) -> MailResult<tauri::Url> {
    let parsed = tauri::Url::parse(url).map_err(|error| {
        crate::db::MailError::Imap(format!("无效的 URL 格式或相对地址：{error}"))
    })?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(crate::db::MailError::Imap(format!(
            "拒绝打开非安全协议：{}。只允许使用 http 和 https 协议。",
            scheme
        )));
    }
    Ok(parsed)
}

pub(super) fn validate_attachment_download_size(size_bytes: i64) -> MailResult<()> {
    if size_bytes > MAX_ATTACHMENT_DOWNLOAD_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "附件大小超过当前安全下载上限（{} MB），已阻止一次性拉取以避免占用过多内存。后续分段下载版本会支持更大的附件。",
            MAX_ATTACHMENT_DOWNLOAD_BYTES / 1024 / 1024
        )));
    }
    Ok(())
}

pub(super) fn mask_recipient_list(value: &str) -> String {
    value
        .split([',', ';', '，', '；'])
        .map(mask_email)
        .filter(|email| !email.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

pub(super) fn mask_email(value: &str) -> String {
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

pub(super) fn sanitize_filename(filename: &str) -> String {
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
pub(super) fn powershell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(super) fn mime_type_for_path(path: &Path) -> String {
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

pub(super) async fn read_backup_from_dialog(
    app: AppHandle,
) -> MailResult<Option<(LocalBackup, String, i64)>> {
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

pub(super) fn read_local_backup_file(path: PathBuf) -> MailResult<(LocalBackup, String, i64)> {
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
        attachment_resume_offset, format_attachment_progress, mask_email, mask_recipient_list,
        sanitize_filename, validate_attachment_download_size, MAX_ATTACHMENT_DOWNLOAD_BYTES,
        MAX_ATTACHMENT_TRANSFER_BYTES,
    };

    #[test]
    fn filename_sanitizer_removes_path_and_control_chars() {
        assert_eq!(sanitize_filename("../invoice?.pdf"), "_invoice_.pdf");
        assert_eq!(sanitize_filename("\u{0000}"), "attachment");
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
    fn test_valid_http_https_url() {
        assert!(super::validate_external_url("http://example.com/").is_ok());
        assert!(super::validate_external_url("https://paypal.com/login").is_ok());
        assert!(super::validate_external_url("HTTPS://google.com").is_ok());
        assert!(super::validate_external_url("hTtP://yahoo.com").is_ok());
    }

    #[test]
    fn test_invalid_and_blocked_protocols() {
        assert!(super::validate_external_url("file:///etc/passwd").is_err());
        assert!(super::validate_external_url("data:text/html,<html>").is_err());
        assert!(super::validate_external_url("javascript:alert(1)").is_err());
        assert!(super::validate_external_url("ftp://ftp.example.com").is_err());
        assert!(super::validate_external_url("custom://some/path").is_err());
        assert!(super::validate_external_url("invalid-url-string").is_err());
        assert!(super::validate_external_url("/relative/path/index.html").is_err());
    }

    #[test]
    fn test_userinfo_port_ipv6() {
        assert!(super::validate_external_url("http://user:pass@example.com:8080/path").is_ok());
        assert!(super::validate_external_url("https://[::1]:443/").is_ok());
        assert!(super::validate_external_url("https://127.0.0.1:3000/").is_ok());
    }
}
