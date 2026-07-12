use crate::db::MailResult;
use crate::models::{
    ConnectionReport, EndpointCheck, ImportedEmlAttachment, ImportedEmlMessage,
    ParsedMessagePreview,
};
use ammonia::Builder;
use chrono::{DateTime, Utc};
use mail_parser::{Address, MessageParser, MimeHeaders};
use std::borrow::Cow;
use std::collections::HashSet;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub fn test_endpoints(
    email: &str,
    incoming_protocol: &str,
    imap_host: &str,
    smtp_host: &str,
) -> MailResult<ConnectionReport> {
    let (incoming_name, incoming_port) = if incoming_protocol.trim().eq_ignore_ascii_case("pop3") {
        ("POP3", 995)
    } else {
        ("IMAP", 993)
    };
    let endpoints = vec![
        check_endpoint(incoming_name, imap_host, incoming_port),
        check_endpoint("SMTP", smtp_host, 465),
    ];
    let ready_for_credentials = endpoints.iter().all(|endpoint| endpoint.reachable);
    Ok(ConnectionReport {
        account_email: email.to_string(),
        checked_at: Utc::now().to_rfc3339(),
        endpoints,
        ready_for_credentials,
    })
}

pub fn parse_message_preview(raw: &str) -> ParsedMessagePreview {
    let parsed = MessageParser::new()
        .with_minimal_headers()
        .with_message_ids()
        .parse(raw.as_bytes());
    let normalized = raw.replace("\r\n", "\n");
    let (header_block, fallback_body) = normalized
        .split_once("\n\n")
        .unwrap_or((normalized.as_str(), ""));

    let subject = parsed
        .as_ref()
        .and_then(|message| message.subject())
        .map(ToOwned::to_owned)
        .or_else(|| {
            header_value(header_block, "subject").map(|value| decode_mime_header_value(&value))
        })
        .unwrap_or_else(|| "(无主题)".to_string());
    let from = parsed
        .as_ref()
        .and_then(|message| message.from())
        .map(format_address_list)
        .or_else(|| {
            header_value(header_block, "from").map(|value| decode_address_header_value(&value))
        })
        .unwrap_or_default();
    let to = parsed
        .as_ref()
        .and_then(|message| message.to())
        .map(format_address_list)
        .or_else(|| {
            header_value(header_block, "to").map(|value| decode_address_header_value(&value))
        })
        .unwrap_or_default();
    let text_body = parsed
        .as_ref()
        .and_then(|message| message.body_text(0))
        .map(|body| body.into_owned())
        .unwrap_or_else(|| fallback_body.to_string());
    let html_body = parsed
        .as_ref()
        .and_then(|message| message.body_html(0))
        .map(|body| body.into_owned())
        .unwrap_or_default();
    let attachment_names = parsed
        .as_ref()
        .map(|message| {
            message
                .attachments()
                .map(|attachment| {
                    attachment
                        .attachment_name()
                        .unwrap_or("Untitled attachment")
                        .to_string()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let sanitized_html = sanitize_html(&html_body);
    let mut warnings = Vec::new();

    if parsed.is_none() {
        warnings.push("原始邮件未能按完整 RFC/MIME 结构解析，已退回基础头部解析。".to_string());
    }
    let lower = format!("{html_body}\n{text_body}").to_ascii_lowercase();
    if lower.contains("<script") {
        warnings.push("HTML 正文包含 script 标签，渲染前必须清洗。".to_string());
    }
    if lower.contains("http://") {
        warnings.push("正文包含明文 HTTP 链接，后续应提示潜在风险。".to_string());
    }
    if html_has_remote_images(&html_body) || html_has_remote_images(&text_body) {
        warnings.push("检测到远程图片，应默认阻止自动加载。".to_string());
    }
    warnings.extend(link_risk_warnings(&html_body));

    ParsedMessagePreview {
        subject,
        from,
        to,
        body_preview: text_body
            .lines()
            .filter(|line| !line.trim().is_empty())
            .take(4)
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .take(280)
            .collect(),
        sanitized_html,
        attachment_count: attachment_names.len() as i64,
        attachment_names,
        warning_count: warnings.len() as i64,
        warnings,
    }
}

pub fn parse_imported_eml(raw: &str) -> ImportedEmlMessage {
    let parsed = MessageParser::new()
        .with_minimal_headers()
        .with_message_ids()
        .parse(raw.as_bytes());
    let normalized = raw.replace("\r\n", "\n");
    let (header_block, fallback_body) = normalized
        .split_once("\n\n")
        .unwrap_or((normalized.as_str(), ""));
    let preview = parse_message_preview(raw);
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
    let has_renderable_html = looks_like_html(&html_body);
    let body = if has_renderable_html {
        html_body.clone()
    } else if !text_body.trim().is_empty() {
        text_body.clone()
    } else {
        fallback_body.to_string()
    };
    let snippet_source = if !text_body.trim().is_empty() {
        text_body.as_str()
    } else if has_renderable_html {
        &html_body
    } else {
        &body
    };
    let from = parsed
        .as_ref()
        .and_then(|message| message.from())
        .map(format_address_list)
        .or_else(|| {
            header_value(header_block, "from").map(|value| decode_address_header_value(&value))
        })
        .unwrap_or_default();
    let received_at = header_value(header_block, "date")
        .and_then(|value| {
            DateTime::parse_from_rfc2822(&value)
                .or_else(|_| DateTime::parse_from_rfc3339(&value))
                .ok()
        })
        .map(|value| value.with_timezone(&Utc).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
    let message_id_header = header_value(header_block, "message-id")
        .unwrap_or_else(|| format!("local-eml-{}", Utc::now().timestamp_micros()));
    let in_reply_to_header = header_value(header_block, "in-reply-to").unwrap_or_default();
    let references_header = header_value(header_block, "references").unwrap_or_default();
    let attachments =
        parsed
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
                        let content_id = normalize_content_id(part.content_id());
                        let is_inline = part
                            .content_disposition()
                            .is_some_and(|disposition| disposition.is_inline())
                            || !content_id.is_empty();
                        ImportedEmlAttachment {
                            filename: part.attachment_name().map(str::to_string).unwrap_or_else(
                                || inline_attachment_filename(&mime_type, &content_id, index),
                            ),
                            mime_type,
                            bytes: part.contents().to_vec(),
                            content_id,
                            is_inline,
                        }
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

    ImportedEmlMessage {
        sender_name: display_name_from_address(&from),
        sender_email: email_from_address(&from),
        recipients: parsed
            .as_ref()
            .and_then(|message| message.to())
            .map(format_address_list)
            .or_else(|| {
                header_value(header_block, "to").map(|value| decode_address_header_value(&value))
            })
            .unwrap_or_default(),
        cc: parsed
            .as_ref()
            .and_then(|message| message.cc())
            .map(format_address_list)
            .or_else(|| {
                header_value(header_block, "cc").map(|value| decode_address_header_value(&value))
            })
            .unwrap_or_default(),
        bcc: parsed
            .as_ref()
            .and_then(|message| message.bcc())
            .map(format_address_list)
            .or_else(|| {
                header_value(header_block, "bcc").map(|value| decode_address_header_value(&value))
            })
            .unwrap_or_default(),
        subject: preview.subject,
        snippet: snippet_source
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("")
            .replace(['<', '>'], " ")
            .chars()
            .take(120)
            .collect(),
        body,
        sanitized_html: if has_renderable_html {
            sanitize_html(&html_body)
        } else {
            String::new()
        },
        security_warnings: preview.warnings,
        received_at,
        message_id_header,
        in_reply_to_header,
        references_header,
        attachments,
    }
}

pub(crate) fn link_risk_warnings(html: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    for (href, label) in extract_links(html) {
        let Some(link_host) = host_from_url(&href) else {
            continue;
        };
        if is_ip_address_host(&link_host) {
            warnings.push(format!("链接指向 IP 地址 {link_host}，请谨慎打开。"));
        }
        if looks_like_sensitive_url(&href) {
            warnings.push(format!(
                "链接路径包含登录/验证关键词，请核对域名 {link_host}。"
            ));
        }
        let Some(label_host) = visible_host(&label) else {
            continue;
        };
        if !same_or_subdomain(&link_host, &label_host) {
            warnings.push(format!(
                "链接显示为 {label_host}，实际跳转到 {link_host}，疑似钓鱼链接。"
            ));
        }
    }
    warnings.sort();
    warnings.dedup();
    warnings
}

fn display_name_from_address(address: &str) -> String {
    let decoded = decode_address_header_value(address);
    decoded
        .split('<')
        .next()
        .map(|name| name.trim().trim_matches('"').to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| email_from_address(&decoded))
}

fn email_from_address(address: &str) -> String {
    let decoded = decode_address_header_value(address);
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

pub(crate) fn decode_mime_header_value(value: &str) -> String {
    let probe = format!("Subject: {value}\r\n\r\n");
    MessageParser::new()
        .header_text(mail_parser::HeaderName::Subject)
        .parse(probe.as_bytes())
        .and_then(|message| message.subject().map(ToOwned::to_owned))
        .unwrap_or_else(|| value.trim().to_string())
}

pub(crate) fn decode_address_header_value(value: &str) -> String {
    let probe = format!("To: {value}\r\n\r\n");
    MessageParser::new()
        .header_address(mail_parser::HeaderName::To)
        .parse(probe.as_bytes())
        .and_then(|message| message.to().map(format_address_list))
        .unwrap_or_else(|| decode_mime_header_value(value))
}

pub(crate) fn format_address_list(addresses: &Address<'_>) -> String {
    addresses
        .iter()
        .map(|addr| {
            let name = addr.name.as_deref().unwrap_or_default().trim();
            let email = addr.address.as_deref().unwrap_or_default().trim();
            match (name.is_empty(), email.is_empty()) {
                (false, false) => format!("{name} <{email}>"),
                (false, true) => name.to_string(),
                (true, false) => email.to_string(),
                (true, true) => String::new(),
            }
        })
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

fn looks_like_html(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    [
        "<html", "<body", "<div", "<p", "<table", "<a ", "<img", "<span",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub(crate) fn sanitize_html(html: &str) -> String {
    sanitize_html_inner(html, false)
}

pub(crate) fn sanitize_html_with_remote_images(html: &str) -> String {
    sanitize_html_inner(html, true)
}

pub(crate) fn normalize_content_id(value: Option<&str>) -> String {
    value
        .unwrap_or_default()
        .trim()
        .trim_start_matches("cid:")
        .trim_matches(|ch| ch == '<' || ch == '>')
        .trim()
        .to_ascii_lowercase()
}

pub(crate) fn inline_attachment_filename(
    mime_type: &str,
    content_id: &str,
    index: usize,
) -> String {
    let safe_id = content_id
        .chars()
        .take(80)
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let stem = safe_id.trim_matches('_');
    let stem = if stem.is_empty() {
        format!("inline-{}", index + 1)
    } else {
        stem.to_string()
    };
    format!("{stem}.{}", attachment_extension(mime_type))
}

fn attachment_extension(mime_type: &str) -> String {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/jpeg" => "jpg".to_string(),
        "image/svg+xml" => "svg".to_string(),
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico".to_string(),
        "application/pdf" => "pdf".to_string(),
        "text/plain" => "txt".to_string(),
        value => value
            .split_once('/')
            .map(|(_, subtype)| subtype)
            .and_then(|subtype| subtype.split([';', '+']).next())
            .map(|subtype| {
                subtype
                    .chars()
                    .filter(|ch| ch.is_ascii_alphanumeric())
                    .take(8)
                    .collect::<String>()
            })
            .filter(|extension| !extension.is_empty())
            .unwrap_or_else(|| "bin".to_string()),
    }
}

fn sanitize_html_inner(html: &str, allow_remote_images: bool) -> String {
    let mut url_schemes = HashSet::new();
    url_schemes.insert("mailto");
    url_schemes.insert("cid");
    if allow_remote_images {
        url_schemes.insert("https");
    }

    Builder::default()
        .url_schemes(url_schemes)
        .rm_tags(&["style"])
        .attribute_filter(|element, attribute, value| {
            if element.eq_ignore_ascii_case("a") && attribute.eq_ignore_ascii_case("href") {
                let normalized = value.trim().to_ascii_lowercase();
                if normalized.starts_with("http://") || normalized.starts_with("https://") {
                    return None;
                }
            }
            Some(Cow::Borrowed(value))
        })
        .clean(&html.chars().take(30_000).collect::<String>())
        .to_string()
        .chars()
        .take(20_000)
        .collect()
}

pub(crate) fn html_has_remote_images(html: &str) -> bool {
    let lower = html.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<img") {
        let start = cursor + relative_start;
        let Some(tag_end) = find_tag_end(html, start) else {
            break;
        };
        let tag = &html[start..=tag_end];
        if extract_attr(tag, "src")
            .map(|src| {
                let normalized = src.trim().to_ascii_lowercase();
                normalized.starts_with("http://") || normalized.starts_with("https://")
            })
            .unwrap_or(false)
        {
            return true;
        }
        cursor = tag_end.saturating_add(1);
        if cursor >= html.len() {
            break;
        }
    }
    false
}

fn extract_links(html: &str) -> Vec<(String, String)> {
    let lower = html.to_ascii_lowercase();
    let mut links = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<a") {
        let start = cursor + relative_start;
        let Some(tag_end) = find_tag_end(html, start) else {
            break;
        };
        let tag = &html[start..=tag_end];
        let href = extract_attr(tag, "href");
        let close_start = tag_end + 1;
        let close_end = lower[close_start..]
            .find("</a>")
            .map(|relative_end| close_start + relative_end)
            .unwrap_or(close_start);
        if let Some(href) = href {
            let label = strip_html_tags(&html[close_start..close_end]);
            links.push((href, decode_basic_entities(&label)));
        }
        cursor = close_end.saturating_add(4);
        if cursor >= html.len() {
            break;
        }
    }
    links
}

fn find_tag_end(html: &str, start: usize) -> Option<usize> {
    let mut quote: Option<char> = None;
    for (offset, ch) in html[start..].char_indices() {
        match (quote, ch) {
            (Some(active), current) if current == active => quote = None,
            (None, '"' | '\'') => quote = Some(ch),
            (None, '>') => return Some(start + offset),
            _ => {}
        }
    }
    None
}

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    if attr.is_empty() {
        return None;
    }
    let attr_len = attr.len();
    let mut cursor = 0;
    let mut quote: Option<char> = None;
    while cursor < tag.len() {
        let Some(ch) = tag[cursor..].chars().next() else {
            break;
        };
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            }
            cursor += ch.len_utf8();
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            cursor += ch.len_utf8();
            continue;
        }

        let candidate_matches = cursor + attr_len <= tag.len()
            && tag
                .get(cursor..cursor + attr_len)
                .map(|candidate| candidate.eq_ignore_ascii_case(attr))
                .unwrap_or(false);
        if candidate_matches {
            let before = tag[..cursor].chars().next_back();
            let after = tag[cursor + attr_len..].chars().next();
            let starts_on_boundary = before
                .map(|previous| previous.is_whitespace() || matches!(previous, '<' | '/'))
                .unwrap_or(false);
            let ends_on_boundary = after
                .map(|next| next.is_whitespace() || matches!(next, '=' | '>' | '/'))
                .unwrap_or(false);
            if starts_on_boundary && ends_on_boundary {
                let after_attr = &tag[cursor + attr_len..];
                let rest = after_attr.trim_start().strip_prefix('=')?.trim_start();
                let mut chars = rest.chars();
                let first = chars.next()?;
                if first == '"' || first == '\'' {
                    let value: String = chars.take_while(|value_ch| *value_ch != first).collect();
                    return Some(value.trim().to_string());
                }
                return Some(
                    rest.split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .trim_matches('>')
                        .trim()
                        .to_string(),
                );
            }
        }
        cursor += ch.len_utf8();
    }
    None
}

fn strip_html_tags(input: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    output.trim().to_string()
}

fn decode_basic_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn host_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    let (_, rest) = trimmed.split_once("://")?;
    let host_port = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .trim()
        .trim_matches(['[', ']']);
    let host = host_port
        .rsplit_once('@')
        .map(|(_, host)| host)
        .unwrap_or(host_port)
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .trim_end_matches('.');
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn visible_host(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(host) = host_from_url(trimmed) {
        return Some(host);
    }
    let candidate = trimmed
        .trim_start_matches("www.")
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                ',' | ';' | ':' | ')' | '(' | '[' | ']' | '{' | '}' | '"' | '\''
            )
        })
        .trim_end_matches('.');
    if candidate.contains('.')
        && candidate
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '.')
    {
        Some(candidate.to_ascii_lowercase())
    } else {
        None
    }
}

