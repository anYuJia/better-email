use crate::credentials::AccountSecret;
use crate::db::MailError;
use crate::models::{
    Account, ImapFolderProbe, ImapHeaderBatch, ImapProbeReport, RemoteAttachmentMetadata,
    RemoteAttachmentPayload, RemoteMessageBody, RemoteMessageHeader,
};
use crate::protocol;
use chrono::Utc;
use imap_proto::parser::bodystructure::BodyStructParser;
use imap_proto::types::{BodyStructure, ContentDisposition, SectionPath};
use mail_parser::{MessageParser, MimeHeaders};
use std::collections::BTreeSet;
use std::io::Write;

const HEADER_FETCH_LIMIT: usize = 25;
const ATTACHMENT_CHUNK_BYTES: usize = 256 * 1024;

pub fn verify_credentials(account: &Account, secret: &AccountSecret) -> Result<(), MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    let _ = session.logout();
    Ok(())
}

pub fn discover_folders(
    account: &Account,
    secret: &AccountSecret,
) -> Result<ImapProbeReport, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    let names = session
        .list(None, Some("*"))
        .map_err(|error| MailError::Imap(format!("IMAP 文件夹发现失败：{error}")))?;
    let folders = names
        .iter()
        .map(|name| ImapFolderProbe {
            name: name.name().to_string(),
            delimiter: name.delimiter().unwrap_or("").to_string(),
            attributes: name
                .attributes()
                .iter()
                .map(|attribute| format!("{attribute:?}"))
                .collect(),
        })
        .collect::<Vec<_>>();
    let _ = session.logout();

    Ok(ImapProbeReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        folder_count: folders.len() as i64,
        status: "ok".to_string(),
        message: format!("IMAP 登录成功，发现 {} 个文件夹。", folders.len()),
        folders,
    })
}

pub fn failed_report(account_email: &str, message: String) -> ImapProbeReport {
    ImapProbeReport {
        account_email: account_email.to_string(),
        checked_at: Utc::now().to_rfc3339(),
        folder_count: 0,
        folders: Vec::new(),
        status: "error".to_string(),
        message,
    }
}

pub fn fetch_recent_headers(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    since_uid: i64,
) -> Result<ImapHeaderBatch, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    let mailbox = session
        .select(remote_name)
        .map_err(|error| MailError::Imap(format!("IMAP 选择文件夹失败：{error}")))?;
    let search_query = if since_uid > 0 {
        format!("UID {}:*", since_uid + 1)
    } else {
        "ALL".to_string()
    };
    let mut uids = session
        .uid_search(search_query)
        .map_err(|error| MailError::Imap(format!("IMAP 搜索 UID 失败：{error}")))?
        .into_iter()
        .map(i64::from)
        .filter(|uid| *uid > since_uid)
        .collect::<Vec<_>>();
    uids.sort_unstable();
    if uids.len() > HEADER_FETCH_LIMIT {
        uids = uids.split_off(uids.len() - HEADER_FETCH_LIMIT);
    }

    let headers = if uids.is_empty() {
        Vec::new()
    } else {
        let uid_set = uids
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(uid_set, "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER])")
            .map_err(|error| MailError::Imap(format!("IMAP 拉取邮件头失败：{error}")))?;
        fetches
            .iter()
            .filter_map(|fetch| {
                fetch
                    .uid
                    .map(i64::from)
                    .map(|uid| header_from_fetch(uid, fetch))
            })
            .collect()
    };
    let highest_uid = headers
        .iter()
        .map(|header| header.remote_uid)
        .max()
        .unwrap_or(since_uid);
    let _ = session.logout();

    Ok(ImapHeaderBatch {
        remote_name: remote_name.to_string(),
        uid_validity: mailbox
            .uid_validity
            .map(|value| value.to_string())
            .unwrap_or_default(),
        highest_uid,
        headers,
    })
}

