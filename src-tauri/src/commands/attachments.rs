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
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
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
pub async fn pick_outbound_attachments(app: AppHandle) -> MailResult<Vec<OutboundAttachmentInput>> {
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
        crate::db::MailError::Io(std::io::Error::other(
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

#[cfg(test)]
mod tests {
    use super::render_eml_message;
    use crate::models::{Attachment, Message};

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
}
