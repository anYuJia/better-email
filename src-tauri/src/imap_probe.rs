use crate::credentials::AccountSecret;
use crate::db::MailError;
use crate::models::{
    Account, ImapFetchResult, ImapFlagSnapshot, ImapFlagState, ImapFolderProbe, ImapHeaderBatch,
    ImapProbeReport, RemoteAttachmentMetadata, RemoteAttachmentPayload, RemoteMessageBody,
    RemoteMessageHeader,
};
use crate::protocol;
use base64::Engine as _;
use chrono::Utc;
use imap_proto::parser::bodystructure::BodyStructParser;
use imap_proto::types::{
    BodyStructure, ContentDisposition, ContentEncoding, SectionPath, UidSetMember,
};
use mail_parser::{Message, MessageParser, MessagePart, MimeHeaders};
use std::collections::BTreeSet;
use std::io::{Read, Write};
use std::thread;
use std::time::Duration;

const HEADER_FETCH_LIMIT: usize = 25;
const FLAG_RECONCILE_LIMIT: u32 = 50;
const SINGLE_PART_TEXT_FETCH_QUERY: &str = "BODY.PEEK[TEXT]";
const ATTACHMENT_CHUNK_BYTES: usize = 256 * 1024;
const ATTACHMENT_FETCH_ATTEMPTS: usize = 3;
const ATTACHMENT_RETRY_BASE_DELAY_MS: u64 = 150;
const VERBOSE_IMAP_LOG_ENV: &str = "BETTER_EMAIL_VERBOSE_COMMAND_LOGS";

fn verbose_imap_logs_enabled() -> bool {
    cfg!(debug_assertions)
        || std::env::var(VERBOSE_IMAP_LOG_ENV)
            .map(|value| matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false)
}

fn imap_info(message: impl AsRef<str>) {
    if verbose_imap_logs_enabled() {
        crate::logging::log_line(message);
    }
}

fn retry_attachment_session<T>(
    mut operation: impl FnMut() -> Result<T, MailError>,
) -> Result<T, MailError> {
    retry_attachment_session_with_sleeper(&mut operation, thread::sleep)
}

fn retry_attachment_session_with_sleeper<T>(
    mut operation: impl FnMut() -> Result<T, MailError>,
    mut sleeper: impl FnMut(Duration),
) -> Result<T, MailError> {
    retry_attachment_operation_with_sleeper(&mut operation, &mut sleeper, |error| {
        matches!(error, MailError::Imap(_))
    })
}

fn retry_attachment_operation_with_sleeper<T>(
    operation: &mut impl FnMut() -> Result<T, MailError>,
    sleeper: &mut impl FnMut(Duration),
    should_retry: impl Fn(&MailError) -> bool,
) -> Result<T, MailError> {
    let mut last_error = String::new();
    for attempt in 0..ATTACHMENT_FETCH_ATTEMPTS {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if !should_retry(&error) => return Err(error),
            Err(error) => last_error = error.to_string(),
        }
        if attempt + 1 < ATTACHMENT_FETCH_ATTEMPTS {
            sleeper(attachment_retry_delay(attempt));
        }
    }
    Err(MailError::Imap(format!(
        "附件 IMAP 请求在 {ATTACHMENT_FETCH_ATTEMPTS} 次尝试后仍失败：{last_error}"
    )))
}

struct CountingWriter<'a, W> {
    inner: &'a mut W,
    written: usize,
}

impl<'a, W> CountingWriter<'a, W> {
    fn new(inner: &'a mut W) -> Self {
        Self { inner, written: 0 }
    }
}

impl<W: Write> Write for CountingWriter<'_, W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(buffer)?;
        self.written = self
            .written
            .checked_add(written)
            .ok_or_else(|| std::io::Error::other("附件写入字节数溢出。"))?;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn attachment_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(ATTACHMENT_RETRY_BASE_DELAY_MS.saturating_mul(1_u64 << attempt.min(10)))
}

fn select_recent_uid_page(mut uids: Vec<i64>, initial_sync: bool) -> Vec<i64> {
    uids.sort_unstable();
    if uids.len() <= HEADER_FETCH_LIMIT {
        return uids;
    }
    if initial_sync {
        uids.split_off(uids.len() - HEADER_FETCH_LIMIT)
    } else {
        uids.truncate(HEADER_FETCH_LIMIT);
        uids
    }
}

fn select_history_uid_page(mut uids: Vec<i64>) -> Vec<i64> {
    uids.sort_unstable();
    if uids.len() > HEADER_FETCH_LIMIT {
        uids = uids.split_off(uids.len() - HEADER_FETCH_LIMIT);
    }
    uids
}

fn should_fetch_recent(
    requested: bool,
    cursor_reset: bool,
    highest_uid: i64,
    lowest_uid: i64,
) -> bool {
    requested || cursor_reset || (highest_uid <= 0 && lowest_uid <= 0)
}

#[derive(Debug, Clone)]
pub struct RemoteDeleteCandidate {
    pub remote_uid: i64,
    pub message_id_header: String,
}

#[derive(Debug, Clone)]
pub struct RemoteDeleteBatchResult {
    pub deleted_count: i64,
    pub skipped_count: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct ImapHeaderFetchOptions<'a> {
    pub uid_validity: &'a str,
    pub highest_uid: i64,
    pub lowest_uid: i64,
    pub history_complete: bool,
    pub include_recent: bool,
    pub include_history: bool,
}

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

pub fn fetch_header_page(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    options: ImapHeaderFetchOptions<'_>,
) -> Result<ImapFetchResult, MailError> {
    let (host, port) = parse_imap_endpoint(&account.imap_host)?;
    let client = imap::ClientBuilder::new(host.as_str(), port)
        .connect()
        .map_err(|error| MailError::Imap(format!("IMAP 连接失败：{error}")))?;
    let mut session = login_imap(client, account, secret)?;
    let mailbox = session
        .select(remote_name)
        .map_err(|error| MailError::Imap(format!("IMAP 选择文件夹失败：{error}")))?;
    let uid_validity = mailbox
        .uid_validity
        .map(|value| value.to_string())
        .unwrap_or_default();
    let cursor_reset = !options.uid_validity.is_empty()
        && !uid_validity.is_empty()
        && options.uid_validity != uid_validity;
    let effective_highest_uid = if cursor_reset { 0 } else { options.highest_uid };
    let effective_lowest_uid = if cursor_reset { 0 } else { options.lowest_uid };
    let include_recent = should_fetch_recent(
        options.include_recent,
        cursor_reset,
        effective_highest_uid,
        effective_lowest_uid,
    );
    let mut next_history_complete = if cursor_reset {
        false
    } else {
        options.history_complete
    };
    let mut history_scanned = false;
    let mut uids = BTreeSet::new();

    if include_recent {
        let search_query = if effective_highest_uid > 0 {
            format!("UID {}:*", effective_highest_uid + 1)
        } else {
            "ALL".to_string()
        };
        let mut recent_uids = session
            .uid_search(search_query)
            .map_err(|error| MailError::Imap(format!("IMAP 搜索 UID 失败：{error}")))?
            .into_iter()
            .map(i64::from)
            .filter(|uid| *uid > effective_highest_uid)
            .collect::<Vec<_>>();
        if effective_highest_uid <= 0 {
            history_scanned = options.include_history;
            next_history_complete = recent_uids.len() <= HEADER_FETCH_LIMIT;
        }
        recent_uids = select_recent_uid_page(recent_uids, effective_highest_uid <= 0);
        uids.extend(recent_uids);
    }

    if options.include_history
        && !next_history_complete
        && !(include_recent && effective_highest_uid <= 0)
    {
        history_scanned = true;
        if effective_lowest_uid <= 1 {
            next_history_complete = true;
        } else {
            let mut history_uids = session
                .uid_search(format!("UID 1:{}", effective_lowest_uid - 1))
                .map_err(|error| MailError::Imap(format!("IMAP 搜索历史 UID 失败：{error}")))?
                .into_iter()
                .map(i64::from)
                .filter(|uid| *uid > 0 && *uid < effective_lowest_uid)
                .collect::<Vec<_>>();
            next_history_complete = history_uids.len() <= HEADER_FETCH_LIMIT;
            history_uids = select_history_uid_page(history_uids);
            uids.extend(history_uids);
        }
    }

    let uids = uids.into_iter().collect::<Vec<_>>();

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
        .unwrap_or(effective_highest_uid)
        .max(effective_highest_uid);
    let page_lowest_uid = headers
        .iter()
        .map(|header| header.remote_uid)
        .min()
        .unwrap_or(effective_lowest_uid);
    let lowest_uid = match (effective_lowest_uid, page_lowest_uid) {
        (0, value) | (value, 0) => value,
        (current, page) => current.min(page),
    };
    let flags = fetch_recent_flag_snapshot(&mut session, mailbox.exists)?;
    let _ = session.logout();

    Ok(ImapFetchResult {
        headers: ImapHeaderBatch {
            remote_name: remote_name.to_string(),
            uid_validity,
            highest_uid,
            lowest_uid,
            history_complete: next_history_complete,
            history_scanned,
            cursor_reset,
            headers,
        },
        flags,
    })
}

fn fetch_recent_flag_snapshot(
    session: &mut imap::Session<imap::Connection>,
    exists: u32,
) -> Result<ImapFlagSnapshot, MailError> {
    if exists == 0 {
        return Ok(ImapFlagSnapshot {
            floor_uid: 0,
            complete: true,
            states: Vec::new(),
        });
    }

    let first_sequence = exists
        .saturating_sub(FLAG_RECONCILE_LIMIT.saturating_sub(1))
        .max(1);
    let fetches = session
        .fetch(format!("{first_sequence}:*"), "(UID FLAGS)")
        .map_err(|error| MailError::Imap(format!("IMAP 对账邮件状态失败：{error}")))?;
    let mut states = fetches
        .iter()
        .filter_map(flag_state_from_fetch)
        .collect::<Vec<_>>();
    states.sort_unstable_by_key(|state| state.remote_uid);
    let expected_count = exists.min(FLAG_RECONCILE_LIMIT) as usize;
    if states.len() != expected_count {
        return Err(MailError::Imap(format!(
            "IMAP 状态快照不完整：预期 {expected_count} 封，实际返回 {} 封；本轮未执行删除对账。",
            states.len()
        )));
    }
    let floor_uid = states
        .first()
        .map(|state| state.remote_uid)
        .unwrap_or_default();

    Ok(ImapFlagSnapshot {
        floor_uid,
        complete: exists <= FLAG_RECONCILE_LIMIT,
        states,
    })
}