pub fn fetch_message_body(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
) -> Result<RemoteMessageBody, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    session
        .select(remote_name)
        .map_err(|error| MailError::Imap(format!("IMAP 选择文件夹失败：{error}")))?;
    let fetches = session
        .uid_fetch(remote_uid.to_string(), "RFC822")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取正文失败：{error}")))?;
    let raw = fetches
        .iter()
        .find_map(|fetch| fetch.body())
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .ok_or_else(|| MailError::Imap("IMAP 未返回邮件正文。".to_string()))?;
    let _ = session.logout();

    Ok(parse_body_from_raw(&raw))
}

pub struct RemoteAttachmentWrite {
    pub filename: String,
    pub size_bytes: i64,
}

pub fn download_attachment_to_writer(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
    filename: &str,
    max_bytes: i64,
    writer: &mut impl Write,
) -> Result<RemoteAttachmentWrite, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    session
        .select(remote_name)
        .map_err(|error| MailError::Imap(format!("IMAP 选择文件夹失败：{error}")))?;

    let result = match find_attachment_part_path(&mut session, remote_uid, filename) {
        Ok(part_path) => download_attachment_part_to_writer(
            &mut session,
            remote_uid,
            filename,
            max_bytes,
            writer,
            part_path,
        ),
        Err(part_error) => {
            let payload =
                fetch_attachment_payload_from_selected(&mut session, remote_uid, filename)?;
            if payload.bytes.len() as i64 > max_bytes {
                Err(MailError::Imap(format!(
                    "附件超过当前下载上限（{} MB），且 IMAP 分段下载不可用：{part_error}",
                    max_bytes / 1024 / 1024
                )))
            } else {
                writer.write_all(&payload.bytes)?;
                Ok(RemoteAttachmentWrite {
                    filename: payload.filename,
                    size_bytes: payload.bytes.len() as i64,
                })
            }
        }
    };
    let _ = session.logout();
    result
}

pub fn set_remote_seen(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
    is_read: bool,
) -> Result<(), MailError> {
    set_remote_seen_batch(account, secret, remote_name, &[remote_uid], is_read)
}

pub fn set_remote_seen_batch(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uids: &[i64],
    is_read: bool,
) -> Result<(), MailError> {
    let uid_set = remote_uid_set(remote_uids)?;
    with_selected_mailbox(account, secret, remote_name, |session| {
        let query = if is_read {
            "+FLAGS.SILENT (\\Seen)"
        } else {
            "-FLAGS.SILENT (\\Seen)"
        };
        session
            .uid_store(uid_set.as_str(), query)
            .map(|_| ())
            .map_err(|error| MailError::Imap(format!("IMAP 回写已读状态失败：{error}")))
    })
}

fn remote_uid_set(remote_uids: &[i64]) -> Result<String, MailError> {
    let uid_set = remote_uids
        .iter()
        .copied()
        .filter(|uid| *uid > 0)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|uid| uid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    if uid_set.is_empty() {
        return Err(MailError::Imap(
            "远端 UID 列表为空，无法回写已读状态。".to_string(),
        ));
    }
    Ok(uid_set)
}

pub fn move_remote_message(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
    target_mailbox: &str,
) -> Result<(), MailError> {
    with_selected_mailbox(account, secret, remote_name, |session| {
        if target_mailbox.trim().is_empty() {
            return Err(MailError::Imap(
                "远端目标文件夹为空，无法移动。".to_string(),
            ));
        }
        session
            .uid_mv(remote_uid.to_string(), target_mailbox)
            .map_err(|error| MailError::Imap(format!("IMAP 移动邮件失败：{error}")))
    })
}

