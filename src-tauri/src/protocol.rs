use crate::db::MailResult;
use crate::models::{ConnectionReport, EndpointCheck, ParsedMessagePreview};
use ammonia::Builder;
use chrono::Utc;
use mail_parser::{MessageParser, MimeHeaders};
use std::collections::HashSet;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

pub fn test_endpoints(
    email: &str,
    imap_host: &str,
    smtp_host: &str,
) -> MailResult<ConnectionReport> {
    let endpoints = vec![
        check_endpoint("IMAP", imap_host, 993),
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
    let parsed = MessageParser::default().parse(raw.as_bytes());
    let normalized = raw.replace("\r\n", "\n");
    let (header_block, fallback_body) = normalized
        .split_once("\n\n")
        .unwrap_or((normalized.as_str(), ""));

    let subject = parsed
        .as_ref()
        .and_then(|message| message.subject())
        .map(ToOwned::to_owned)
        .or_else(|| header_value(header_block, "subject"))
        .unwrap_or_else(|| "(无主题)".to_string());
    let from = parsed
        .as_ref()
        .and_then(|message| message.from())
        .map(|value| format!("{value:?}"))
        .or_else(|| header_value(header_block, "from"))
        .unwrap_or_default();
    let to = parsed
        .as_ref()
        .and_then(|message| message.to())
        .map(|value| format!("{value:?}"))
        .or_else(|| header_value(header_block, "to"))
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
    if lower.contains("<img") && lower.contains("src=\"http") {
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

pub(crate) fn sanitize_html(html: &str) -> String {
    sanitize_html_inner(html, false)
}

pub(crate) fn sanitize_html_with_remote_images(html: &str) -> String {
    sanitize_html_inner(html, true)
}

fn sanitize_html_inner(html: &str, allow_remote_images: bool) -> String {
    let mut url_schemes = HashSet::new();
    url_schemes.insert("mailto");
    url_schemes.insert("cid");
    if allow_remote_images {
        url_schemes.insert("http");
        url_schemes.insert("https");
    }

    Builder::default()
        .url_schemes(url_schemes)
        .rm_tags(&["style"])
        .clean(&html.chars().take(30_000).collect::<String>())
        .to_string()
        .chars()
        .take(20_000)
        .collect()
}

fn extract_links(html: &str) -> Vec<(String, String)> {
    let lower = html.to_ascii_lowercase();
    let mut links = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<a") {
        let start = cursor + relative_start;
        let Some(tag_end_relative) = lower[start..].find('>') else {
            break;
        };
        let tag_end = start + tag_end_relative;
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

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let pattern = format!("{attr}=");
    let attr_start = lower.find(&pattern)? + pattern.len();
    let rest = &tag[attr_start..];
    let mut chars = rest.chars();
    let first = chars.next()?;
    if first == '"' || first == '\'' {
        let value: String = chars.take_while(|ch| *ch != first).collect();
        return Some(value.trim().to_string());
    }
    Some(
        rest.split_whitespace()
            .next()
            .unwrap_or_default()
            .trim_matches('>')
            .trim()
            .to_string(),
    )
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
    fn sanitizer_blocks_javascript_links_and_style_blocks() {
        let sanitized = sanitize_html(
            "<style>body{display:none}</style><a href=\"javascript:alert(1)\">bad</a><a href=\"mailto:a@example.com\">mail</a>",
        );
        assert!(!sanitized.contains("<style"));
        assert!(!sanitized.contains("javascript:"));
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
}