fn same_or_subdomain(actual_host: &str, visible_host: &str) -> bool {
    let actual = actual_host.trim_start_matches("www.");
    let visible = visible_host.trim_start_matches("www.");
    actual == visible
        || actual.ends_with(&format!(".{visible}"))
        || visible.ends_with(&format!(".{actual}"))
}

fn is_ip_address_host(host: &str) -> bool {
    host.parse::<std::net::IpAddr>().is_ok()
}

fn looks_like_sensitive_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    [
        "login", "signin", "verify", "password", "account", "security",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

fn check_endpoint(name: &str, configured: &str, default_port: u16) -> EndpointCheck {
    match parse_endpoint(configured, default_port) {
        Ok((host, port)) => {
            let address = format!("{host}:{port}");
            let start = Instant::now();
            match resolve_first(&host, port)
                .and_then(|addr| TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map(|_| addr))
            {
                Ok(_) => EndpointCheck {
                    name: name.to_string(),
                    address,
                    reachable: true,
                    latency_ms: Some(start.elapsed().as_millis() as i64),
                    message: "TCP 连接成功，可以进入凭据/OAuth 验证阶段。".to_string(),
                },
                Err(error) => EndpointCheck {
                    name: name.to_string(),
                    address,
                    reachable: false,
                    latency_ms: None,
                    message: format!("TCP 连接失败：{error}"),
                },
            }
        }
        Err(message) => EndpointCheck {
            name: name.to_string(),
            address: configured.to_string(),
            reachable: false,
            latency_ms: None,
            message,
        },
    }
}

fn parse_endpoint(configured: &str, default_port: u16) -> Result<(String, u16), String> {
    let trimmed = configured.trim();
    if trimmed.is_empty() {
        return Err("未配置服务器地址。".to_string());
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if host.trim().is_empty() {
            return Err("服务器地址缺少主机名。".to_string());
        }
        let port = port
            .parse::<u16>()
            .map_err(|_| "端口格式无效，应为 1-65535。".to_string())?;
        Ok((host.trim().to_string(), port))
    } else {
        Ok((trimmed.to_string(), default_port))
    }
}

fn resolve_first(host: &str, port: u16) -> std::io::Result<SocketAddr> {
    (host, port).to_socket_addrs()?.next().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrNotAvailable, "无法解析服务器地址")
    })
}