pub fn delete_remote_message(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
) -> Result<(), MailError> {
    with_selected_mailbox(account, secret, remote_name, |session| {
        session
            .uid_store(remote_uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
            .map_err(|error| MailError::Imap(format!("IMAP 标记删除失败：{error}")))?;
        session
            .uid_expunge(remote_uid.to_string())
            .map(|_| ())
            .map_err(|error| MailError::Imap(format!("IMAP 删除邮件失败：{error}")))
    })
}

fn with_selected_mailbox<T>(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    operation: impl FnOnce(&mut imap::Session<imap::Connection>) -> Result<T, MailError>,
) -> Result<T, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    session
        .select(remote_name)
        .map_err(|error| MailError::Imap(format!("IMAP 选择文件夹失败：{error}")))?;
    let result = operation(&mut session);
    let _ = session.logout();
    result
}

fn parse_imap_endpoint(configured: &str) -> Result<(String, u16), MailError> {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return Err(MailError::Imap("未配置 IMAP 服务器。".to_string()));
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        let parsed_port = port
            .parse::<u16>()
            .map_err(|_| MailError::Imap("IMAP 端口格式无效，应为 1-65535。".to_string()))?;
        Ok((host.trim().to_string(), parsed_port))
    } else {
        Ok((trimmed.to_string(), 993))
    }
}

fn fetch_attachment_payload_from_selected(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    filename: &str,
) -> Result<RemoteAttachmentPayload, MailError> {
    let fetches = session
        .uid_fetch(remote_uid.to_string(), "RFC822")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取正文失败：{error}")))?;
    let raw = fetches
        .iter()
        .find_map(|fetch| fetch.body())
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .ok_or_else(|| MailError::Imap("IMAP 未返回邮件正文。".to_string()))?;
    parse_attachment_payload_from_raw(&raw, filename)
        .ok_or_else(|| MailError::Imap(format!("IMAP 正文中未找到附件：{}", filename.trim())))
}

fn find_attachment_part_path(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    filename: &str,
) -> Result<Vec<u32>, MailError> {
    let requested = filename.trim();
    let fetches = session
        .uid_fetch(remote_uid.to_string(), "BODYSTRUCTURE")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取 BODYSTRUCTURE 失败：{error}")))?;
    let bodystructure = fetches
        .iter()
        .find_map(|fetch| fetch.bodystructure())
        .ok_or_else(|| MailError::Imap("IMAP 未返回 BODYSTRUCTURE。".to_string()))?;
    attachment_part_path(bodystructure, requested)
        .ok_or_else(|| MailError::Imap(format!("IMAP BODYSTRUCTURE 中未找到附件：{requested}")))
}

fn download_attachment_part_to_writer(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    filename: &str,
    max_bytes: i64,
    writer: &mut impl Write,
    part_path: Vec<u32>,
) -> Result<RemoteAttachmentWrite, MailError> {
    let requested = filename.trim();
    let section_path = SectionPath::Part(part_path.clone(), None);
    let section = part_path
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".");

    let mut offset = 0usize;
    let mut written = 0usize;
    loop {
        let query = format!(
            "BODY.PEEK[{section}]<{}.{}>",
            offset, ATTACHMENT_CHUNK_BYTES
        );
        let fetches = session
            .uid_fetch(remote_uid.to_string(), query)
            .map_err(|error| MailError::Imap(format!("IMAP 分段拉取附件失败：{error}")))?;
        let chunk = fetches
            .iter()
            .find_map(|fetch| fetch.section(&section_path))
            .ok_or_else(|| MailError::Imap("IMAP 未返回附件分段数据。".to_string()))?;
        if chunk.is_empty() {
            break;
        }
        written += chunk.len();
        if written as i64 > max_bytes {
            return Err(MailError::Imap(format!(
                "附件超过当前下载上限（{} MB）。",
                max_bytes / 1024 / 1024
            )));
        }
        writer.write_all(chunk)?;
        if chunk.len() < ATTACHMENT_CHUNK_BYTES {
            break;
        }
        offset += chunk.len();
    }

    Ok(RemoteAttachmentWrite {
        filename: requested.to_string(),
        size_bytes: written as i64,
    })
}

