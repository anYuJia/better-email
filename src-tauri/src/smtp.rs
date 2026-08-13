use crate::credentials::AccountSecret;
use crate::db::MailError;
use crate::models::{Account, Attachment, OutboundMessage};
use lettre::{
    message::{
        header::{ContentId, ContentType},
        Mailbox, MultiPart, SinglePart,
    },
    transport::smtp::{
        authentication::{Credentials, Mechanism},
        SmtpTransportBuilder,
    },
    Message, SmtpTransport, Transport,
};
use std::fs;
use std::time::Duration;

#[allow(dead_code)]
pub fn send_outbound(
    account: &Account,
    message: &OutboundMessage,
    secret: &AccountSecret,
) -> Result<Vec<u8>, MailError> {
    let email = build_outbound_email(message, None)?;
    let raw_message = email.formatted();
    let mailer = authenticated_transport(account, secret)?;

    mailer
        .send(&email)
        .map_err(|error| MailError::Smtp(format!("SMTP 发送失败：{error}")))?;
    Ok(raw_message)
}

/// 使用后端在同一次打开中验证并读取出的附件字节发送邮件。生产命令必须走
/// 这个入口，避免在授权验证完成后再次按路径读取附件。
pub fn send_outbound_with_attachment_bytes(
    account: &Account,
    message: &OutboundMessage,
    secret: &AccountSecret,
    attachment_bytes: &[Vec<u8>],
) -> Result<Vec<u8>, MailError> {
    let email = build_outbound_email(message, Some(attachment_bytes))?;
    let raw_message = email.formatted();
    let mailer = authenticated_transport(account, secret)?;

    mailer
        .send(&email)
        .map_err(|error| MailError::Smtp(format!("SMTP 发送失败：{error}")))?;
    Ok(raw_message)
}

#[allow(dead_code)]
pub fn render_outbound(message: &OutboundMessage) -> Result<Vec<u8>, MailError> {
    Ok(build_outbound_email(message, None)?.formatted())
}

/// 使用已验证附件字节构建 MIME，不会重新从附件路径读取。
pub fn render_outbound_with_attachment_bytes(
    message: &OutboundMessage,
    attachment_bytes: &[Vec<u8>],
) -> Result<Vec<u8>, MailError> {
    Ok(build_outbound_email(message, Some(attachment_bytes))?.formatted())
}

pub fn outbound_message_id(message: &OutboundMessage) -> String {
    format!(
        "<better-email-{}-{}@better-email.local>",
        message.account_id, message.id
    )
}

fn build_outbound_email(
    message: &OutboundMessage,
    attachment_bytes: Option<&[Vec<u8>]>,
) -> Result<Message, MailError> {
    if let Some(bytes) = attachment_bytes {
        if bytes.len() != message.attachments.len() {
            return Err(MailError::Smtp(
                "附件验证结果与邮件附件数量不一致，已拒绝发送。".to_string(),
            ));
        }
    }
    let mut builder = Message::builder()
        .from(mailbox(&message.sender_name, &message.sender_email)?)
        .subject(&message.subject)
        .message_id(Some(outbound_message_id(message)));
    if let Some(in_reply_to) = normalized_thread_header(&message.in_reply_to_header, "In-Reply-To")?
    {
        builder = builder.in_reply_to(in_reply_to);
    }
    if let Some(references) = normalized_thread_header(&message.references_header, "References")? {
        builder = builder.references(references);
    }
    if !message.reply_to.trim().is_empty() {
        builder = builder.reply_to(mailbox("", &message.reply_to)?);
    }

    for recipient in split_recipients(&message.recipients) {
        builder = builder.to(mailbox("", &recipient)?);
    }
    for recipient in split_recipients(&message.cc) {
        builder = builder.cc(mailbox("", &recipient)?);
    }
    for recipient in split_recipients(&message.bcc) {
        builder = builder.bcc(mailbox("", &recipient)?);
    }

    build_email(builder, message, attachment_bytes)
}

pub fn verify_credentials(account: &Account, secret: &AccountSecret) -> Result<(), MailError> {
    let mailer = authenticated_transport(account, secret)?;
    match mailer.test_connection() {
        Ok(true) => Ok(()),
        Ok(false) => Err(MailError::Smtp(
            "SMTP 连接建立后未通过 NOOP 验证。".to_string(),
        )),
        Err(error) => Err(MailError::Smtp(format!("SMTP 登录验证失败：{error}"))),
    }
}