fn header_value(headers: &str, name: &str) -> Option<String> {
    let prefix = format!("{name}:");
    headers.lines().find_map(|line| {
        if line.to_ascii_lowercase().starts_with(&prefix) {
            Some(line[prefix.len()..].trim().to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_endpoint_with_default_port() {
        assert_eq!(
            parse_endpoint("imap.example.com", 993).unwrap(),
            ("imap.example.com".to_string(), 993)
        );
        assert_eq!(
            parse_endpoint("smtp.example.com:587", 465).unwrap(),
            ("smtp.example.com".to_string(), 587)
        );
    }

    #[test]
    fn parses_message_preview_and_security_warnings() {
        let parsed = parse_message_preview(
            "Subject: Hello\nFrom: a@example.com\nTo: b@example.com\nContent-Type: text/html\n\n<p onclick=\"x()\">Hi</p><img src=\"http://example.com/a.png\"><script>x</script>",
        );
        assert_eq!(parsed.subject, "Hello");
        assert!(parsed.warning_count >= 3);
        assert!(!parsed.sanitized_html.contains("<script"));
        assert!(!parsed.sanitized_html.contains("onclick"));
        assert!(!parsed.sanitized_html.contains("src=\"http"));
        assert!(parsed.sanitized_html.contains("<p>Hi</p>"));
    }

    #[test]
    fn preview_warns_for_single_quoted_remote_images() {
        let parsed = parse_message_preview(
            "Subject: Remote image\nContent-Type: text/html\n\n<p>Hi</p><img src = 'https://tracker.example/open.png'>",
        );

        assert!(parsed
            .warnings
            .iter()
            .any(|warning| warning.contains("远程图片")));
        assert!(!parsed.sanitized_html.contains("src='http"));
    }

    #[test]
    fn remote_image_detection_handles_unquoted_sources() {
        assert!(html_has_remote_images(
            "<p>Hi</p><img alt=tracker src=https://tracker.example/open.png>"
        ));
        assert!(html_has_remote_images(
            "<img alt=\"1 > 2\" src=\"https://tracker.example/open.png\">"
        ));
        assert!(!html_has_remote_images(
            "<img data-src=\"https://tracker.example/open.png\" src=\"cid:logo@example.com\">"
        ));
        assert!(!html_has_remote_images(
            "<img alt=\"src=https://tracker.example/open.png\" src=\"cid:logo@example.com\">"
        ));
        assert!(!html_has_remote_images(
            "<img src=\"cid:logo@example.com\">"
        ));
    }

    #[test]
    fn decodes_mime_encoded_subject_and_addresses() {
        let parsed = parse_message_preview(concat!(
            "Subject: =?utf-8?B?c2E=?=\r\n",
            "From: =?utf-8?B?cHl1LmlkYQ==?= <pyu.ida@foxmail.com>\r\n",
            "To: =?utf-8?B?MTM2NTg0OTkwMjI=?= <13658499022@163.com>\r\n",
            "\r\n",
            "Body"
        ));

        assert_eq!(parsed.subject, "sa");
        assert_eq!(parsed.from, "pyu.ida <pyu.ida@foxmail.com>");
        assert_eq!(parsed.to, "13658499022 <13658499022@163.com>");
    }

    #[test]
    fn parses_imported_eml_headers_html_and_attachment_payload() {
        let raw = concat!(
            "Subject: Imported sample\r\n",
            "From: \"Ada Lovelace\" <ada@example.com>\r\n",
            "To: demo@better-email.local\r\n",
            "Cc: team@example.com\r\n",
            "Date: Thu, 09 Jul 2026 10:00:00 +0800\r\n",
            "Message-ID: <imported-1@example.com>\r\n",
            "In-Reply-To: <parent@example.com>\r\n",
            "References: <root@example.com> <parent@example.com>\r\n",
            "Content-Type: multipart/mixed; boundary=\"mix\"\r\n",
            "\r\n",
            "--mix\r\n",
            "Content-Type: multipart/alternative; boundary=\"alt\"\r\n",
            "\r\n",
            "--alt\r\n",
            "Content-Type: text/plain; charset=utf-8\r\n",
            "\r\n",
            "Hello from imported EML.\r\n",
            "--alt\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p onclick=\"bad()\">Hello from imported EML.</p><img src=\"http://tracker.example/open.png\"><script>bad()</script>\r\n",
            "--alt--\r\n",
            "--mix\r\n",
            "Content-Type: text/plain; name=\"note.txt\"\r\n",
            "Content-Disposition: attachment; filename=\"note.txt\"\r\n",
            "Content-Transfer-Encoding: base64\r\n",
            "\r\n",
            "aW1wb3J0ZWQgYXR0YWNobWVudA==\r\n",
            "--mix--\r\n",
        );
        let imported = parse_imported_eml(raw);

        assert_eq!(imported.subject, "Imported sample");
        assert_eq!(imported.sender_name, "Ada Lovelace");
        assert_eq!(imported.sender_email, "ada@example.com");
        assert_eq!(imported.recipients, "demo@better-email.local");
        assert_eq!(imported.cc, "team@example.com");
        assert_eq!(imported.received_at, "2026-07-09T02:00:00+00:00");
        assert_eq!(imported.message_id_header, "<imported-1@example.com>");
        assert_eq!(imported.in_reply_to_header, "<parent@example.com>");
        assert_eq!(
            imported.references_header,
            "<root@example.com> <parent@example.com>"
        );
        assert!(imported.body.contains("Hello from imported EML."));
        assert!(!imported.sanitized_html.contains("<script"));
        assert!(!imported.sanitized_html.contains("onclick"));
        assert!(!imported.sanitized_html.contains("src=\"http"));
        assert!(imported
            .security_warnings
            .iter()
            .any(|warning| warning.contains("远程图片")));
        assert_eq!(imported.attachments.len(), 1);
        assert_eq!(imported.attachments[0].filename, "note.txt");
        assert_eq!(imported.attachments[0].mime_type, "text/plain");
        assert_eq!(imported.attachments[0].bytes, b"imported attachment");
        assert!(imported.attachments[0].content_id.is_empty());
        assert!(!imported.attachments[0].is_inline);
    }

    #[test]
    fn parses_imported_cid_image_with_safe_extension() {
        let raw = concat!(
            "Subject: Inline image\r\n",
            "From: sender@example.com\r\n",
            "To: demo@better-email.local\r\n",
            "MIME-Version: 1.0\r\n",
            "Content-Type: multipart/related; boundary=\"related\"\r\n",
            "\r\n",
            "--related\r\n",
            "Content-Type: text/html; charset=utf-8\r\n",
            "\r\n",
            "<p>Logo</p><img src=\"cid:Logo@Example.COM\">\r\n",
            "--related\r\n",
            "Content-Type: image/png\r\n",
            "Content-Disposition: inline\r\n",
            "Content-ID: <Logo@Example.COM>\r\n",
            "Content-Transfer-Encoding: base64\r\n",
            "\r\n",
            "iVBORw0KGgo=\r\n",
            "--related--\r\n",
        );
        let imported = parse_imported_eml(raw);

        assert!(imported.body.contains("src=\"cid:Logo@Example.COM\""));
        assert!(imported
            .sanitized_html
            .contains("src=\"cid:Logo@Example.COM\""));
        assert_eq!(imported.attachments.len(), 1);
        assert_eq!(imported.attachments[0].content_id, "logo@example.com");
        assert!(imported.attachments[0].is_inline);
        assert_eq!(imported.attachments[0].mime_type, "image/png");
        assert_eq!(imported.attachments[0].filename, "logo_example_com.png");
    }

    #[test]
    fn sanitizer_blocks_javascript_links_and_style_blocks() {
        let sanitized = sanitize_html(
            "<style>body{display:none}</style><a href=\"javascript:alert(1)\">bad</a><a href=\"mailto:a@example.com\">mail</a>",
        );
        assert!(!sanitized.contains("<style"));
        assert!(!sanitized.contains("javascript:"));
        assert!(sanitized.contains("href=\"mailto:a@example.com\""));
    }

    #[test]
    fn remote_image_sanitizer_allows_only_https_remote_urls() {
        let sanitized = sanitize_html_with_remote_images(
            "<img src=\"https://cdn.example.com/open.png\"><img src=\"http://tracker.example/open.png\"><a href=\"https://phish.example/login\">https bad</a><a href=\"http://phish.example/login\">http bad</a><a href=\"mailto:a@example.com\">mail</a>",
        );

        assert!(sanitized.contains("https://cdn.example.com/open.png"));
        assert!(!sanitized.contains("http://tracker.example/open.png"));
        assert!(!sanitized.contains("https://phish.example/login"));
        assert!(!sanitized.contains("http://phish.example/login"));
        assert!(sanitized.contains("href=\"mailto:a@example.com\""));
    }

    #[test]
    fn detects_mismatched_and_sensitive_link_domains() {
        let warnings = link_risk_warnings(
            "<a href=\"https://evil.example/login\">https://bank.example</a>\
             <a href=\"https://192.0.2.1/verify\">Verify account</a>",
        );
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("bank.example") && warning.contains("evil.example")));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("IP 地址 192.0.2.1")));
        assert!(warnings
            .iter()
            .any(|warning| warning.contains("登录/验证关键词")));
    }

    #[test]
    fn link_risk_detection_handles_angle_brackets_inside_attributes() {
        let warnings = link_risk_warnings(
            "<a title=\"1 > 2\" href=\"https://evil.example/login\">https://bank.example</a>",
        );

        assert!(warnings
            .iter()
            .any(|warning| warning.contains("bank.example") && warning.contains("evil.example")));
    }

    #[test]
    fn link_risk_detection_ignores_data_href_without_real_href() {
        let warnings = link_risk_warnings(
            "<a data-href=\"https://evil.example/login\">https://bank.example</a>\
             <a title=\"href=https://evil.example/login\">https://bank.example</a>",
        );

        assert!(warnings.is_empty());
    }
}