fn attachment_part_path(bodystructure: &BodyStructure<'_>, filename: &str) -> Option<Vec<u32>> {
    let parser = BodyStructParser::new(bodystructure);
    let requested = filename.trim();
    parser.search(|body| {
        let Some(name) = attachment_filename_from_bodystructure(body) else {
            return false;
        };
        requested.is_empty() || name == requested
    })
}

fn attachment_filename_from_bodystructure(bodystructure: &BodyStructure<'_>) -> Option<String> {
    let (common, disposition) = match bodystructure {
        BodyStructure::Basic { common, .. }
        | BodyStructure::Text { common, .. }
        | BodyStructure::Message { common, .. } => (common, common.disposition.as_ref()),
        BodyStructure::Multipart { .. } => return None,
    };

    disposition
        .and_then(filename_from_disposition)
        .or_else(|| filename_from_params(common.ty.params.as_deref()))
}

fn filename_from_disposition(disposition: &ContentDisposition<'_>) -> Option<String> {
    filename_from_params(disposition.params.as_deref())
}

fn filename_from_params(
    params: Option<&[(std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>)]>,
) -> Option<String> {
    params?.iter().find_map(|(key, value)| {
        if key.eq_ignore_ascii_case("filename") || key.eq_ignore_ascii_case("name") {
            Some(value.to_string())
        } else {
            None
        }
    })
}

struct XOAuth2Authenticator<'a> {
    user: &'a str,
    access_token: &'a str,
}

impl imap::Authenticator for XOAuth2Authenticator<'_> {
    type Response = String;

    fn process(&self, _challenge: &[u8]) -> Self::Response {
        format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            self.user, self.access_token
        )
    }
}

fn login_imap(
    client: imap::Client<imap::Connection>,
    account: &Account,
    secret: &AccountSecret,
) -> Result<imap::Session<imap::Connection>, MailError> {
    match secret {
        AccountSecret::Password(password) => client
            .login(&account.email, password)
            .map_err(|error| MailError::Imap(format!("IMAP 登录失败：{}", error.0))),
        AccountSecret::OAuth2(bundle) => {
            let authenticator = XOAuth2Authenticator {
                user: &account.email,
                access_token: &bundle.access_token,
            };
            client
                .authenticate("XOAUTH2", &authenticator)
                .map_err(|(error, _client)| {
                    MailError::Imap(format!("IMAP XOAUTH2 登录失败：{error}"))
                })
        }
    }
}

#[cfg(test)]
fn imap_xoauth2_response(user: &str, access_token: &str) -> String {
    imap::Authenticator::process(&XOAuth2Authenticator { user, access_token }, &[])
}

fn header_from_fetch(uid: i64, fetch: &imap::types::Fetch<'_>) -> RemoteMessageHeader {
    let raw_header = fetch
        .header()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default();
    let parsed = MessageParser::default().parse(raw_header.as_bytes());
    let subject = parsed
        .as_ref()
        .and_then(|message| message.subject())
        .map(ToOwned::to_owned)
        .or_else(|| header_value(&raw_header, "subject"))
        .unwrap_or_else(|| "(无主题)".to_string());
    let from = header_value(&raw_header, "from").unwrap_or_default();
    let to = header_value(&raw_header, "to").unwrap_or_default();
    let message_id =
        header_value(&raw_header, "message-id").unwrap_or_else(|| format!("imap-{uid}"));
    let received_at = fetch
        .internal_date()
        .map(|date| date.to_rfc3339())
        .or_else(|| header_value(&raw_header, "date"))
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let flags = format!("{:?}", fetch.flags());

    RemoteMessageHeader {
        remote_uid: uid,
        message_id,
        subject: subject.trim().to_string(),
        sender_name: display_name_from_address(&from),
        sender_email: email_from_address(&from),
        recipients: to,
        snippet: "远端邮件头已同步，正文将在按需读取阶段拉取。".to_string(),
        received_at,
        is_read: flags.contains("Seen"),
    }
}