fn authenticated_transport(
    account: &Account,
    secret: &AccountSecret,
) -> Result<SmtpTransport, MailError> {
    let (host, port) = parse_smtp_endpoint(&account.smtp_host)?;
    let mut mailer_builder = smtp_transport(&host, port)?.timeout(Some(Duration::from_secs(20)));
    match secret {
        AccountSecret::Password(password) => {
            mailer_builder = mailer_builder.credentials(Credentials::new(
                account.email.clone(),
                password.to_string(),
            ));
        }
        AccountSecret::OAuth2(bundle) => {
            mailer_builder = mailer_builder
                .credentials(Credentials::new(
                    account.email.clone(),
                    bundle.access_token.clone(),
                ))
                .authentication(vec![Mechanism::Xoauth2]);
        }
    }
    Ok(mailer_builder.build())
}

fn build_email(
    builder: lettre::message::MessageBuilder,
    message: &OutboundMessage,
    attachment_bytes: Option<&[Vec<u8>]>,
) -> Result<Message, MailError> {
    let html_present = !message.html_body.trim().is_empty();
    let html_uses_cid = html_present && message.html_body.to_ascii_lowercase().contains("cid:");
    let body_part = build_body_part(message, html_uses_cid, attachment_bytes)?;
    let regular_attachments = message
        .attachments
        .iter()
        .enumerate()
        .filter(|(_, attachment)| !is_inline_attachment(attachment, html_uses_cid))
        .collect::<Vec<_>>();
    if regular_attachments.is_empty() {
        return if !html_present {
            builder
                .header(ContentType::TEXT_PLAIN)
                .body(message.body.clone())
                .map_err(|error| MailError::Smtp(format!("邮件构建失败：{error}")))
        } else {
            builder
                .multipart(body_part)
                .map_err(|error| MailError::Smtp(format!("邮件构建失败：{error}")))
        };
    }

    let mut multipart = MultiPart::mixed().multipart(body_part);
    for (index, attachment) in regular_attachments {
        multipart = multipart.singlepart(attachment_part(
            attachment,
            attachment_bytes_for(attachment, attachment_bytes, index)?,
        )?);
    }
    builder
        .multipart(multipart)
        .map_err(|error| MailError::Smtp(format!("邮件构建失败：{error}")))
}

fn is_inline_attachment(attachment: &Attachment, html_uses_cid: bool) -> bool {
    html_uses_cid && attachment.is_inline && !attachment.content_id.trim().is_empty()
}

fn build_body_part(
    message: &OutboundMessage,
    html_uses_cid: bool,
    attachment_bytes: Option<&[Vec<u8>]>,
) -> Result<MultiPart, MailError> {
    let alternative = if message.html_body.trim().is_empty() {
        MultiPart::alternative().singlepart(SinglePart::plain(message.body.clone()))
    } else {
        MultiPart::alternative()
            .singlepart(SinglePart::plain(message.body.clone()))
            .singlepart(SinglePart::html(message.html_body.clone()))
    };
    let inline_attachments = message
        .attachments
        .iter()
        .enumerate()
        .filter(|(_, attachment)| is_inline_attachment(attachment, html_uses_cid))
        .collect::<Vec<_>>();
    if inline_attachments.is_empty() {
        return Ok(alternative);
    }

    let mut related = MultiPart::related().multipart(alternative);
    for (index, attachment) in inline_attachments {
        related = related.singlepart(inline_attachment_part(
            attachment,
            attachment_bytes_for(attachment, attachment_bytes, index)?,
        )?);
    }
    Ok(related)
}

fn inline_attachment_part(
    attachment: &Attachment,
    bytes: Vec<u8>,
) -> Result<SinglePart, MailError> {
    let content_type = ContentType::parse(&attachment.mime_type)
        .unwrap_or(ContentType::parse("application/octet-stream").expect("valid fallback MIME"));
    Ok(SinglePart::builder()
        .header(content_type)
        .header(ContentId::from(format!(
            "<{}>",
            attachment.content_id.trim()
        )))
        .body(bytes))
}