pub fn fetch_message_body(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
) -> Result<RemoteMessageBody, MailError> {
    imap_info(format!(
        "[better-email][imap] body fetch start account_id={} mailbox={} uid={} peek=true seen_unchanged=true",
        account.id, remote_name, remote_uid
    ));
    let attachment_metadata_uids = BTreeSet::from([remote_uid]);
    let mut bodies = fetch_message_bodies(
        account,
        secret,
        remote_name,
        &[remote_uid],
        &attachment_metadata_uids,
    )?;
    let Some((_, body)) = bodies.pop() else {
        return Err(MailError::Imap("IMAP 未返回邮件正文。".to_string()));
    };
    Ok(body)
}

pub fn fetch_message_bodies(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uids: &[i64],
    attachment_metadata_uids: &BTreeSet<i64>,
) -> Result<Vec<(i64, RemoteMessageBody)>, MailError> {
    if remote_uids.is_empty() {
        return Ok(Vec::new());
    }
    imap_info(format!(
        "[better-email][imap] body batch fetch start account_id={} mailbox={} uids={}",
        account.id,
        remote_name,
        remote_uids.len()
    ));
    with_selected_mailbox(account, secret, remote_name, |session| {
        fetch_message_bodies_from_selected(
            session,
            remote_uids,
            attachment_metadata_uids,
            account,
            remote_name,
        )
    })
}

fn fetch_message_bodies_from_selected(
    session: &mut imap::Session<imap::Connection>,
    remote_uids: &[i64],
    attachment_metadata_uids: &BTreeSet<i64>,
    account: &Account,
    remote_name: &str,
) -> Result<Vec<(i64, RemoteMessageBody)>, MailError> {
    let uid_set = remote_uids
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let fetches = session
        .uid_fetch(uid_set, "(UID BODYSTRUCTURE)")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取邮件结构失败：{error}")))?;
    let mut metadata_by_uid = std::collections::BTreeMap::new();
    for fetch in fetches.iter() {
        let (Some(uid), Some(bodystructure)) = (fetch.uid, fetch.bodystructure()) else {
            continue;
        };
        metadata_by_uid.insert(i64::from(uid), message_structure_metadata(bodystructure));
    }

    let mut results = Vec::with_capacity(remote_uids.len());
    for remote_uid in remote_uids {
        let Some(metadata) = metadata_by_uid.remove(remote_uid) else {
            continue;
        };
        let (body, body_bytes) = fetch_structured_message_body(
            session,
            *remote_uid,
            metadata,
            attachment_metadata_uids.contains(remote_uid),
        )?;
        imap_info(format!(
            "[better-email][imap] body batch fetch ok account_id={} mailbox={} uid={} body_bytes={} attachments={} attachment_bytes=0",
            account.id,
            remote_name,
            remote_uid,
            body_bytes,
            body.attachments.len()
        ));
        results.push((*remote_uid, body));
    }
    Ok(results)
}

struct MessageStructureMetadata {
    text_parts: Vec<TextPartMetadata>,
    attachments: Vec<RemoteAttachmentMetadata>,
}

struct TextPartMetadata {
    path: Vec<u32>,
    is_html: bool,
    transfer_encoding: Option<String>,
    charset: Option<String>,
}

fn message_structure_metadata(bodystructure: &BodyStructure<'_>) -> MessageStructureMetadata {
    let mut metadata = MessageStructureMetadata {
        text_parts: Vec::new(),
        attachments: Vec::new(),
    };
    collect_message_structure_metadata(bodystructure, &[], &mut metadata);
    metadata
}

fn collect_message_structure_metadata(
    bodystructure: &BodyStructure<'_>,
    path: &[u32],
    metadata: &mut MessageStructureMetadata,
) {
    match bodystructure {
        BodyStructure::Multipart { bodies, .. } => {
            for (index, body) in bodies.iter().enumerate() {
                let mut child_path = path.to_vec();
                child_path.push((index + 1) as u32);
                collect_message_structure_metadata(body, &child_path, metadata);
            }
        }
        BodyStructure::Text { common, other, .. } => {
            let type_name = common.ty.ty.to_ascii_lowercase();
            let subtype = common.ty.subtype.to_ascii_lowercase();
            let filename =
                attachment_filename_from_bodystructure(bodystructure).unwrap_or_default();
            let content_id = protocol::normalize_content_id(other.id.as_deref());
            let is_text_body = type_name == "text" && filename.is_empty() && content_id.is_empty();
            if is_text_body {
                metadata.text_parts.push(TextPartMetadata {
                    path: path.to_vec(),
                    is_html: subtype == "html",
                    transfer_encoding: imap_content_transfer_encoding(&other.transfer_encoding),
                    charset: bodystructure_charset(common.ty.params.as_deref()),
                });
            } else if !filename.is_empty() || !content_id.is_empty() {
                metadata.attachments.push(RemoteAttachmentMetadata {
                    filename: if filename.is_empty() {
                        protocol::inline_attachment_filename(
                            format!("{type_name}/{subtype}").as_str(),
                            &content_id,
                            metadata.attachments.len(),
                        )
                    } else {
                        filename
                    },
                    mime_type: format!("{type_name}/{subtype}"),
                    size_bytes: i64::from(other.octets),
                    content_id: content_id.clone(),
                    is_inline: !content_id.is_empty(),
                });
            }
        }
        BodyStructure::Basic { common, other, .. }
        | BodyStructure::Message { common, other, .. } => {
            let filename =
                attachment_filename_from_bodystructure(bodystructure).unwrap_or_default();
            let content_id = protocol::normalize_content_id(other.id.as_deref());
            if filename.is_empty() && content_id.is_empty() {
                return;
            }
            let mime_type = format!("{}/{}", common.ty.ty, common.ty.subtype).to_ascii_lowercase();
            metadata.attachments.push(RemoteAttachmentMetadata {
                filename: if filename.is_empty() {
                    protocol::inline_attachment_filename(
                        &mime_type,
                        &content_id,
                        metadata.attachments.len(),
                    )
                } else {
                    filename
                },
                mime_type,
                size_bytes: i64::from(other.octets),
                content_id: content_id.clone(),
                is_inline: !content_id.is_empty(),
            });
        }
    }
}

fn imap_content_transfer_encoding(encoding: &ContentEncoding<'_>) -> Option<String> {
    let value = match encoding {
        ContentEncoding::SevenBit => "7bit",
        ContentEncoding::EightBit => "8bit",
        ContentEncoding::Binary => "binary",
        ContentEncoding::Base64 => "base64",
        ContentEncoding::QuotedPrintable => "quoted-printable",
        ContentEncoding::Other(value) => value.as_ref(),
    };
    Some(value.to_string())
}

fn bodystructure_charset(
    params: Option<&[(std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>)]>,
) -> Option<String> {
    params?.iter().find_map(|(name, value)| {
        name.eq_ignore_ascii_case("charset")
            .then(|| value.to_string())
    })
}

fn fetch_structured_message_body(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    mut metadata: MessageStructureMetadata,
    include_attachment_metadata: bool,
) -> Result<(RemoteMessageBody, usize), MailError> {
    let mut text_parts = Vec::new();
    let mut html_parts = Vec::new();
    let mut body_bytes = 0_usize;
    for part in metadata.text_parts {
        let bytes = fetch_message_text_part(session, remote_uid, &part.path)?;
        body_bytes = body_bytes.saturating_add(bytes.len());
        let decoded = crate::mime::decode_body_text(
            &bytes,
            part.transfer_encoding.as_deref(),
            part.charset.as_deref(),
        );
        if part.is_html {
            html_parts.push(decoded);
        } else {
            text_parts.push(decoded);
        }
    }

    let text_body = text_parts.join("\n");
    let html_body = html_parts.join("\n");
    let has_renderable_html = looks_like_html(&html_body);
    let fallback_body = if !text_body.trim().is_empty() {
        text_body.clone()
    } else {
        html_body.clone()
    };
    let body = if has_renderable_html {
        html_body.clone()
    } else {
        fallback_body.clone()
    };
    let sanitized_html = if has_renderable_html {
        protocol::sanitize_html(&html_body)
    } else {
        Default::default()
    };
    let security_warnings = reader_security_warnings(&html_body, &html_body);
    let snippet = protocol::message_body_snippet(&text_body, &html_body, &fallback_body);
    if !include_attachment_metadata {
        metadata.attachments.clear();
    }

    Ok((
        RemoteMessageBody {
            body,
            sanitized_html,
            security_warnings,
            snippet,
            has_attachments: !metadata.attachments.is_empty(),
            attachments: metadata.attachments,
        },
        body_bytes,
    ))
}

fn fetch_message_text_part(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    path: &[u32],
) -> Result<Vec<u8>, MailError> {
    if path.is_empty() {
        let fetches = session
            // BODY.PEEK[] returns the complete RFC822 message for a
            // single-part message, including Received/DKIM/MIME headers.
            // The empty bodystructure path represents the message text, so
            // request TEXT explicitly and keep those headers out of the body.
            .uid_fetch(remote_uid.to_string(), SINGLE_PART_TEXT_FETCH_QUERY)
            .map_err(|error| MailError::Imap(format!("IMAP 拉取正文失败：{error}")))?;
        return fetches
            .iter()
            .find_map(|fetch| fetch.text())
            .map(|bytes| bytes.to_vec())
            .ok_or_else(|| MailError::Imap("IMAP 未返回邮件正文。".to_string()));
    }

    let section = path
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".");
    let section_path = SectionPath::Part(path.to_vec(), None);
    let fetches = session
        .uid_fetch(remote_uid.to_string(), format!("BODY.PEEK[{section}]"))
        .map_err(|error| MailError::Imap(format!("IMAP 拉取正文分段失败：{error}")))?;
    fetches
        .iter()
        .find_map(|fetch| fetch.section(&section_path))
        .map(ToOwned::to_owned)
        .ok_or_else(|| MailError::Imap("IMAP 未返回正文分段。".to_string()))
}

pub struct RemoteAttachmentWrite {
    pub filename: String,
    pub size_bytes: i64,
    pub transfer_encoding: AttachmentTransferEncoding,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttachmentTransferEncoding {
    Identity,
    Base64,
    QuotedPrintable,
    Other(String),
}

impl AttachmentTransferEncoding {
    fn from_imap(value: &ContentEncoding<'_>) -> Self {
        match value {
            ContentEncoding::SevenBit | ContentEncoding::EightBit | ContentEncoding::Binary => {
                Self::Identity
            }
            ContentEncoding::Base64 => Self::Base64,
            ContentEncoding::QuotedPrintable => Self::QuotedPrintable,
            ContentEncoding::Other(value) => Self::Other(value.to_string()),
        }
    }