fn header_value(headers: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}:");
    let mut value = String::new();
    for line in headers.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            if !value.is_empty() {
                value.push(' ');
                value.push_str(line.trim());
            }
            continue;
        }
        if !value.is_empty() {
            break;
        }
        if line.to_ascii_lowercase().starts_with(&prefix) {
            value = line[prefix.len()..].trim().to_string();
        }
    }
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn display_name_from_address(address: &str) -> String {
    address
        .split('<')
        .next()
        .map(|name| name.trim().trim_matches('"').to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| email_from_address(address))
}

fn email_from_address(address: &str) -> String {
    if let Some((_, rest)) = address.split_once('<') {
        rest.split('>').next().unwrap_or(address).trim().to_string()
    } else {
        address.trim().to_string()
    }
}

fn parse_body_from_raw(raw: &str) -> RemoteMessageBody {
    let parsed = MessageParser::default().parse(raw.as_bytes());
    let has_html_part = raw.to_ascii_lowercase().contains("content-type: text/html");
    let fallback_body = raw
        .replace("\r\n", "\n")
        .split_once("\n\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default();
    let text_body = parsed
        .as_ref()
        .and_then(|message| message.body_text(0))
        .map(|body| body.into_owned())
        .unwrap_or_default();
    let html_body = parsed
        .as_ref()
        .and_then(|message| message.body_html(0))
        .map(|body| body.into_owned())
        .unwrap_or_default();
    let body = if !text_body.trim().is_empty() {
        text_body
    } else if has_html_part && looks_like_html(&html_body) {
        html_body.clone()
    } else {
        fallback_body
    };
    let sanitized_html = if has_html_part && looks_like_html(&html_body) {
        protocol::sanitize_html(&html_body)
    } else {
        String::new()
    };
    let security_warnings = reader_security_warnings(raw, &html_body);
    let snippet = body
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .chars()
        .take(120)
        .collect();
    let has_attachments = parsed
        .as_ref()
        .map(|message| message.attachments().next().is_some())
        .unwrap_or(false);
    let attachments = parsed
        .as_ref()
        .map(|message| {
            message
                .attachments()
                .enumerate()
                .map(|(index, part)| {
                    let mime_type = part
                        .content_type()
                        .map(|content_type| {
                            content_type
                                .c_subtype
                                .as_ref()
                                .map(|subtype| format!("{}/{}", content_type.c_type, subtype))
                                .unwrap_or_else(|| content_type.c_type.to_string())
                        })
                        .unwrap_or_else(|| "application/octet-stream".to_string());
                    RemoteAttachmentMetadata {
                        filename: part
                            .attachment_name()
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("attachment-{}", index + 1)),
                        mime_type,
                        size_bytes: part.body.len() as i64,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    RemoteMessageBody {
        body,
        sanitized_html,
        security_warnings,
        snippet,
        has_attachments: has_attachments || !attachments.is_empty(),
        attachments,
    }
}

fn looks_like_html(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "<html", "<body", "<div", "<p", "<table", "<a ", "<img", "<span",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn reader_security_warnings(raw: &str, html_body: &str) -> Vec<String> {
    let lower = format!("{raw}\n{html_body}").to_ascii_lowercase();
    if !lower.contains("content-type: text/html") && !looks_like_html(html_body) {
        return Vec::new();
    }

    let mut warnings = Vec::new();
    if lower.contains("<script") {
        warnings.push("HTML 正文包含 script，阅读面已清洗移除。".to_string());
    }
    if lower.contains("onclick")
        || lower.contains("onload")
        || lower.contains("onerror")
        || lower.contains("onmouseover")
    {
        warnings.push("HTML 正文包含事件属性，阅读面已清洗移除。".to_string());
    }
    if (lower.contains("<img") && lower.contains("src=\"http"))
        || (lower.contains("<img") && lower.contains("src='http"))
    {
        warnings.push("检测到远程图片，默认已阻止自动加载。".to_string());
    }
    if lower.contains("href=\"http://") || lower.contains("href='http://") {
        warnings.push("正文包含明文 HTTP 链接，已移除可点击目标。".to_string());
    }
    if lower.contains("href=\"https://") || lower.contains("href='https://") {
        warnings.push("正文包含外部链接，请核对域名后再访问。".to_string());
    }
    warnings.extend(protocol::link_risk_warnings(html_body));
    warnings
}

fn parse_attachment_payload_from_raw(raw: &str, filename: &str) -> Option<RemoteAttachmentPayload> {
    let requested = filename.trim();
    let parsed = MessageParser::default().parse(raw.as_bytes())?;
    let mut attachments = parsed.attachments();
    if requested.is_empty() {
        return attachments.next().map(|part| RemoteAttachmentPayload {
            filename: part
                .attachment_name()
                .map(str::to_string)
                .unwrap_or_else(|| "attachment".to_string()),
            bytes: part.contents().to_vec(),
        });
    }

    attachments.find_map(|part| {
        let part_name = part.attachment_name().unwrap_or("");
        if part_name == requested {
            Some(RemoteAttachmentPayload {
                filename: part_name.to_string(),
                bytes: part.contents().to_vec(),
            })
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_imap_endpoint_defaults_to_tls_port() {
        assert_eq!(
            parse_imap_endpoint("imap.example.com").unwrap(),
            ("imap.example.com".to_string(), 993)
        );
        assert_eq!(
            parse_imap_endpoint("imap.example.com:143").unwrap(),
            ("imap.example.com".to_string(), 143)
        );
    }

    #[test]
    fn failed_report_has_no_folders() {
        let report = failed_report("a@example.com", "missing credential".to_string());
        assert_eq!(report.status, "error");
        assert_eq!(report.folder_count, 0);
        assert!(report.folders.is_empty());
    }

    #[test]
    fn builds_imap_xoauth2_response() {
        assert_eq!(
            imap_xoauth2_response("me@example.com", "access-123"),
            "user=me@example.com\x01auth=Bearer access-123\x01\x01"
        );
    }

    #[test]
    fn builds_deduplicated_remote_uid_set() {
        assert_eq!(remote_uid_set(&[3, 1, 3, 0, -1]).unwrap(), "1,3");
        assert!(remote_uid_set(&[0, -1]).is_err());
    }

    #[test]
    fn parses_folded_headers_and_addresses() {
        let headers = "Subject: Hello\r\n World\r\nFrom: Ada <ada@example.com>\r\n\r\n";
        assert_eq!(header_value(headers, "subject").unwrap(), "Hello World");
        assert_eq!(display_name_from_address("Ada <ada@example.com>"), "Ada");
        assert_eq!(
            email_from_address("Ada <ada@example.com>"),
            "ada@example.com"
        );
    }

    #[test]
    fn parses_body_from_raw_message() {
        let body = parse_body_from_raw(
            "Subject: Body\r\nFrom: Ada <ada@example.com>\r\n\r\nHello body.\r\nSecond line.",
        );
        assert!(body.body.contains("Hello body."));
        assert_eq!(body.snippet, "Hello body.");
        assert!(body.sanitized_html.is_empty());
        assert!(body.security_warnings.is_empty());
        assert!(!body.has_attachments);
        assert!(body.attachments.is_empty());
    }

    #[test]
    fn parses_and_sanitizes_html_body_from_raw_message() {
        let body = parse_body_from_raw(
            "Subject: HTML\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             <p onclick=\"x()\">Hi</p><script>alert(1)</script><img src=\"http://tracker.example/pixel.png\">",
        );

        assert!(body.body.contains("Hi"));
        assert!(body.sanitized_html.contains("<p>Hi</p>"));
        assert!(!body.sanitized_html.contains("<script"));
        assert!(!body.sanitized_html.contains("onclick"));
        assert!(!body.sanitized_html.contains("src=\"http"));
        assert!(body.security_warnings.len() >= 3);
    }

    #[test]
    fn flags_reader_phishing_link_domain_mismatch() {
        let body = parse_body_from_raw(
            "Subject: HTML\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             <p>Action required</p><a href=\"https://evil.example/login\">https://bank.example</a>",
        );

        assert!(body
            .security_warnings
            .iter()
            .any(|warning| warning.contains("bank.example") && warning.contains("evil.example")));
    }

    #[test]
    fn parses_attachment_metadata_from_raw_message() {
        let body = parse_body_from_raw(
            "Subject: Attachment\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=\"b\"\r\n\
             \r\n\
             --b\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             Hello with attachment.\r\n\
             --b\r\n\
             Content-Type: text/plain; name=\"notes.txt\"\r\n\
             Content-Disposition: attachment; filename=\"notes.txt\"\r\n\
             \r\n\
             attachment body\r\n\
             --b--\r\n",
        );
        assert!(body.has_attachments);
        assert_eq!(body.attachments.len(), 1);
        assert_eq!(body.attachments[0].filename, "notes.txt");
        assert_eq!(body.attachments[0].mime_type, "text/plain");
        assert_eq!(body.attachments[0].size_bytes, 15);
    }

    #[test]
    fn parses_attachment_payload_from_raw_message() {
        let payload = parse_attachment_payload_from_raw(
            "Subject: Attachment\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: multipart/mixed; boundary=\"b\"\r\n\
             \r\n\
             --b\r\n\
             Content-Type: text/plain; charset=utf-8\r\n\
             \r\n\
             Hello with attachment.\r\n\
             --b\r\n\
             Content-Type: text/plain; name=\"notes.txt\"\r\n\
             Content-Disposition: attachment; filename=\"notes.txt\"\r\n\
             \r\n\
             attachment body\r\n\
             --b--\r\n",
            "notes.txt",
        )
        .unwrap();
        assert_eq!(payload.filename, "notes.txt");
        assert_eq!(payload.bytes, b"attachment body");
    }

    #[test]
    fn finds_attachment_part_path_from_bodystructure() {
        let response = b"* 1569 FETCH (BODYSTRUCTURE (((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"UTF-8\") NIL NIL \"QUOTED-PRINTABLE\" 833 30 NIL NIL NIL)(\"TEXT\" \"HTML\" (\"CHARSET\" \"UTF-8\") NIL NIL \"QUOTED-PRINTABLE\" 3412 62 NIL (\"INLINE\" NIL) NIL) \"ALTERNATIVE\" (\"BOUNDARY\" \"alt\") NIL NIL)(\"APPLICATION\" \"PDF\" (\"NAME\" \"title.pdf\") \"<part-2>\" NIL \"BASE64\" 333980 NIL (\"ATTACHMENT\" (\"FILENAME\" \"title.pdf\")) NIL) \"MIXED\" (\"BOUNDARY\" \"mixed\") NIL NIL))\r\n";
        let (_, parsed) = imap_proto::parser::parse_response(response).unwrap();
        match parsed {
            imap_proto::types::Response::Fetch(_, attributes) => {
                let bodystructure = attributes
                    .iter()
                    .find_map(|attribute| match attribute {
                        imap_proto::types::AttributeValue::BodyStructure(bodystructure) => {
                            Some(bodystructure)
                        }
                        _ => None,
                    })
                    .unwrap();

                assert_eq!(
                    attachment_part_path(bodystructure, "title.pdf"),
                    Some(vec![2])
                );
                assert_eq!(attachment_part_path(bodystructure, "missing.pdf"), None);
            }
            _ => panic!("expected FETCH response"),
        };
    }
}