fn attachment_part(attachment: &Attachment, bytes: Vec<u8>) -> Result<SinglePart, MailError> {
    let content_type = ContentType::parse(&attachment.mime_type)
        .unwrap_or(ContentType::parse("application/octet-stream").expect("valid fallback MIME"));
    Ok(lettre::message::Attachment::new(attachment.filename.clone()).body(bytes, content_type))
}

fn attachment_bytes_for(
    attachment: &Attachment,
    provided: Option<&[Vec<u8>]>,
    index: usize,
) -> Result<Vec<u8>, MailError> {
    match provided {
        Some(bytes) => bytes.get(index).cloned().ok_or_else(|| {
            MailError::Smtp("附件验证结果与邮件附件数量不一致，已拒绝发送。".to_string())
        }),
        None => read_attachment_bytes(attachment),
    }
}

/// 读取发件附件前的最终校验：canonicalize 解析符号链接，要求仍是常规文件且
/// 大小与预期一致（拦截授权后到读取之间的 symlink/文件替换 TOCTOU）。
fn read_attachment_bytes(attachment: &Attachment) -> Result<Vec<u8>, MailError> {
    let path = &attachment.local_path;
    if path.trim().is_empty() {
        return Err(MailError::Smtp(format!(
            "附件缺少本地路径，无法发送：{}",
            attachment.filename
        )));
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| MailError::Smtp(format!("附件路径无法解析 {path}：{error}")))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| MailError::Smtp(format!("附件元数据读取失败 {path}：{error}")))?;
    if !metadata.is_file() {
        return Err(MailError::Smtp(format!(
            "附件不再是常规文件，已拒绝发送：{path}"
        )));
    }
    let size = metadata.len().min(i64::MAX as u64) as i64;
    // 无论声明大小是否为 0 都必须与实际一致：不允许用 size_bytes=0 跳过大小校验。
    if size != attachment.size_bytes {
        return Err(MailError::Smtp(format!(
            "附件大小与预期不一致（{size} 字节 ≠ {} 字节），可能已被替换，已拒绝发送：{path}",
            attachment.size_bytes
        )));
    }
    fs::read(&canonical).map_err(|error| MailError::Smtp(format!("读取附件失败 {path}：{error}")))
}

fn smtp_transport(host: &str, port: u16) -> Result<SmtpTransportBuilder, MailError> {
    match port {
        465 => SmtpTransport::relay(host),
        587 => SmtpTransport::starttls_relay(host),
        _ => SmtpTransport::starttls_relay(host).map(|builder| builder.port(port)),
    }
    .map_err(|error| MailError::Smtp(format!("SMTP 连接配置失败：{error}")))
}

fn mailbox(name: &str, email: &str) -> Result<Mailbox, MailError> {
    let trimmed_email = email.trim();
    let bare_mailbox = || {
        trimmed_email
            .parse::<Mailbox>()
            .map_err(|error| MailError::Smtp(format!("邮箱地址无效 {trimmed_email}：{error}")))
    };
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() || trimmed_name.eq_ignore_ascii_case(trimmed_email) {
        return bare_mailbox();
    }

    let safe_name = trimmed_name
        .chars()
        .filter(|character| !matches!(character, '\r' | '\n' | '<' | '>'))
        .collect::<String>()
        .trim()
        .to_string();
    if safe_name.is_empty() || safe_name.eq_ignore_ascii_case(trimmed_email) {
        return bare_mailbox();
    }

    match format!("{safe_name} <{trimmed_email}>").parse::<Mailbox>() {
        Ok(mailbox) => Ok(mailbox),
        Err(_) => bare_mailbox(),
    }
}