    fn max_transfer_bytes(&self, max_decoded_bytes: i64) -> i64 {
        match self {
            Self::Base64 => max_decoded_bytes.saturating_mul(2),
            Self::QuotedPrintable => max_decoded_bytes.saturating_mul(4),
            Self::Identity | Self::Other(_) => max_decoded_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AttachmentPartMetadata {
    path: Vec<u32>,
    transfer_encoding: AttachmentTransferEncoding,
    encoded_octets: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct AttachmentDownloadOptions<'a> {
    pub remote_name: &'a str,
    pub remote_uid: i64,
    pub filename: &'a str,
    pub content_id: &'a str,
    pub max_bytes: i64,
    pub start_offset: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteAppendResult {
    pub remote_uid: i64,
}

pub fn append_sent_message(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    message_id_header: &str,
    raw_message: &[u8],
) -> Result<RemoteAppendResult, MailError> {
    if raw_message.is_empty() {
        return Err(MailError::Imap(
            "远端已发送留档缺少原始邮件内容。".to_string(),
        ));
    }

    with_selected_mailbox(account, secret, remote_name, |session| {
        if let Some(remote_uid) = find_any_remote_uid_by_message_id(session, message_id_header)? {
            return Ok(RemoteAppendResult { remote_uid });
        }

        let mut append = session.append(remote_name, raw_message);
        append.flag(imap::types::Flag::Seen);
        let appended = append
            .finish()
            .map_err(|error| MailError::Imap(format!("IMAP 留档到已发送失败：{error}")))?;
        let remote_uid = single_appended_uid(appended.uids.as_deref())
            .or_else(|| {
                find_any_remote_uid_by_message_id(session, message_id_header)
                    .ok()
                    .flatten()
            })
            .unwrap_or_default();

        Ok(RemoteAppendResult { remote_uid })
    })
}

pub fn replace_draft_message(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    previous_message_id_header: &str,
    message_id_header: &str,
    raw_message: &[u8],
) -> Result<RemoteAppendResult, MailError> {
    if raw_message.is_empty() {
        return Err(MailError::Imap(
            "远端草稿同步缺少原始邮件内容。".to_string(),
        ));
    }

    with_selected_mailbox(account, secret, remote_name, |session| {
        let mut stale_uids = BTreeSet::new();
        for header in [previous_message_id_header, message_id_header] {
            if header.trim().is_empty() {
                continue;
            }
            let query = format!("HEADER Message-ID {}", quote_imap_string(header)?);
            stale_uids.extend(
                session
                    .uid_search(query)
                    .map_err(|error| MailError::Imap(format!("IMAP 定位旧远端草稿失败：{error}")))?
                    .into_iter()
                    .map(i64::from),
            );
        }
        if !stale_uids.is_empty() {
            let uid_set = remote_uid_set(&stale_uids.into_iter().collect::<Vec<_>>())?;
            session
                .uid_store(&uid_set, "+FLAGS.SILENT (\\Deleted)")
                .map_err(|error| MailError::Imap(format!("IMAP 标记旧草稿删除失败：{error}")))?;
            session
                .uid_expunge(&uid_set)
                .map_err(|error| MailError::Imap(format!("IMAP 删除旧草稿失败：{error}")))?;
        }

        let mut append = session.append(remote_name, raw_message);
        append.flag(imap::types::Flag::Draft);
        let appended = append
            .finish()
            .map_err(|error| MailError::Imap(format!("IMAP 同步远端草稿失败：{error}")))?;
        let remote_uid = single_appended_uid(appended.uids.as_deref())
            .or_else(|| {
                find_any_remote_uid_by_message_id(session, message_id_header)
                    .ok()
                    .flatten()
            })
            .unwrap_or_default();

        Ok(RemoteAppendResult { remote_uid })
    })
}

fn single_appended_uid(uids: Option<&[UidSetMember]>) -> Option<i64> {
    let [member] = uids? else {
        return None;
    };
    match member {
        UidSetMember::Uid(uid) => Some(i64::from(*uid)),
        UidSetMember::UidRange(range) if range.start() == range.end() => {
            Some(i64::from(*range.start()))
        }
        UidSetMember::UidRange(_) => None,
    }
}

pub fn download_attachment_to_writer(
    account: &Account,
    secret: &AccountSecret,
    options: AttachmentDownloadOptions<'_>,
    writer: &mut impl Write,
) -> Result<RemoteAttachmentWrite, MailError> {
    if options.start_offset as i64 > options.max_bytes.saturating_mul(4) {
        return Err(MailError::Imap(format!(
            "附件断点超过当前传输安全上限（{} MB）。",
            options.max_bytes.saturating_mul(4) / 1024 / 1024
        )));
    }
    let mut next_offset = options.start_offset;
    retry_attachment_session(|| {
        let start_offset = next_offset;
        let mut counted_writer = CountingWriter::new(&mut *writer);
        let result = with_selected_mailbox(account, secret, options.remote_name, |session| {
            download_attachment_from_selected(session, options, start_offset, &mut counted_writer)
        });
        next_offset = next_offset
            .checked_add(counted_writer.written)
            .ok_or_else(|| MailError::Imap("附件下载进度超出可用范围。".to_string()))?;
        result
    })
}

fn download_attachment_from_selected(
    session: &mut imap::Session<imap::Connection>,
    options: AttachmentDownloadOptions<'_>,
    start_offset: usize,
    writer: &mut impl Write,
) -> Result<RemoteAttachmentWrite, MailError> {
    match find_attachment_part_metadata(
        session,
        options.remote_uid,
        options.filename,
        options.content_id,
    ) {
        Ok(part) => download_attachment_part_to_writer(
            session,
            options.remote_uid,
            options.filename,
            options.max_bytes,
            start_offset,
            writer,
            part,
        ),
        Err(part_error) => {
            // A tagged-response mismatch means the session is no longer trustworthy. Let the
            // outer retry discard it and establish a fresh IMAP connection before continuing.
            if imap_session_is_desynchronized(&part_error) {
                return Err(part_error);
            }
            if start_offset > 0 {
                return Err(MailError::Imap(format!(
                    "服务器本次未提供可续传的附件分段信息：{part_error}"
                )));
            }
            let payload = fetch_attachment_payload_from_selected(
                session,
                options.remote_uid,
                options.filename,
                options.content_id,
            )?;
            if payload.bytes.len() as i64 > options.max_bytes {
                Err(MailError::Imap(format!(
                    "附件超过当前下载上限（{} MB），且 IMAP 分段下载不可用：{part_error}",
                    options.max_bytes / 1024 / 1024
                )))
            } else {
                writer.write_all(&payload.bytes)?;
                Ok(RemoteAttachmentWrite {
                    filename: payload.filename,
                    size_bytes: payload.bytes.len() as i64,
                    transfer_encoding: AttachmentTransferEncoding::Identity,
                })
            }
        }
    }
}

fn imap_session_is_desynchronized(error: &MailError) -> bool {
    let MailError::Imap(message) = error else {
        return false;
    };
    let message = message.to_ascii_lowercase();
    message.contains("tagmismatch") || message.contains("mismatched tag")
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

pub fn set_remote_flagged(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    remote_uid: i64,
    is_starred: bool,
) -> Result<(), MailError> {
    let uid_set = remote_uid_set(&[remote_uid])?;
    with_selected_mailbox(account, secret, remote_name, |session| {
        let query = if is_starred {
            "+FLAGS.SILENT (\\Flagged)"
        } else {
            "-FLAGS.SILENT (\\Flagged)"
        };
        session
            .uid_store(uid_set.as_str(), query)
            .map(|_| ())
            .map_err(|error| MailError::Imap(format!("IMAP 回写星标状态失败：{error}")))
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
            "远端 UID 列表为空，无法执行 IMAP 操作。".to_string(),
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
    message_id_header: &str,
) -> Result<Option<i64>, MailError> {
    with_selected_mailbox(account, secret, remote_name, |session| {
        if target_mailbox.trim().is_empty() {
            return Err(MailError::Imap(
                "远端目标文件夹为空，无法移动。".to_string(),
            ));
        }
        let source_uid = if remote_uid > 0 {
            remote_uid
        } else {
            find_remote_uid_by_message_id(session, message_id_header)?.ok_or_else(|| {
                MailError::Imap("无法在源目录唯一定位远端邮件，未执行移动。".to_string())
            })?
        };
        let command = format!(
            "UID MOVE {} {}",
            source_uid,
            quote_imap_string(target_mailbox)?
        );
        let (response, _) = session
            .run(command)
            .map_err(|error| MailError::Imap(format!("IMAP 移动邮件失败：{error}")))?;
        if let Some(target_uid) = parse_copyuid_target(&response, source_uid) {
            return Ok(Some(target_uid));
        }
        if message_id_header.trim().is_empty() || session.select(target_mailbox).is_err() {
            return Ok(None);
        }
        find_remote_uid_by_message_id(session, message_id_header)
    })
}

pub fn delete_remote_messages(
    account: &Account,
    secret: &AccountSecret,
    remote_name: &str,
    candidates: &[RemoteDeleteCandidate],
) -> Result<RemoteDeleteBatchResult, MailError> {
    with_selected_mailbox(account, secret, remote_name, |session| {
        let mut remote_uids = BTreeSet::new();
        let mut skipped_count = 0_i64;
        for candidate in candidates {
            if candidate.remote_uid > 0 {
                remote_uids.insert(candidate.remote_uid);
                continue;
            }
            match find_remote_uid_by_message_id(session, &candidate.message_id_header)? {
                Some(remote_uid) => {
                    remote_uids.insert(remote_uid);
                }
                None => skipped_count += 1,
            }
        }
        if remote_uids.is_empty() {
            return Ok(RemoteDeleteBatchResult {
                deleted_count: 0,
                skipped_count,
            });
        }
        let uid_set = remote_uid_set(&remote_uids.into_iter().collect::<Vec<_>>())?;
        session
            .uid_store(&uid_set, "+FLAGS.SILENT (\\Deleted)")
            .map_err(|error| MailError::Imap(format!("IMAP 标记删除失败：{error}")))?;
        session
            .uid_expunge(&uid_set)
            .map_err(|error| MailError::Imap(format!("IMAP 删除邮件失败：{error}")))?;
        Ok(RemoteDeleteBatchResult {
            deleted_count: uid_set.split(',').count() as i64,
            skipped_count,
        })
    })
}

fn find_remote_uid_by_message_id(
    session: &mut imap::Session<imap::Connection>,
    message_id_header: &str,
) -> Result<Option<i64>, MailError> {
    if message_id_header.trim().is_empty() {
        return Ok(None);
    }
    let query = format!(
        "HEADER Message-ID {}",
        quote_imap_string(message_id_header)?
    );
    let remote_uids = session
        .uid_search(query)
        .map_err(|error| MailError::Imap(format!("IMAP 按 Message-ID 定位邮件失败：{error}")))?;
    if remote_uids.len() != 1 {
        return Ok(None);
    }
    Ok(remote_uids.into_iter().next().map(i64::from))
}

fn find_any_remote_uid_by_message_id(
    session: &mut imap::Session<imap::Connection>,
    message_id_header: &str,
) -> Result<Option<i64>, MailError> {
    if message_id_header.trim().is_empty() {
        return Ok(None);
    }
    let query = format!(
        "HEADER Message-ID {}",
        quote_imap_string(message_id_header)?
    );
    let remote_uids = session
        .uid_search(query)
        .map_err(|error| MailError::Imap(format!("IMAP 按 Message-ID 检查留档失败：{error}")))?;
    Ok(remote_uids.into_iter().max().map(i64::from))
}

fn quote_imap_string(value: &str) -> Result<String, MailError> {
    let value = value.trim();
    if value.is_empty()
        || value
            .chars()
            .any(|character| matches!(character, '\r' | '\n' | '\0'))
    {
        return Err(MailError::Imap("IMAP 参数包含无效字符。".to_string()));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

fn parse_copyuid_target(response: &[u8], source_uid: i64) -> Option<i64> {
    let response = String::from_utf8_lossy(response);
    let uppercase = response.to_ascii_uppercase();
    let marker = uppercase.find("COPYUID ")?;
    let mut parts = response[marker + "COPYUID ".len()..]
        .split(|character: char| character.is_whitespace() || character == ']')
        .filter(|part| !part.is_empty());
    let _uid_validity = parts.next()?;
    let source_set = parts.next()?;
    let target_set = parts.next()?;
    if parse_single_uid_set(source_set)? != source_uid {
        return None;
    }
    parse_single_uid_set(target_set)
}

fn parse_single_uid_set(value: &str) -> Option<i64> {
    if value.contains(',') {
        return None;
    }
    let mut bounds = value.split(':');
    let start = bounds.next()?.parse::<i64>().ok()?;
    let end = bounds.next().map(str::parse::<i64>).transpose().ok()?;
    if bounds.next().is_some() || end.is_some_and(|end| end != start) {
        return None;
    }
    (start > 0).then_some(start)
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
    content_id: &str,
) -> Result<RemoteAttachmentPayload, MailError> {
    let fetches = session
        .uid_fetch(remote_uid.to_string(), "RFC822")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取正文失败：{error}")))?;
    let raw = fetches
        .iter()
        .find_map(|fetch| fetch.body())
        .map(|bytes| bytes.to_vec())
        .ok_or_else(|| MailError::Imap("IMAP 未返回邮件正文。".to_string()))?;
    parse_attachment_payload_from_raw(&raw, filename, content_id).ok_or_else(|| {
        MailError::Imap(format!(
            "IMAP 正文中未找到附件：{}",
            attachment_lookup_label(filename, content_id)
        ))
    })
}

fn find_attachment_part_metadata(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    filename: &str,
    content_id: &str,
) -> Result<AttachmentPartMetadata, MailError> {
    let requested = filename.trim();
    let requested_content_id = protocol::normalize_content_id(Some(content_id));
    let fetches = session
        .uid_fetch(remote_uid.to_string(), "BODYSTRUCTURE")
        .map_err(|error| MailError::Imap(format!("IMAP 拉取 BODYSTRUCTURE 失败：{error}")))?;
    let bodystructure = fetches
        .iter()
        .find_map(|fetch| fetch.bodystructure())
        .ok_or_else(|| MailError::Imap("IMAP 未返回 BODYSTRUCTURE。".to_string()))?;
    attachment_part_metadata(bodystructure, requested, &requested_content_id).ok_or_else(|| {
        MailError::Imap(format!(
            "IMAP BODYSTRUCTURE 中未找到附件：{}",
            attachment_lookup_label(requested, &requested_content_id)
        ))
    })
}

fn download_attachment_part_to_writer(
    session: &mut imap::Session<imap::Connection>,
    remote_uid: i64,
    filename: &str,
    max_bytes: i64,
    start_offset: usize,
    writer: &mut impl Write,
    part: AttachmentPartMetadata,
) -> Result<RemoteAttachmentWrite, MailError> {
    let requested = filename.trim();
    let transfer_limit = part.transfer_encoding.max_transfer_bytes(max_bytes);
    if part.encoded_octets > transfer_limit {
        return Err(MailError::Imap(format!(
            "附件传输内容超过安全上限（{} MB）。",
            transfer_limit / 1024 / 1024
        )));
    }
    if start_offset as i64 > transfer_limit {
        return Err(MailError::Imap(format!(
            "附件断点超过当前传输安全上限（{} MB）。",
            transfer_limit / 1024 / 1024
        )));
    }
    let section_path = SectionPath::Part(part.path.clone(), None);
    let section = part
        .path
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".");

    let mut offset = start_offset;
    let mut written = start_offset;
    loop {
        let query = format!(
            "BODY.PEEK[{section}]<{}.{}>",
            offset, ATTACHMENT_CHUNK_BYTES
        );
        let fetches = session
            .uid_fetch(remote_uid.to_string(), query.as_str())
            .map_err(|error| MailError::Imap(format!("IMAP 分段拉取附件失败：{error}")))?;
        let chunk = fetches
            .iter()
            .find_map(|fetch| fetch.section(&section_path))
            .map(ToOwned::to_owned)
            .ok_or_else(|| MailError::Imap("IMAP 未返回附件分段数据。".to_string()))?;
        if chunk.is_empty() {
            break;
        }
        written += chunk.len();
        if written as i64 > transfer_limit {
            return Err(MailError::Imap(format!(
                "附件传输内容超过安全上限（{} MB）。",
                transfer_limit / 1024 / 1024
            )));
        }
        writer.write_all(&chunk)?;
        if chunk.len() < ATTACHMENT_CHUNK_BYTES {
            break;
        }
        offset += chunk.len();
    }
    if part.encoded_octets > 0 && (written as i64) < part.encoded_octets {
        return Err(MailError::Imap(format!(
            "附件分段提前结束：已获取 {written} 字节，服务器声明 {} 字节。",
            part.encoded_octets
        )));
    }

    Ok(RemoteAttachmentWrite {
        filename: requested.to_string(),
        size_bytes: written as i64,
        transfer_encoding: part.transfer_encoding,
    })
}

fn attachment_part_metadata(
    bodystructure: &BodyStructure<'_>,
    filename: &str,
    content_id: &str,
) -> Option<AttachmentPartMetadata> {
    let parser = BodyStructParser::new(bodystructure);
    let requested = filename.trim();
    let requested_content_id = protocol::normalize_content_id(Some(content_id));
    let path = parser.search(|body| {
        if !requested_content_id.is_empty() {
            return attachment_content_id_from_bodystructure(body)
                .is_some_and(|value| value == requested_content_id);
        }
        if !requested.is_empty() {
            return attachment_filename_from_bodystructure(body)
                .is_some_and(|name| name == requested);
        }
        attachment_filename_from_bodystructure(body).is_some()
            || attachment_content_id_from_bodystructure(body).is_some()
    })?;
    let body = bodystructure_at_path(bodystructure, &path)?;
    let other = match body {
        BodyStructure::Basic { other, .. }
        | BodyStructure::Text { other, .. }
        | BodyStructure::Message { other, .. } => other,
        BodyStructure::Multipart { .. } => return None,
    };
    Some(AttachmentPartMetadata {
        path,
        transfer_encoding: AttachmentTransferEncoding::from_imap(&other.transfer_encoding),
        encoded_octets: i64::from(other.octets),
    })
}

fn attachment_content_id_from_bodystructure(bodystructure: &BodyStructure<'_>) -> Option<String> {
    let other = match bodystructure {
        BodyStructure::Basic { other, .. }
        | BodyStructure::Text { other, .. }
        | BodyStructure::Message { other, .. } => other,
        BodyStructure::Multipart { .. } => return None,
    };
    let normalized = protocol::normalize_content_id(other.id.as_deref());
    (!normalized.is_empty()).then_some(normalized)
}

fn attachment_lookup_label(filename: &str, content_id: &str) -> String {
    let content_id = protocol::normalize_content_id(Some(content_id));
    if !content_id.is_empty() {
        return format!("Content-ID {content_id}");
    }
    let filename = filename.trim();
    if filename.is_empty() {
        "未命名附件".to_string()
    } else {
        filename.to_string()
    }
}

fn bodystructure_at_path<'a>(
    bodystructure: &'a BodyStructure<'a>,
    path: &[u32],
) -> Option<&'a BodyStructure<'a>> {
    let mut current = bodystructure;
    for part in path {
        let BodyStructure::Multipart { bodies, .. } = current else {
            return None;
        };
        current = bodies.get(part.checked_sub(1)? as usize)?;
    }
    Some(current)
}

pub fn decode_attachment_transfer(
    reader: &mut impl Read,
    writer: &mut impl Write,
    transfer_encoding: &AttachmentTransferEncoding,
    max_decoded_bytes: i64,
) -> Result<i64, MailError> {
    match transfer_encoding {
        AttachmentTransferEncoding::Identity => {
            copy_attachment_bytes(reader, writer, max_decoded_bytes)
        }
        AttachmentTransferEncoding::Base64 => {
            decode_base64_attachment(reader, writer, max_decoded_bytes)
        }
        AttachmentTransferEncoding::QuotedPrintable => {
            decode_quoted_printable_attachment(reader, writer, max_decoded_bytes)
        }
        AttachmentTransferEncoding::Other(value) => Err(MailError::Imap(format!(
            "附件使用了暂不支持的传输编码：{value}"
        ))),
    }
}

fn copy_attachment_bytes(
    reader: &mut impl Read,
    writer: &mut impl Write,
    max_decoded_bytes: i64,
) -> Result<i64, MailError> {
    let mut total = 0_i64;
    let mut buffer = [0_u8; 32 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        write_decoded_bytes(writer, &buffer[..count], &mut total, max_decoded_bytes)?;
    }
    Ok(total)
}

fn decode_base64_attachment(
    reader: &mut impl Read,
    writer: &mut impl Write,
    max_decoded_bytes: i64,
) -> Result<i64, MailError> {
    let mut input = [0_u8; 32 * 1024];
    let mut quartet = [0_u8; 4];
    let mut quartet_len = 0_usize;
    let mut finished = false;
    let mut output = Vec::with_capacity(32 * 1024);
    let mut total = 0_i64;

    loop {
        let count = reader.read(&mut input)?;
        if count == 0 {
            break;
        }
        for &byte in &input[..count] {
            if byte.is_ascii_whitespace() {
                continue;
            }
            if finished {
                return Err(MailError::Imap(
                    "附件 Base64 结尾后仍包含非空白数据。".to_string(),
                ));
            }
            quartet[quartet_len] = byte;
            quartet_len += 1;
            if quartet_len < quartet.len() {
                continue;
            }
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(quartet)
                .map_err(|error| MailError::Imap(format!("附件 Base64 解码失败：{error}")))?;
            output.extend_from_slice(&decoded);
            finished = quartet.contains(&b'=');
            quartet_len = 0;
            flush_decoded_buffer(writer, &mut output, &mut total, max_decoded_bytes, false)?;
        }
    }

    if quartet_len == 1 {
        return Err(MailError::Imap("附件 Base64 数据长度不完整。".to_string()));
    }
    if quartet_len > 1 {
        for byte in quartet.iter_mut().skip(quartet_len) {
            *byte = b'=';
        }
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(quartet)
            .map_err(|error| MailError::Imap(format!("附件 Base64 解码失败：{error}")))?;
        output.extend_from_slice(&decoded);
    }
    flush_decoded_buffer(writer, &mut output, &mut total, max_decoded_bytes, true)?;
    Ok(total)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuotedPrintableDecodeState {
    Normal,
    Equals,
    EqualsCr,
    Hex(u8),
}

fn decode_quoted_printable_attachment(
    reader: &mut impl Read,
    writer: &mut impl Write,
    max_decoded_bytes: i64,
) -> Result<i64, MailError> {
    let mut input = [0_u8; 32 * 1024];
    let mut output = Vec::with_capacity(32 * 1024);
    let mut total = 0_i64;
    let mut state = QuotedPrintableDecodeState::Normal;

    loop {
        let count = reader.read(&mut input)?;
        if count == 0 {
            break;
        }
        for &byte in &input[..count] {
            state = match state {
                QuotedPrintableDecodeState::Normal if byte == b'=' => {
                    QuotedPrintableDecodeState::Equals
                }
                QuotedPrintableDecodeState::Normal => {
                    output.push(byte);
                    QuotedPrintableDecodeState::Normal
                }
                QuotedPrintableDecodeState::Equals if byte == b'\n' => {
                    QuotedPrintableDecodeState::Normal
                }
                QuotedPrintableDecodeState::Equals if byte == b'\r' => {
                    QuotedPrintableDecodeState::EqualsCr
                }
                QuotedPrintableDecodeState::Equals if matches!(byte, b' ' | b'\t') => {
                    QuotedPrintableDecodeState::Equals
                }
                QuotedPrintableDecodeState::Equals => {
                    let Some(value) = hex_value(byte) else {
                        return Err(MailError::Imap(format!(
                            "附件 Quoted-Printable 包含无效字符：0x{byte:02X}"
                        )));
                    };
                    QuotedPrintableDecodeState::Hex(value)
                }
                QuotedPrintableDecodeState::EqualsCr if byte == b'\n' => {
                    QuotedPrintableDecodeState::Normal
                }
                QuotedPrintableDecodeState::EqualsCr => {
                    return Err(MailError::Imap(
                        "附件 Quoted-Printable 软换行格式无效。".to_string(),
                    ));
                }
                QuotedPrintableDecodeState::Hex(high) => {
                    let Some(low) = hex_value(byte) else {
                        return Err(MailError::Imap(format!(
                            "附件 Quoted-Printable 包含无效十六进制字符：0x{byte:02X}"
                        )));
                    };
                    output.push((high << 4) | low);
                    QuotedPrintableDecodeState::Normal
                }
            };
            flush_decoded_buffer(writer, &mut output, &mut total, max_decoded_bytes, false)?;
        }
    }

    if state != QuotedPrintableDecodeState::Normal {
        return Err(MailError::Imap(
            "附件 Quoted-Printable 数据在转义序列中提前结束。".to_string(),
        ));
    }
    flush_decoded_buffer(writer, &mut output, &mut total, max_decoded_bytes, true)?;
    Ok(total)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn flush_decoded_buffer(
    writer: &mut impl Write,
    buffer: &mut Vec<u8>,
    total: &mut i64,
    max_decoded_bytes: i64,
    force: bool,
) -> Result<(), MailError> {
    if buffer.is_empty() || (!force && buffer.len() < 32 * 1024) {
        return Ok(());
    }
    write_decoded_bytes(writer, buffer, total, max_decoded_bytes)?;
    buffer.clear();
    Ok(())
}

fn write_decoded_bytes(
    writer: &mut impl Write,
    bytes: &[u8],
    total: &mut i64,
    max_decoded_bytes: i64,
) -> Result<(), MailError> {
    let next_total = total.saturating_add(bytes.len() as i64);
    if next_total > max_decoded_bytes {
        return Err(MailError::Imap(format!(
            "附件解码后超过当前下载上限（{} MB）。",
            max_decoded_bytes / 1024 / 1024
        )));
    }
    writer.write_all(bytes)?;
    *total = next_total;
    Ok(())
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
    crate::mime::decode_rfc2231_params(params?)
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
    let mut session = match secret {
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
    }?;
    send_imap_client_id_if_needed(&mut session, account);
    Ok(session)
}

fn send_imap_client_id_if_needed(session: &mut imap::Session<imap::Connection>, account: &Account) {
    if !needs_imap_client_id(account) {
        return;
    }
    let command = match imap_client_id_command() {
        Ok(command) => command,
        Err(error) => {
            crate::logging::log_line(format!(
                "[better-email][imap] client id build failed email={} error={error}",
                mask_imap_email(&account.email),
            ));
            return;
        }
    };
    match session.run_command_and_check_ok(&command) {
        Ok(()) => imap_info(format!(
            "[better-email][imap] client id sent email={} provider={} host={}",
            mask_imap_email(&account.email),
            account.provider,
            account.imap_host,
        )),
        Err(error) => crate::logging::log_line(format!(
            "[better-email][imap] client id failed email={} provider={} host={} error={error}",
            mask_imap_email(&account.email),
            account.provider,
            account.imap_host,
        )),
    }
}

fn needs_imap_client_id(account: &Account) -> bool {
    let provider = account.provider.trim().to_ascii_lowercase();
    let email = account.email.trim().to_ascii_lowercase();
    let host = account.imap_host.trim().to_ascii_lowercase();
    provider.contains("netease")
        || provider == "163"
        || provider == "126"
        || provider == "yeah"
        || provider == "188"
        || email.ends_with("@163.com")
        || email.ends_with("@126.com")
        || email.ends_with("@yeah.net")
        || email.ends_with("@188.com")
        || host.contains("imap.163.com")
        || host.contains("imap.126.com")
        || host.contains("imap.yeah.net")
        || host.contains("imap.188.com")
}

fn imap_client_id_command() -> Result<String, MailError> {
    let fields = [
        ("name", "Better Email"),
        ("version", env!("CARGO_PKG_VERSION")),
        ("vendor", "Better Email"),
    ];
    let parts = fields
        .iter()
        .map(|(key, value)| {
            Ok(format!(
                "{} {}",
                quote_imap_string(key)?,
                quote_imap_string(value)?
            ))
        })
        .collect::<Result<Vec<_>, MailError>>()?;
    Ok(format!("ID ({})", parts.join(" ")))
}

fn mask_imap_email(email: &str) -> String {
    let trimmed = email.trim();
    if let Some((local, domain)) = trimmed.split_once('@') {
        let first = local.chars().next().unwrap_or('*');
        return format!("{first}***@{domain}");
    }
    "***".to_string()
}

#[cfg(test)]
fn imap_xoauth2_response(user: &str, access_token: &str) -> String {
    imap::Authenticator::process(&XOAuth2Authenticator { user, access_token }, &[])
}

fn header_from_fetch(uid: i64, fetch: &imap::types::Fetch<'_>) -> RemoteMessageHeader {
    let header_bytes = fetch.header().unwrap_or_default();
    let parsed = MessageParser::new()
        .with_minimal_headers()
        .with_message_ids()
        .parse(header_bytes);
    let header_fields = crate::mime::extract_header_fields(header_bytes);
    let header_field = |name: &str| {
        header_fields
            .iter()
            .find(|(field_name, _)| field_name == name)
            .map(|(_, value)| crate::mime::decode_header_value_bytes(value))
    };
    let subject = parsed
        .as_ref()
        .and_then(|message| message.subject())
        .map(ToOwned::to_owned)
        .or_else(|| header_field("subject"))
        .unwrap_or_else(|| "(无主题)".to_string());
    let from = parsed
        .as_ref()
        .and_then(|message| message.from())
        .map(protocol::format_address_list)
        .or_else(|| header_field("from"))
        .unwrap_or_default();
    let to = parsed
        .as_ref()
        .and_then(|message| message.to())
        .map(protocol::format_address_list)
        .or_else(|| header_field("to"))
        .unwrap_or_default();
    let message_id = header_field("message-id").unwrap_or_else(|| format!("imap-{uid}"));
    let in_reply_to = header_field("in-reply-to").unwrap_or_default();
    let references = header_field("references").unwrap_or_default();
    let received_at = fetch
        .internal_date()
        .map(|date| date.to_rfc3339())
        .or_else(|| header_field("date"))
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let flags = format!("{:?}", fetch.flags());

    RemoteMessageHeader {
        remote_uid: uid,
        message_id,
        in_reply_to,
        references,
        subject: subject.trim().to_string(),
        sender_name: display_name_from_address(&from),
        sender_email: email_from_address(&from),
        recipients: to,
        snippet: "远端邮件头已同步，正文将在按需读取阶段拉取。".to_string(),
        received_at,
        is_read: flags.contains("Seen"),
        is_starred: flags.contains("Flagged"),
    }
}

fn flag_state_from_fetch(fetch: &imap::types::Fetch<'_>) -> Option<ImapFlagState> {
    let remote_uid = fetch.uid.map(i64::from)?;
    let flags = format!("{:?}", fetch.flags());
    Some(ImapFlagState {
        remote_uid,
        is_read: flags.contains("Seen"),
        is_starred: flags.contains("Flagged"),
    })
}

fn display_name_from_address(address: &str) -> String {
    let decoded = protocol::decode_address_header_value(address);
    decoded
        .split('<')
        .next()
        .map(|name| name.trim().trim_matches('"').to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| email_from_address(&decoded))
}

fn email_from_address(address: &str) -> String {
    let decoded = protocol::decode_address_header_value(address);
    if let Some((_, rest)) = decoded.split_once('<') {
        rest.split('>')
            .next()
            .unwrap_or(&decoded)
            .trim()
            .to_string()
    } else {
        decoded.trim().to_string()
    }
}

#[cfg(test)]
fn parse_body_from_raw(raw: &[u8]) -> RemoteMessageBody {
    let parsed = MessageParser::default().parse(raw);
    let raw_lossy = String::from_utf8_lossy(raw);
    let has_html_part =
        crate::mime::contains_ascii_case_insensitive(raw, b"content-type: text/html");
    let header_fields = crate::mime::extract_header_fields(raw);
    let (_, body_bytes) = crate::mime::split_header_body(raw);
    let fallback_body = crate::mime::decode_body_text(
        body_bytes,
        crate::mime::content_transfer_encoding(&header_fields).as_deref(),
        crate::mime::content_type_charset(&header_fields).as_deref(),
    );
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
    let has_renderable_html = has_html_part && looks_like_html(&html_body);
    let body = if has_renderable_html {
        html_body.clone()
    } else if !text_body.trim().is_empty() {
        text_body.clone()
    } else if parsed.is_none() {
        fallback_body.clone()
    } else {
        String::new()
    };
    let sanitized_html = if has_renderable_html {
        protocol::sanitize_html(&html_body)
    } else {
        String::new()
    };
    let security_warnings = reader_security_warnings(&raw_lossy, &html_body);
    let snippet = protocol::message_body_snippet(&text_body, &html_body, &fallback_body);
    let attachments = parsed
        .as_ref()
        .map(remote_attachment_metadata_from_message)
        .unwrap_or_default();

    RemoteMessageBody {
        body,
        sanitized_html,
        security_warnings,
        snippet,
        has_attachments: !attachments.is_empty(),
        attachments,
    }
}

fn attachment_display_name(part: &MessagePart<'_>) -> String {
    part.attachment_name()
        .map(crate::mime::decode_attachment_filename)
        .unwrap_or_default()
}

#[cfg(test)]
fn remote_attachment_metadata_from_message(message: &Message<'_>) -> Vec<RemoteAttachmentMetadata> {
    let mut attachments = Vec::new();
    let mut seen_inline_content_ids = BTreeSet::new();

    for (index, part) in message.attachments().enumerate() {
        let metadata = remote_attachment_metadata_from_part(part, index);
        if metadata.is_inline && !metadata.content_id.is_empty() {
            seen_inline_content_ids.insert(metadata.content_id.clone());
        }
        attachments.push(metadata);
    }

    for (index, part) in message.parts.iter().enumerate() {
        let content_id = protocol::normalize_content_id(part.content_id());
        if content_id.is_empty() || seen_inline_content_ids.contains(&content_id) {
            continue;
        }
        let mime_type = part_mime_type(part);
        if !mime_type.to_ascii_lowercase().starts_with("image/") || !part.is_binary() {
            continue;
        }

        imap_info(format!(
            "[better-email][imap] inline cid part recovered content_id={} mime={} bytes={}",
            content_id,
            mime_type,
            part.contents().len()
        ));
        seen_inline_content_ids.insert(content_id.clone());
        let filename = attachment_display_name(part);
        attachments.push(RemoteAttachmentMetadata {
            filename: if filename.is_empty() {
                protocol::inline_attachment_filename(&mime_type, &content_id, index)
            } else {
                filename
            },
            mime_type,
            size_bytes: part.contents().len() as i64,
            content_id,
            is_inline: true,
        });
    }

    attachments
}

#[cfg(test)]
fn remote_attachment_metadata_from_part(
    part: &MessagePart<'_>,
    index: usize,
) -> RemoteAttachmentMetadata {
    let mime_type = part_mime_type(part);
    let content_id = protocol::normalize_content_id(part.content_id());
    let is_inline = part
        .content_disposition()
        .is_some_and(|disposition| disposition.is_inline())
        || !content_id.is_empty();
    let filename = attachment_display_name(part);

    RemoteAttachmentMetadata {
        filename: if filename.is_empty() {
            protocol::inline_attachment_filename(&mime_type, &content_id, index)
        } else {
            filename
        },
        mime_type,
        size_bytes: part.contents().len() as i64,
        content_id,
        is_inline,
    }
}

fn part_mime_type(part: &MessagePart<'_>) -> String {
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

    if mime_type.eq_ignore_ascii_case("application/octet-stream") {
        if let Some(inferred) = infer_image_mime_type_from_part(part) {
            return inferred.to_string();
        }
    }

    mime_type
}

fn infer_image_mime_type_from_part(part: &MessagePart<'_>) -> Option<&'static str> {
    let filename = part.attachment_name().unwrap_or("");
    let content_id = part.content_id().unwrap_or("");
    let lower = format!("{filename} {content_id}").to_ascii_lowercase();

    if lower.contains(".png") {
        Some("image/png")
    } else if lower.contains(".jpg") || lower.contains(".jpeg") {
        Some("image/jpeg")
    } else if lower.contains(".gif") {
        Some("image/gif")
    } else if lower.contains(".webp") {
        Some("image/webp")
    } else if lower.contains(".svg") {
        Some("image/svg+xml")
    } else if lower.contains(".bmp") {
        Some("image/bmp")
    } else if lower.contains(".ico") {
        Some("image/x-icon")
    } else if lower.contains(".heic") {
        Some("image/heic")
    } else if lower.contains(".heif") {
        Some("image/heif")
    } else {
        None
    }
}

fn looks_like_html(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "<!doctype",
        "<html",
        "<body",
        "<div",
        "<p",
        "<table",
        "<a ",
        "<img",
        "<span",
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
    if protocol::html_has_remote_images(html_body) || protocol::html_has_remote_images(raw) {
        warnings.push("检测到远程图片，默认已阻止自动加载。".to_string());
    }
    warnings.extend(protocol::link_risk_warnings(html_body));
    warnings
}

fn parse_attachment_payload_from_raw(
    raw: &[u8],
    filename: &str,
    content_id: &str,
) -> Option<RemoteAttachmentPayload> {
    let requested = filename.trim();
    let requested_content_id = protocol::normalize_content_id(Some(content_id));
    let parsed = MessageParser::default().parse(raw)?;
    let attachments = remote_payload_parts(&parsed);
    if requested.is_empty() && requested_content_id.is_empty() {
        let (index, part) = attachments.first()?;
        let mime_type = part_mime_type(part);
        let part_content_id = protocol::normalize_content_id(part.content_id());
        let filename = attachment_display_name(part);
        return Some(RemoteAttachmentPayload {
            filename: if filename.is_empty() {
                protocol::inline_attachment_filename(&mime_type, &part_content_id, *index)
            } else {
                filename
            },
            bytes: part.contents().to_vec(),
        });
    }

    let payload = attachments.into_iter().find_map(|(index, part)| {
        let part_name = part.attachment_name().unwrap_or("");
        let part_content_id = protocol::normalize_content_id(part.content_id());
        let matches = if !requested_content_id.is_empty() {
            part_content_id == requested_content_id
        } else {
            part_name == requested
        };
        if matches {
            let mime_type = part_mime_type(part);
            let payload_filename = if part_name.is_empty() {
                protocol::inline_attachment_filename(&mime_type, &part_content_id, index)
            } else {
                crate::mime::decode_attachment_filename(part_name)
            };
            Some(RemoteAttachmentPayload {
                filename: payload_filename,
                bytes: part.contents().to_vec(),
            })
        } else {
            None
        }
    });
    payload
}

fn remote_payload_parts<'a>(message: &'a Message<'a>) -> Vec<(usize, &'a MessagePart<'a>)> {
    let mut parts = Vec::new();
    let mut seen_inline_content_ids = BTreeSet::new();

    for (index, part) in message.attachments().enumerate() {
        let content_id = protocol::normalize_content_id(part.content_id());
        if !content_id.is_empty() {
            seen_inline_content_ids.insert(content_id);
        }
        parts.push((index, part));
    }

    for (index, part) in message.parts.iter().enumerate() {
        let content_id = protocol::normalize_content_id(part.content_id());
        if content_id.is_empty() || seen_inline_content_ids.contains(&content_id) {
            continue;
        }
        let mime_type = part_mime_type(part);
        if mime_type.to_ascii_lowercase().starts_with("image/") && part.is_binary() {
            seen_inline_content_ids.insert(content_id);
            parts.push((index, part));
        }
    }

    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attachment_session_retries_after_protocol_desync() {
        let mut attempts = 0;
        let mut delays = Vec::new();
        let value = retry_attachment_session_with_sleeper(
            || {
                attempts += 1;
                if attempts < ATTACHMENT_FETCH_ATTEMPTS {
                    Err(MailError::Imap(
                        "IMAP 拉取正文失败：Mismatched Tag: TagMismatch".to_string(),
                    ))
                } else {
                    Ok(42)
                }
            },
            |delay| delays.push(delay),
        )
        .expect("third attachment session attempt should succeed");

        assert_eq!(value, 42);
        assert_eq!(attempts, ATTACHMENT_FETCH_ATTEMPTS);
        assert_eq!(
            delays,
            vec![Duration::from_millis(150), Duration::from_millis(300)]
        );
    }

    #[test]
    fn attachment_session_reports_exhausted_retries() {
        let mut attempts = 0;
        let mut delays = Vec::new();
        let error = retry_attachment_session_with_sleeper::<()>(
            || {
                attempts += 1;
                Err(MailError::Imap("connection reset".to_string()))
            },
            |delay| delays.push(delay),
        )
        .expect_err("attachment fetch should fail after retries");

        assert_eq!(attempts, ATTACHMENT_FETCH_ATTEMPTS);
        assert_eq!(
            delays,
            vec![Duration::from_millis(150), Duration::from_millis(300)]
        );
        assert!(error.to_string().contains("3 次尝试"));
        assert!(error.to_string().contains("connection reset"));
    }

    #[test]
    fn attachment_session_does_not_retry_local_write_errors() {
        let mut attempts = 0;
        let error = retry_attachment_session_with_sleeper::<()>(
            || {
                attempts += 1;
                Err(MailError::Io(std::io::Error::other("disk full")))
            },
            |_| panic!("local write errors must not be retried"),
        )
        .expect_err("local write error should be returned directly");

        assert_eq!(attempts, 1);
        assert_eq!(error.to_string(), "file system error: disk full");
    }

    #[test]
    fn detects_imap_tag_mismatch_as_session_desync() {
        assert!(imap_session_is_desynchronized(&MailError::Imap(
            "IMAP 拉取正文失败：Mismatched Tag: TagMismatch { expect: 8, actual: Ok(5) }"
                .to_string(),
        )));
        assert!(!imap_session_is_desynchronized(&MailError::Imap(
            "IMAP 未返回邮件正文。".to_string(),
        )));
    }

    #[test]
    fn attachment_transfer_decodes_base64_with_mime_whitespace() {
        let mut reader = std::io::Cursor::new(b"QmV0dGVy\r\nIEVtYWlsIQ==\n");
        let mut output = Vec::new();
        let size = decode_attachment_transfer(
            &mut reader,
            &mut output,
            &AttachmentTransferEncoding::Base64,
            1024,
        )
        .expect("base64 attachment should decode");

        assert_eq!(size, 13);
        assert_eq!(output, b"Better Email!");
    }

    #[test]
    fn attachment_transfer_decodes_quoted_printable_across_soft_lines() {
        let mut reader = std::io::Cursor::new(b"Better=20Email=\r\n=21");
        let mut output = Vec::new();
        let size = decode_attachment_transfer(
            &mut reader,
            &mut output,
            &AttachmentTransferEncoding::QuotedPrintable,
            1024,
        )
        .expect("quoted-printable attachment should decode");

        assert_eq!(size, 13);
        assert_eq!(output, b"Better Email!");
    }

    #[test]
    fn attachment_transfer_rejects_decoded_size_over_limit() {
        let mut reader = std::io::Cursor::new(b"1234");
        let mut output = Vec::new();
        let error = decode_attachment_transfer(
            &mut reader,
            &mut output,
            &AttachmentTransferEncoding::Identity,
            3,
        )
        .expect_err("oversized decoded attachment should fail");

        assert!(error.to_string().contains("解码后超过"));
        assert!(output.is_empty());
    }

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
    fn detects_netease_accounts_that_need_imap_client_id() {
        let mut account = Account {
            id: 1,
            email: "user@163.com".to_string(),
            display_name: "User".to_string(),
            provider: "netease".to_string(),
            imap_host: "imap.163.com:993".to_string(),
            smtp_host: "smtp.163.com:465".to_string(),
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
            onboarding_completed: false,
            is_default: true,
        };
        assert!(needs_imap_client_id(&account));

        account.provider = "custom".to_string();
        account.email = "user@example.com".to_string();
        account.imap_host = "imap.example.com:993".to_string();
        assert!(!needs_imap_client_id(&account));
    }

    #[test]
    fn builds_rfc2971_imap_client_id_command() {
        assert_eq!(
            imap_client_id_command().unwrap(),
            format!(
                "ID (\"name\" \"Better Email\" \"version\" \"{}\" \"vendor\" \"Better Email\")",
                env!("CARGO_PKG_VERSION")
            )
        );
    }

    #[test]
    fn builds_deduplicated_remote_uid_set() {
        assert_eq!(remote_uid_set(&[3, 1, 3, 0, -1]).unwrap(), "1,3");
        assert!(remote_uid_set(&[0, -1]).is_err());
    }

    #[test]
    fn uid_pages_keep_initial_recent_and_incremental_order_without_gaps() {
        let all_uids = (1..=100).collect::<Vec<_>>();
        assert_eq!(
            select_recent_uid_page(all_uids.clone(), true),
            (76..=100).collect::<Vec<_>>()
        );
        assert_eq!(
            select_recent_uid_page(all_uids, false),
            (1..=25).collect::<Vec<_>>()
        );
    }

    #[test]
    fn history_uid_page_stays_adjacent_to_low_watermark() {
        assert_eq!(
            select_history_uid_page((1..=75).collect()),
            (51..=75).collect::<Vec<_>>()
        );
    }

    #[test]
    fn history_only_fetch_bootstraps_empty_or_reset_cursors() {
        assert!(should_fetch_recent(false, false, 0, 0));
        assert!(should_fetch_recent(false, true, 100, 76));
        assert!(!should_fetch_recent(false, false, 100, 76));
    }

    #[test]
    fn parses_copyuid_for_single_message_move() {
        let response = b"* OK [COPYUID 1511554416 142 41] Moved UID.\r\na1 OK Move completed\r\n";
        assert_eq!(parse_copyuid_target(response, 142), Some(41));
        assert_eq!(parse_copyuid_target(response, 143), None);
        assert_eq!(
            parse_copyuid_target(b"a1 OK [COPYUID 1 142:142 41:41]\r\n", 142),
            Some(41)
        );
        assert_eq!(
            parse_copyuid_target(b"a1 OK [COPYUID 1 142,143 41,42]\r\n", 142),
            None
        );
    }

    #[test]
    fn quotes_imap_strings_and_rejects_line_breaks() {
        assert_eq!(
            quote_imap_string("Projects/\"Alpha\"").unwrap(),
            "\"Projects/\\\"Alpha\\\"\""
        );
        assert!(quote_imap_string("Projects\r\nEXPUNGE").is_err());
    }

    #[test]
    fn parses_single_append_uidplus_result() {
        assert_eq!(
            single_appended_uid(Some(&[UidSetMember::Uid(42)])),
            Some(42)
        );
        assert_eq!(
            single_appended_uid(Some(&[UidSetMember::UidRange(7..=7)])),
            Some(7)
        );
        assert_eq!(
            single_appended_uid(Some(&[UidSetMember::UidRange(7..=9)])),
            None
        );
        assert_eq!(
            single_appended_uid(Some(&[UidSetMember::Uid(7), UidSetMember::Uid(8)])),
            None
        );
        assert_eq!(single_appended_uid(None), None);
    }

    #[test]
    fn body_fetch_query_does_not_mark_message_seen() {
        // An empty bodystructure path is a single-part text body. Fetching
        // BODY.PEEK[] here would return the entire raw message instead.
        assert_eq!(SINGLE_PART_TEXT_FETCH_QUERY, "BODY.PEEK[TEXT]");
        assert!(SINGLE_PART_TEXT_FETCH_QUERY.contains("PEEK"));
        assert!(!SINGLE_PART_TEXT_FETCH_QUERY.contains("RFC822"));
    }

    #[test]
    fn parses_folded_headers_and_addresses() {
        let headers = b"Subject: Hello\r\n World\r\nFrom: Ada <ada@example.com>\r\n\r\n";
        let fields = crate::mime::extract_header_fields(headers);
        let subject = fields
            .iter()
            .find(|(name, _)| name == "subject")
            .map(|(_, value)| crate::mime::decode_header_value_bytes(value))
            .unwrap();
        assert_eq!(subject, "Hello World");
        assert_eq!(display_name_from_address("Ada <ada@example.com>"), "Ada");
        assert_eq!(
            email_from_address("Ada <ada@example.com>"),
            "ada@example.com"
        );
        assert_eq!(
            display_name_from_address("=?utf-8?B?MTM2NTg0OTkwMjI=?= <13658499022@163.com>"),
            "13658499022"
        );
    }

    #[test]
    fn parses_body_from_raw_message() {
        let body = parse_body_from_raw(
            b"Subject: Body\r\nFrom: Ada <ada@example.com>\r\n\r\nHello body.\r\nSecond line.",
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
            b"Subject: HTML\r\n\
             MIME-Version: 1.0\r\n\
             Content-Type: text/html; charset=utf-8\r\n\
             \r\n\
             <p onclick=\"x()\">Hi</p><script>alert(1)</script><img src=\"http://tracker.example/pixel.png\">",
        );

        assert!(body.body.contains("Hi"));
        assert!(body.body.contains("http://tracker.example/pixel.png"));
        assert!(body.sanitized_html.contains("<p>Hi</p>"));
        assert!(!body.sanitized_html.contains("<script"));
        assert!(!body.sanitized_html.contains("onclick"));
        assert!(!body.sanitized_html.contains("src=\"http"));
        assert!(body.security_warnings.len() >= 3);
    }

    #[test]
    fn flags_reader_phishing_link_domain_mismatch() {
        let body = parse_body_from_raw(
            b"Subject: HTML\r\n\
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
            b"Subject: Attachment\r\n\
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
            b"Subject: Attachment\r\n\
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
            "",
        )
        .unwrap();
        assert_eq!(payload.filename, "notes.txt");
        assert_eq!(payload.bytes, b"attachment body");
    }

    #[test]
    fn parses_inline_cid_image_without_filename_from_raw_message() {
        let body = parse_body_from_raw(
            concat!(
                "Subject: Inline image\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/related; boundary=\"rel\"\r\n",
                "\r\n",
                "--rel\r\n",
                "Content-Type: text/html; charset=utf-8\r\n",
                "\r\n",
                "<p>Hello</p><img src=\"cid:image001@example.com\">\r\n",
                "--rel\r\n",
                "Content-Type: image/png\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "Content-ID: <image001@example.com>\r\n",
                "\r\n",
                "aW1hZ2UgYnl0ZXM=\r\n",
                "--rel--\r\n",
            )
            .as_bytes(),
        );

        assert!(body.has_attachments);
        assert_eq!(body.attachments.len(), 1);
        assert_eq!(body.attachments[0].content_id, "image001@example.com");
        assert_eq!(body.attachments[0].mime_type, "image/png");
        assert!(body.attachments[0].is_inline);
        assert!(body.attachments[0].filename.ends_with(".png"));
    }

    #[test]
    fn parses_inline_cid_image_payload_without_filename() {
        let payload = parse_attachment_payload_from_raw(
            concat!(
                "Subject: Inline image\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/related; boundary=\"rel\"\r\n",
                "\r\n",
                "--rel\r\n",
                "Content-Type: text/html; charset=utf-8\r\n",
                "\r\n",
                "<p>Hello</p><img src=\"cid:image001@example.com\">\r\n",
                "--rel\r\n",
                "Content-Type: image/png\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "Content-ID: <image001@example.com>\r\n",
                "\r\n",
                "aW1hZ2UgYnl0ZXM=\r\n",
                "--rel--\r\n",
            )
            .as_bytes(),
            "",
            "IMAGE001@example.com",
        )
        .expect("content id should locate the inline image");

        assert!(payload.filename.ends_with(".png"));
        assert_eq!(payload.bytes, b"image bytes");
    }

    #[test]
    fn infers_inline_cid_image_mime_from_content_id_extension() {
        let body = parse_body_from_raw(
            concat!(
                "Subject: Generic inline image\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/related; boundary=\"rel\"\r\n",
                "\r\n",
                "--rel\r\n",
                "Content-Type: text/html; charset=utf-8\r\n",
                "\r\n",
                "<img src=\"cid:37053DDF@48E10A4E.2A20536A00000000.png\">\r\n",
                "--rel\r\n",
                "Content-Type: application/octet-stream\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "Content-ID: <37053DDF@48E10A4E.2A20536A00000000.png>\r\n",
                "\r\n",
                "aW1hZ2UgYnl0ZXM=\r\n",
                "--rel--\r\n",
            )
            .as_bytes(),
        );

        assert_eq!(body.attachments.len(), 1);
        assert_eq!(body.attachments[0].mime_type, "image/png");
        assert_eq!(
            body.attachments[0].content_id,
            "37053ddf@48e10a4e.2a20536a00000000.png"
        );
        assert!(body.attachments[0].is_inline);
    }

    #[test]
    fn bodystructure_separates_text_parts_from_attachment_metadata() {
        let response = b"* 1569 FETCH (BODYSTRUCTURE (((\"TEXT\" \"PLAIN\" (\"CHARSET\" \"UTF-8\") NIL NIL \"QUOTED-PRINTABLE\" 833 30 NIL NIL NIL)(\"TEXT\" \"HTML\" (\"CHARSET\" \"UTF-8\") NIL NIL \"QUOTED-PRINTABLE\" 3412 62 NIL (\"INLINE\" NIL) NIL) \"ALTERNATIVE\" (\"BOUNDARY\" \"alt\") NIL NIL)(\"APPLICATION\" \"PDF\" (\"NAME\" \"title.pdf\") \"<part-2>\" NIL \"BASE64\" 333980 NIL (\"ATTACHMENT\" (\"FILENAME\" \"title.pdf\")) NIL) \"MIXED\" (\"BOUNDARY\" \"mixed\") NIL NIL))\r\n";
        let (_, parsed) = imap_proto::parser::parse_response(response).unwrap();
        let imap_proto::types::Response::Fetch(_, attributes) = parsed else {
            panic!("expected FETCH response");
        };
        let bodystructure = attributes
            .iter()
            .find_map(|attribute| match attribute {
                imap_proto::types::AttributeValue::BodyStructure(bodystructure) => {
                    Some(bodystructure)
                }
                _ => None,
            })
            .expect("BODYSTRUCTURE should be present");

        let metadata = message_structure_metadata(bodystructure);

        assert_eq!(metadata.text_parts.len(), 2);
        assert_eq!(metadata.text_parts[0].path, vec![1, 1]);
        assert!(!metadata.text_parts[0].is_html);
        assert_eq!(metadata.text_parts[1].path, vec![1, 2]);
        assert!(metadata.text_parts[1].is_html);
        assert_eq!(metadata.attachments.len(), 1);
        assert_eq!(metadata.attachments[0].filename, "title.pdf");
        assert_eq!(metadata.attachments[0].mime_type, "application/pdf");
        assert_eq!(metadata.attachments[0].size_bytes, 333_980);
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

                let metadata = attachment_part_metadata(bodystructure, "title.pdf", "")
                    .expect("attachment metadata should be found");
                assert_eq!(metadata.path, vec![2]);
                assert_eq!(
                    metadata.transfer_encoding,
                    AttachmentTransferEncoding::Base64
                );
                assert_eq!(metadata.encoded_octets, 333_980);
                assert_eq!(
                    attachment_part_metadata(bodystructure, "missing.pdf", ""),
                    None
                );
                assert_eq!(
                    attachment_part_metadata(bodystructure, "missing.pdf", "part-2")
                        .expect("content id should locate attachment")
                        .path,
                    vec![2]
                );
            }
            _ => panic!("expected FETCH response"),
        };
    }

    #[test]
    fn attachment_payload_prefers_content_id_over_duplicate_filename() {
        let raw = concat!(
            "Subject: Inline duplicates\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/related; boundary=\"b\"\r\n",
            "\r\n",
            "--b\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<img src=\"cid:right@example.com\">\r\n",
            "--b\r\n",
            "Content-Type: image/png; name=\"logo.png\"\r\n",
            "Content-Disposition: inline; filename=\"logo.png\"\r\n",
            "Content-ID: <wrong@example.com>\r\n",
            "\r\n",
            "wrong image\r\n",
            "--b\r\n",
            "Content-Type: image/png; name=\"logo.png\"\r\n",
            "Content-Disposition: inline; filename=\"logo.png\"\r\n",
            "Content-ID: <right@example.com>\r\n",
            "\r\n",
            "right image\r\n",
            "--b--\r\n",
        );

        let payload =
            parse_attachment_payload_from_raw(raw.as_bytes(), "logo.png", "RIGHT@example.com")
                .expect("content id should select the matching inline part");
        assert_eq!(payload.filename, "logo.png");
        assert_eq!(payload.bytes, b"right image");
    }

    #[test]
    fn parses_gbk_qp_body_with_chinese_subject_and_attachment() {
        // 用户数据计算过程26日7月汇总 (1) — GBK quoted-printable body,
        // GBK B-encoded subject, GBK B-encoded attachment filename.
        let body = parse_body_from_raw(
            concat!(
                "Subject: =?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?=\r\n",
                "From: =?GBK?B?wO7Hvw==?= <li@example.com>\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/mixed; boundary=\"b\"\r\n",
                "\r\n",
                "--b\r\n",
                "Content-Type: text/plain; charset=GBK\r\n",
                "Content-Transfer-Encoding: quoted-printable\r\n",
                "\r\n",
                "=D3=C3=BB=A7=CA=FD=BE=DD=BC=C6=CB=E3=B9=FD=B3=CC\r\n",
                "--b\r\n",
                "Content-Type: application/vnd.ms-excel; name=\"=?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?=.xlsx\"\r\n",
                "Content-Disposition: attachment; filename=\"=?GBK?B?08O7p8r9vt28xsvjuf2zzDI2yNU31MK749fcICgxKQ==?=.xlsx\"\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "\r\n",
                "YXR0YWNobWVudCBieXRlcw==\r\n",
                "--b--\r\n",
            )
            .as_bytes(),
        );

        assert!(body.body.contains("用户数据计算过程"));
        assert!(body.snippet.contains("用户数据计算过程"));
        assert_eq!(body.attachments.len(), 1);
        assert_eq!(
            body.attachments[0].filename,
            "用户数据计算过程26日7月汇总 (1).xlsx"
        );
    }

    #[test]
    fn parses_rfc2231_utf8_attachment_filename_from_raw_message() {
        let body = parse_body_from_raw(
            concat!(
                "Subject: RFC2231\r\n",
                "MIME-Version: 1.0\r\n",
                "Content-Type: multipart/mixed; boundary=\"b\"\r\n",
                "\r\n",
                "--b\r\n",
                "Content-Type: text/plain\r\n",
                "\r\n",
                "body\r\n",
                "--b\r\n",
                "Content-Type: application/vnd.ms-excel\r\n",
                "Content-Disposition: attachment; filename*=UTF-8''%E7%94%A8%E6%88%B7%E6%95%B0%E6%8D%AE%E8%AE%A1%E7%AE%97%E8%BF%87%E7%A8%8B26%E6%97%A57%E6%9C%88%E6%B1%87%E6%80%BB%20%281%29.xlsx\r\n",
                "Content-Transfer-Encoding: base64\r\n",
                "\r\n",
                "YXR0YWNobWVudCBieXRlcw==\r\n",
                "--b--\r\n",
            )
            .as_bytes(),
        );

        assert_eq!(body.attachments.len(), 1);
        assert_eq!(
            body.attachments[0].filename,
            "用户数据计算过程26日7月汇总 (1).xlsx"
        );
    }

    #[test]
    fn parses_rfc2231_continuation_filename_from_bodystructure() {
        let response = b"* 1 FETCH (BODYSTRUCTURE (\"APPLICATION\" \"OCTET-STREAM\" (\"NAME*0*\" \"UTF-8''%E7%94%A8%E6%88%B7\" \"NAME*1*\" \"%E6%95%B0%E6%8D%AE.xlsx\") NIL NIL \"BASE64\" 10 NIL (\"ATTACHMENT\" (\"FILENAME*0*\" \"UTF-8''%E7%94%A8%E6%88%B7\" \"FILENAME*1*\" \"%E6%95%B0%E6%8D%AE.xlsx\")) NIL))\r\n";
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
                let filename = attachment_filename_from_bodystructure(bodystructure).unwrap();
                assert_eq!(filename, "用户数据.xlsx");
            }
            _ => panic!("expected FETCH response"),
        };
    }

    #[test]
    fn decodes_header_field_bytes_without_lossy_corruption() {
        // GBK-encoded From display name as raw non-UTF-8 bytes.
        let raw = b"From: \xD5\xC5\xBD\xA1 <zhang@example.com>\r\n\r\n";
        let fields = crate::mime::extract_header_fields(raw);
        let from = fields
            .iter()
            .find(|(name, _)| name == "from")
            .map(|(_, value)| crate::mime::decode_header_value_bytes(value))
            .unwrap();
        assert_eq!(from, "张健 <zhang@example.com>");
    }

    #[test]
    fn parse_body_from_raw_falls_back_to_charset_decoded_text() {
        // Message that mail-parser fails to structure (no MIME headers at all)
        // with GBK bytes: the fallback path must not corrupt to U+FFFD.
        let body = parse_body_from_raw(
            b"Content-Type: text/plain; charset=GBK\r\n\r\n\xD3\xC3\xBB\xA7\xCA\xFD\xBE\xDD",
        );
        assert!(body.body.contains("用户数据"), "got: {:?}", body.body);
    }
}