fn split_recipients(value: &str) -> Vec<String> {
    value
        .split([',', ';'])
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn normalized_thread_header(value: &str, name: &str) -> Result<Option<String>, MailError> {
    if value.contains(['\r', '\n']) {
        return Err(MailError::Smtp(format!("{name} 邮件头包含非法换行。")));
    }
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok((!normalized.is_empty()).then_some(normalized))
}

fn parse_smtp_endpoint(configured: &str) -> Result<(String, u16), MailError> {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return Err(MailError::Smtp("未配置 SMTP 服务器。".to_string()));
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        let parsed_port = port
            .parse::<u16>()
            .map_err(|_| MailError::Smtp("SMTP 端口格式无效，应为 1-65535。".to_string()))?;
        Ok((host.trim().to_string(), parsed_port))
    } else {
        Ok((trimmed.to_string(), 465))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_recipient_lists() {
        assert_eq!(
            split_recipients("a@example.com, b@example.com; c@example.com"),
            vec!["a@example.com", "b@example.com", "c@example.com"]
        );
    }

    #[test]
    fn parses_smtp_endpoint_defaults_to_tls_port() {
        assert_eq!(
            parse_smtp_endpoint("smtp.example.com").unwrap(),
            ("smtp.example.com".to_string(), 465)
        );
        assert_eq!(
            parse_smtp_endpoint("smtp.example.com:587").unwrap(),
            ("smtp.example.com".to_string(), 587)
        );
    }

    #[test]
    fn mailbox_uses_bare_address_when_name_matches_email() {
        let parsed = mailbox("13658499022@163.com", "13658499022@163.com").unwrap();

        assert_eq!(parsed.email.to_string(), "13658499022@163.com");
        assert!(parsed.name.is_none());
    }

    #[test]
    fn mailbox_falls_back_to_bare_address_for_unsafe_display_name() {
        let parsed = mailbox("Me <old@example.com>", "me@example.com").unwrap();

        assert_eq!(parsed.email.to_string(), "me@example.com");
    }

    #[test]
    fn xoauth2_mechanism_uses_access_token_as_secret() {
        let credentials = Credentials::new("me@example.com".to_string(), "access-123".to_string());
        let response = Mechanism::Xoauth2.response(&credentials, None).unwrap();
        assert_eq!(
            response,
            "user=me@example.com\x01auth=Bearer access-123\x01\x01"
        );
    }

    #[test]
    fn builds_multipart_email_with_local_attachments() {
        let path = std::env::temp_dir().join(format!(
            "better-email-smtp-attachment-{}-{}.txt",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&path, b"attachment body").unwrap();

        let message = OutboundMessage {
            id: 7,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Attachment".to_string(),
            body: "Body".to_string(),
            html_body: String::new(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![Attachment {
                id: 1,
                message_id: 7,
                filename: "notes.txt".to_string(),
                mime_type: "text/plain".to_string(),
                size_bytes: 15,
                is_downloaded: true,
                local_path: path.to_string_lossy().to_string(),
                content_id: String::new(),
                is_inline: false,
            }],
        };
        let email = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Attachment"),
            &message,
            None,
        )
        .unwrap();
        let rendered = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(rendered.contains("multipart/mixed"));
        assert!(rendered.contains("notes.txt"));
        assert!(rendered.contains("attachment body"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn builds_multipart_alternative_for_html_body() {
        let message = OutboundMessage {
            id: 9,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Rich text".to_string(),
            body: "Hello rich text".to_string(),
            html_body: "<p><strong>Hello rich text</strong></p>".to_string(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: Vec::new(),
        };
        let email = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Rich text"),
            &message,
            None,
        )
        .unwrap();
        let rendered = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(rendered.contains("multipart/alternative"));
        assert!(rendered.contains("text/plain"));
        assert!(rendered.contains("text/html"));
        assert!(rendered.contains("<strong>Hello rich text</strong>"));
    }

    #[test]
    fn rendered_outbound_uses_stable_message_id() {
        let message = OutboundMessage {
            id: 42,
            account_id: 7,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Stable id".to_string(),
            body: "Body".to_string(),
            html_body: String::new(),
            in_reply_to_header: "<parent@example.com>".to_string(),
            references_header: "<root@example.com> <parent@example.com>".to_string(),
            attachments: Vec::new(),
        };
        let rendered = String::from_utf8(render_outbound(&message).unwrap()).unwrap();

        assert_eq!(
            outbound_message_id(&message),
            "<better-email-7-42@better-email.local>"
        );
        assert!(rendered.contains("Message-ID: <better-email-7-42@better-email.local>"));
        assert!(rendered.contains("In-Reply-To: <parent@example.com>"));
        assert!(rendered.contains("References: <root@example.com> <parent@example.com>"));
    }

    #[test]
    fn wraps_html_alternative_inside_mixed_when_attachments_exist() {
        let path = std::env::temp_dir().join(format!(
            "better-email-smtp-rich-attachment-{}-{}.txt",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&path, b"rich attachment").unwrap();

        let message = OutboundMessage {
            id: 10,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Rich attachment".to_string(),
            body: "Hello rich attachment".to_string(),
            html_body: "<p><em>Hello rich attachment</em></p>".to_string(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![Attachment {
                id: 2,
                message_id: 10,
                filename: "rich-notes.txt".to_string(),
                mime_type: "text/plain".to_string(),
                size_bytes: 15,
                is_downloaded: true,
                local_path: path.to_string_lossy().to_string(),
                content_id: String::new(),
                is_inline: false,
            }],
        };
        let email = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Rich attachment"),
            &message,
            None,
        )
        .unwrap();
        let rendered = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(rendered.contains("multipart/mixed"));
        assert!(rendered.contains("multipart/alternative"));
        assert!(rendered.contains("text/html"));
        assert!(rendered.contains("rich-notes.txt"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn builds_multipart_related_for_inline_cid_images() {
        let path = std::env::temp_dir().join(format!(
            "better-email-smtp-inline-{}-{}.png",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&path, b"fake png bytes").unwrap();

        let message = OutboundMessage {
            id: 11,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Inline image".to_string(),
            body: "See the image".to_string(),
            html_body: "<p>See the image</p><img src=\"cid:inline-1@better-email.local\">"
                .to_string(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![
                Attachment {
                    id: 1,
                    message_id: 11,
                    filename: "inline.png".to_string(),
                    mime_type: "image/png".to_string(),
                    size_bytes: 14,
                    is_downloaded: true,
                    local_path: path.to_string_lossy().to_string(),
                    content_id: "inline-1@better-email.local".to_string(),
                    is_inline: true,
                },
                Attachment {
                    id: 2,
                    message_id: 11,
                    filename: "notes.txt".to_string(),
                    mime_type: "text/plain".to_string(),
                    size_bytes: 14,
                    is_downloaded: true,
                    local_path: path.to_string_lossy().to_string(),
                    content_id: String::new(),
                    is_inline: false,
                },
            ],
        };
        let email = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Inline image"),
            &message,
            None,
        )
        .unwrap();
        let rendered = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(rendered.contains("multipart/related"));
        assert!(rendered.contains("multipart/alternative"));
        assert!(rendered.contains("multipart/mixed"));
        assert!(rendered.contains("Content-ID: <inline-1@better-email.local>"));
        assert!(rendered.contains("cid:inline-1@better-email.local"));
        assert!(rendered.contains("notes.txt"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn inline_attachment_without_cid_reference_stays_regular() {
        let path = std::env::temp_dir().join(format!(
            "better-email-smtp-inline-plain-{}-{}.png",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::write(&path, b"fake png bytes").unwrap();

        let message = OutboundMessage {
            id: 12,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Inline unused".to_string(),
            body: "No images".to_string(),
            html_body: "<p>No images</p>".to_string(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![Attachment {
                id: 3,
                message_id: 12,
                filename: "unused.png".to_string(),
                mime_type: "image/png".to_string(),
                size_bytes: 14,
                is_downloaded: true,
                local_path: path.to_string_lossy().to_string(),
                content_id: "unused@better-email.local".to_string(),
                is_inline: true,
            }],
        };
        let email = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Inline unused"),
            &message,
            None,
        )
        .unwrap();
        let rendered = String::from_utf8_lossy(&email.formatted()).to_string();

        assert!(!rendered.contains("multipart/related"));
        assert!(rendered.contains("multipart/alternative"));
        assert!(rendered.contains("multipart/mixed"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_attachment_without_local_path_before_smtp_send() {
        let message = OutboundMessage {
            id: 8,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Missing attachment".to_string(),
            body: "Body".to_string(),
            html_body: String::new(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![Attachment {
                id: 1,
                message_id: 8,
                filename: "missing.pdf".to_string(),
                mime_type: "application/pdf".to_string(),
                size_bytes: 42,
                is_downloaded: false,
                local_path: String::new(),
                content_id: String::new(),
                is_inline: false,
            }],
        };
        let error = build_email(
            Message::builder()
                .from(mailbox("Me", "me@example.com").unwrap())
                .to(mailbox("", "friend@example.com").unwrap())
                .subject("Missing attachment"),
            &message,
            None,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("附件缺少本地路径"));
        assert!(error.contains("missing.pdf"));
    }
}
