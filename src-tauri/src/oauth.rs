use crate::db::OAuthTokenExchangeSession;
use crate::models::{OAuthStartInput, OAuthStartReport};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration as StdDuration, Instant};
use uuid::Uuid;

struct OAuthProviderConfig {
    authorization_endpoint: &'static str,
    token_endpoint: &'static str,
    scopes: &'static [&'static str],
    extras: &'static [(&'static str, &'static str)],
}

#[derive(Debug, Clone)]
pub struct OAuthAuthorizationDraft {
    pub report: OAuthStartReport,
    pub code_verifier: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthCallbackPayload {
    pub state: String,
    pub code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalCallbackEndpoint {
    pub bind_host: String,
    pub port: u16,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OAuthTokenRequest {
    pub token_endpoint: String,
    pub form: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthTokenBundle {
    pub provider: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: String,
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: String,
    pub scope: String,
    pub expires_at: String,
    pub stored_at: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    token_type: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: String,
}

pub fn start_pkce_authorization(input: OAuthStartInput) -> Result<OAuthAuthorizationDraft, String> {
    let client_id = input.client_id.trim();
    let redirect_uri = input.redirect_uri.trim();
    if client_id.is_empty() {
        return Err("OAuth2 Client ID 不能为空。".to_string());
    }
    if redirect_uri.is_empty() {
        return Err("OAuth2 Redirect URI 不能为空。".to_string());
    }

    let provider = input.provider.trim().to_ascii_lowercase();
    let config = provider_config(&provider)
        .ok_or_else(|| format!("当前服务商暂不支持 OAuth2 PKCE 向导：{}", input.provider))?;
    let state = Uuid::new_v4().to_string();
    let code_verifier = new_code_verifier();
    let code_challenge = code_challenge_for_verifier(&code_verifier);
    let scopes = config
        .scopes
        .iter()
        .map(|scope| (*scope).to_string())
        .collect::<Vec<_>>();
    let authorization_url = build_authorization_url(
        config,
        client_id,
        redirect_uri,
        input.login_hint.trim(),
        &state,
        &code_challenge,
    );

    Ok(OAuthAuthorizationDraft {
        code_verifier: code_verifier.clone(),
        report: OAuthStartReport {
            session_id: 0,
            provider,
            authorization_url,
            redirect_uri: redirect_uri.to_string(),
            state,
            code_challenge,
            code_verifier_hint: format!(
                "已生成 {} 字符 PKCE verifier，后续 token 交换会使用。",
                code_verifier.len()
            ),
            scopes,
            message: "OAuth2 授权页已打开；完成登录后，本地回调/token 交换是下一步。".to_string(),
        },
    })
}

fn provider_config(provider: &str) -> Option<OAuthProviderConfig> {
    match provider {
        "gmail" => Some(OAuthProviderConfig {
            authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
            token_endpoint: "https://oauth2.googleapis.com/token",
            scopes: &["openid", "email", "https://mail.google.com/"],
            extras: &[("access_type", "offline"), ("prompt", "consent")],
        }),
        "outlook" => Some(OAuthProviderConfig {
            authorization_endpoint:
                "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token_endpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            scopes: &[
                "offline_access",
                "https://outlook.office.com/IMAP.AccessAsUser.All",
                "https://outlook.office.com/SMTP.Send",
            ],
            extras: &[("prompt", "select_account")],
        }),
        _ => None,
    }
}

fn new_code_verifier() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn code_challenge_for_verifier(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn build_authorization_url(
    config: OAuthProviderConfig,
    client_id: &str,
    redirect_uri: &str,
    login_hint: &str,
    state: &str,
    code_challenge: &str,
) -> String {
    let mut params = vec![
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("response_type", "code".to_string()),
        ("scope", config.scopes.join(" ")),
        ("state", state.to_string()),
        ("code_challenge", code_challenge.to_string()),
        ("code_challenge_method", "S256".to_string()),
    ];
    if !login_hint.is_empty() {
        params.push(("login_hint", login_hint.to_string()));
    }
    for (key, value) in config.extras {
        params.push((key, (*value).to_string()));
    }

    let query = params
        .into_iter()
        .map(|(key, value)| format!("{key}={}", urlencoding::encode(&value)))
        .collect::<Vec<_>>()
        .join("&");
    format!("{}?{query}", config.authorization_endpoint)
}

pub fn build_token_exchange_request(
    session: &OAuthTokenExchangeSession,
    client_id: &str,
    client_secret: &str,
) -> Result<OAuthTokenRequest, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("OAuth2 Client ID 不能为空。".to_string());
    }
    let provider = session.provider.trim().to_ascii_lowercase();
    let config = provider_config(&provider)
        .ok_or_else(|| format!("当前服务商暂不支持 OAuth2 token 交换：{}", session.provider))?;
    let mut form = vec![
        ("client_id".to_string(), client_id.to_string()),
        ("grant_type".to_string(), "authorization_code".to_string()),
        (
            "code".to_string(),
            session.authorization_code.trim().to_string(),
        ),
        (
            "redirect_uri".to_string(),
            session.redirect_uri.trim().to_string(),
        ),
        (
            "code_verifier".to_string(),
            session.code_verifier.trim().to_string(),
        ),
    ];
    let client_secret = client_secret.trim();
    if !client_secret.is_empty() {
        form.push(("client_secret".to_string(), client_secret.to_string()));
    }
    Ok(OAuthTokenRequest {
        token_endpoint: config.token_endpoint.to_string(),
        form,
    })
}

pub fn exchange_token(
    session: &OAuthTokenExchangeSession,
    client_id: &str,
    client_secret: &str,
) -> Result<OAuthTokenBundle, String> {
    let request = build_token_exchange_request(session, client_id, client_secret)?;
    let mut response = ureq::post(&request.token_endpoint)
        .send_form(
            request
                .form
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .map_err(|error| format!("OAuth2 token 交换请求失败：{error}"))?;
    let status = response.status();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("OAuth2 token 响应读取失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OAuth2 token 端点返回 HTTP {}：{}",
            status.as_u16(),
            truncate_for_log(&body)
        ));
    }
    let mut bundle = token_bundle_from_response(session, &body)?;
    bundle.client_id = client_id.trim().to_string();
    bundle.client_secret = client_secret.trim().to_string();
    Ok(bundle)
}

pub fn build_refresh_token_request(
    bundle: &OAuthTokenBundle,
    client_id: &str,
    client_secret: &str,
) -> Result<OAuthTokenRequest, String> {
    let client_id = if client_id.trim().is_empty() {
        bundle.client_id.trim()
    } else {
        client_id.trim()
    };
    if client_id.is_empty() {
        return Err("OAuth2 Client ID 不能为空。".to_string());
    }
    if bundle.refresh_token.trim().is_empty() {
        return Err("OAuth2 token 缺少 refresh_token，请重新授权。".to_string());
    }
    let provider = bundle.provider.trim().to_ascii_lowercase();
    let config = provider_config(&provider)
        .ok_or_else(|| format!("当前服务商暂不支持 OAuth2 token 刷新：{}", bundle.provider))?;
    let mut form = vec![
        ("client_id".to_string(), client_id.to_string()),
        ("grant_type".to_string(), "refresh_token".to_string()),
        (
            "refresh_token".to_string(),
            bundle.refresh_token.trim().to_string(),
        ),
    ];
    let client_secret = if client_secret.trim().is_empty() {
        bundle.client_secret.trim()
    } else {
        client_secret.trim()
    };
    if !client_secret.is_empty() {
        form.push(("client_secret".to_string(), client_secret.to_string()));
    }
    Ok(OAuthTokenRequest {
        token_endpoint: config.token_endpoint.to_string(),
        form,
    })
}

pub fn refresh_token(
    bundle: &OAuthTokenBundle,
    client_id: &str,
    client_secret: &str,
) -> Result<OAuthTokenBundle, String> {
    let effective_client_id = if client_id.trim().is_empty() {
        bundle.client_id.trim()
    } else {
        client_id.trim()
    };
    let effective_client_secret = if client_secret.trim().is_empty() {
        bundle.client_secret.trim()
    } else {
        client_secret.trim()
    };
    let request = build_refresh_token_request(bundle, client_id, client_secret)?;
    let mut response = ureq::post(&request.token_endpoint)
        .send_form(
            request
                .form
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .map_err(|error| format!("OAuth2 token 刷新请求失败：{error}"))?;
    let status = response.status();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("OAuth2 token 刷新响应读取失败：{error}"))?;
    if !status.is_success() {
        return Err(format!(
            "OAuth2 token 刷新端点返回 HTTP {}：{}",
            status.as_u16(),
            truncate_for_log(&body)
        ));
    }
    let mut refreshed = refreshed_bundle_from_response(bundle, &body)?;
    refreshed.client_id = effective_client_id.to_string();
    refreshed.client_secret = effective_client_secret.to_string();
    Ok(refreshed)
}

pub fn token_bundle_from_response(
    session: &OAuthTokenExchangeSession,
    body: &str,
) -> Result<OAuthTokenBundle, String> {
    let response: OAuthTokenResponse = serde_json::from_str(body)
        .map_err(|error| format!("OAuth2 token JSON 解析失败：{error}"))?;
    if response.access_token.trim().is_empty() {
        return Err("OAuth2 token 响应缺少 access_token。".to_string());
    }
    let now = Utc::now();
    let expires_at = response
        .expires_in
        .filter(|seconds| *seconds > 0)
        .map(|seconds| now + Duration::seconds(seconds))
        .unwrap_or(now)
        .to_rfc3339();
    Ok(OAuthTokenBundle {
        provider: session.provider.clone(),
        client_id: String::new(),
        client_secret: String::new(),
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        token_type: if response.token_type.trim().is_empty() {
            "Bearer".to_string()
        } else {
            response.token_type
        },
        scope: if response.scope.trim().is_empty() {
            session.scopes.join(" ")
        } else {
            response.scope
        },
        expires_at,
        stored_at: now.to_rfc3339(),
    })
}

pub fn refreshed_bundle_from_response(
    existing: &OAuthTokenBundle,
    body: &str,
) -> Result<OAuthTokenBundle, String> {
    let response: OAuthTokenResponse = serde_json::from_str(body)
        .map_err(|error| format!("OAuth2 refresh token JSON 解析失败：{error}"))?;
    if response.access_token.trim().is_empty() {
        return Err("OAuth2 refresh 响应缺少 access_token。".to_string());
    }
    let now = Utc::now();
    let expires_at = response
        .expires_in
        .filter(|seconds| *seconds > 0)
        .map(|seconds| now + Duration::seconds(seconds))
        .unwrap_or(now)
        .to_rfc3339();
    Ok(OAuthTokenBundle {
        provider: existing.provider.clone(),
        client_id: existing.client_id.clone(),
        client_secret: existing.client_secret.clone(),
        access_token: response.access_token,
        refresh_token: if response.refresh_token.trim().is_empty() {
            existing.refresh_token.clone()
        } else {
            response.refresh_token
        },
        token_type: if response.token_type.trim().is_empty() {
            existing.token_type.clone()
        } else {
            response.token_type
        },
        scope: if response.scope.trim().is_empty() {
            existing.scope.clone()
        } else {
            response.scope
        },
        expires_at,
        stored_at: now.to_rfc3339(),
    })
}

pub fn token_needs_refresh(bundle: &OAuthTokenBundle) -> bool {
    chrono::DateTime::parse_from_rfc3339(&bundle.expires_at)
        .map(|expires_at| expires_at.with_timezone(&Utc) <= Utc::now() + Duration::minutes(5))
        .unwrap_or(true)
}

pub fn wait_for_local_callback(
    redirect_uri: &str,
    timeout_seconds: i64,
) -> Result<OAuthCallbackPayload, String> {
    let endpoint = parse_local_callback_endpoint(redirect_uri)?;
    let listener = TcpListener::bind((endpoint.bind_host.as_str(), endpoint.port))
        .map_err(|error| format!("无法监听 OAuth2 本地回调端口 {}：{error}", endpoint.port))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("OAuth2 本地回调监听配置失败：{error}"))?;
    let timeout = StdDuration::from_secs(timeout_seconds.clamp(10, 300) as u64);
    let started = Instant::now();

    while started.elapsed() < timeout {
        match listener.accept() {
            Ok((mut stream, _addr)) => return handle_callback_stream(&mut stream, &endpoint),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(StdDuration::from_millis(100));
            }
            Err(error) => return Err(format!("OAuth2 本地回调接收失败：{error}")),
        }
    }
    Err("等待 OAuth2 本地回调超时，请重新打开授权页。".to_string())
}

pub fn parse_local_callback_url(path_and_query: &str) -> Result<OAuthCallbackPayload, String> {
    let (_path, query) = path_and_query
        .split_once('?')
        .ok_or_else(|| "OAuth2 回调缺少查询参数。".to_string())?;
    let params = parse_query(query)?;
    let state = params.get("state").cloned().unwrap_or_default();
    let code = params.get("code").cloned().unwrap_or_default();
    if let Some(error) = params.get("error").filter(|value| !value.trim().is_empty()) {
        let detail = params
            .get("error_description")
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(error);
        return Err(format!("OAuth2 授权失败：{}", detail));
    }
    if state.trim().is_empty() || code.trim().is_empty() {
        return Err("OAuth2 回调缺少 state 或 code。".to_string());
    }
    Ok(OAuthCallbackPayload { state, code })
}

pub fn parse_local_callback_endpoint(redirect_uri: &str) -> Result<LocalCallbackEndpoint, String> {
    let uri = redirect_uri.trim();
    let rest = uri.strip_prefix("http://").ok_or_else(|| {
        "OAuth2 本地回调 Redirect URI 必须使用 http://127.0.0.1 或 http://localhost。".to_string()
    })?;
    let (authority, path_query) = rest
        .split_once('/')
        .map(|(authority, path)| (authority, format!("/{path}")))
        .unwrap_or((rest, "/".to_string()));
    let (host, port) = authority
        .rsplit_once(':')
        .ok_or_else(|| "OAuth2 本地回调 Redirect URI 必须包含端口。".to_string())?;
    if !matches!(host, "127.0.0.1" | "localhost") {
        return Err("OAuth2 本地回调只允许绑定 127.0.0.1 或 localhost。".to_string());
    }
    let port = port
        .parse::<u16>()
        .map_err(|_| "OAuth2 本地回调端口格式无效。".to_string())?;
    let path = path_query
        .split_once('?')
        .map(|(path, _)| path.to_string())
        .unwrap_or(path_query);
    Ok(LocalCallbackEndpoint {
        bind_host: "127.0.0.1".to_string(),
        port,
        path,
    })
}

fn handle_callback_stream(
    stream: &mut TcpStream,
    endpoint: &LocalCallbackEndpoint,
) -> Result<OAuthCallbackPayload, String> {
    let mut buffer = [0_u8; 4096];
    let read = stream
        .read(&mut buffer)
        .map_err(|error| format!("OAuth2 本地回调读取失败：{error}"))?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let first_line = request.lines().next().unwrap_or_default();
    let target = first_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "OAuth2 本地回调请求格式无效。".to_string())?;
    if !target.starts_with(&endpoint.path) {
        write_callback_response(stream, 404, "Better Email OAuth2 回调路径不匹配。");
        return Err("OAuth2 本地回调路径不匹配。".to_string());
    }
    match parse_local_callback_url(target) {
        Ok(payload) => {
            write_callback_response(
                stream,
                200,
                "Better Email OAuth2 授权已接收，可以回到应用继续交换 Token。",
            );
            Ok(payload)
        }
        Err(error) => {
            write_callback_response(stream, 400, &error);
            Err(error)
        }
    }
}

fn parse_query(query: &str) -> Result<HashMap<String, String>, String> {
    let mut params = HashMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(key)
            .map_err(|error| format!("OAuth2 回调参数解码失败：{error}"))?
            .into_owned();
        let value = urlencoding::decode(value)
            .map_err(|error| format!("OAuth2 回调参数解码失败：{error}"))?
            .into_owned();
        params.insert(key, value);
    }
    Ok(params)
}

fn write_callback_response(stream: &mut TcpStream, status: u16, message: &str) {
    let status_text = if status == 200 { "OK" } else { "Bad Request" };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Better Email OAuth2</title><body><h1>{}</h1><p>{}</p></body>",
        if status == 200 { "授权已接收" } else { "授权未完成" },
        message
    );
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn truncate_for_log(value: &str) -> String {
    const LIMIT: usize = 240;
    let value = value.trim();
    if value.len() <= LIMIT {
        value.to_string()
    } else {
        format!("{}...", &value[..LIMIT])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_gmail_pkce_authorization_url() {
        let draft = start_pkce_authorization(OAuthStartInput {
            provider: "gmail".to_string(),
            client_id: "client-123".to_string(),
            redirect_uri: "http://127.0.0.1:17645/oauth/callback".to_string(),
            login_hint: "me@example.com".to_string(),
        })
        .unwrap();
        let report = draft.report;

        assert_eq!(report.provider, "gmail");
        assert_eq!(report.session_id, 0);
        assert_eq!(draft.code_verifier.len(), 64);
        assert!(report
            .authorization_url
            .starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(report.authorization_url.contains("client_id=client-123"));
        assert!(report
            .authorization_url
            .contains("code_challenge_method=S256"));
        assert!(report.authorization_url.contains("access_type=offline"));
        assert!(report
            .scopes
            .contains(&"https://mail.google.com/".to_string()));
    }

    #[test]
    fn rejects_unsupported_oauth_provider() {
        let error = start_pkce_authorization(OAuthStartInput {
            provider: "qq".to_string(),
            client_id: "client-123".to_string(),
            redirect_uri: "http://127.0.0.1:17645/oauth/callback".to_string(),
            login_hint: "".to_string(),
        })
        .unwrap_err();

        assert!(error.contains("暂不支持"));
    }

    #[test]
    fn builds_gmail_token_exchange_request() {
        let session = OAuthTokenExchangeSession {
            id: 42,
            account_email: "me@example.com".to_string(),
            provider: "gmail".to_string(),
            redirect_uri: "http://127.0.0.1:17645/oauth/callback".to_string(),
            code_verifier: "verifier-123".to_string(),
            scopes: vec!["openid".to_string(), "https://mail.google.com/".to_string()],
            authorization_code: "code-123".to_string(),
            status: "code_received".to_string(),
        };

        let request = build_token_exchange_request(&session, "client-123", "").unwrap();

        assert_eq!(
            request.token_endpoint,
            "https://oauth2.googleapis.com/token"
        );
        assert!(request
            .form
            .contains(&("grant_type".to_string(), "authorization_code".to_string())));
        assert!(request
            .form
            .contains(&("code_verifier".to_string(), "verifier-123".to_string())));
        assert!(!request.form.iter().any(|(key, _)| key == "client_secret"));
    }

    #[test]
    fn parses_token_response_into_keychain_bundle() {
        let session = OAuthTokenExchangeSession {
            id: 42,
            account_email: "me@example.com".to_string(),
            provider: "outlook".to_string(),
            redirect_uri: "http://127.0.0.1:17645/oauth/callback".to_string(),
            code_verifier: "verifier-123".to_string(),
            scopes: vec!["offline_access".to_string()],
            authorization_code: "code-123".to_string(),
            status: "code_received".to_string(),
        };

        let bundle = token_bundle_from_response(
            &session,
            r#"{"access_token":"access-123","refresh_token":"refresh-123","token_type":"Bearer","expires_in":3600}"#,
        )
        .unwrap();

        assert_eq!(bundle.provider, "outlook");
        assert_eq!(bundle.refresh_token, "refresh-123");
        assert_eq!(bundle.scope, "offline_access");
        assert!(!bundle.expires_at.is_empty());
    }

    #[test]
    fn builds_refresh_token_request_and_preserves_refresh_token() {
        let existing = OAuthTokenBundle {
            provider: "gmail".to_string(),
            client_id: "client-123".to_string(),
            client_secret: "".to_string(),
            access_token: "old-access".to_string(),
            refresh_token: "refresh-123".to_string(),
            token_type: "Bearer".to_string(),
            scope: "https://mail.google.com/".to_string(),
            expires_at: "2026-07-08T00:00:00Z".to_string(),
            stored_at: "2026-07-08T00:00:00Z".to_string(),
        };
        let request = build_refresh_token_request(&existing, "client-123", "").unwrap();
        assert_eq!(
            request.token_endpoint,
            "https://oauth2.googleapis.com/token"
        );
        assert!(request
            .form
            .contains(&("grant_type".to_string(), "refresh_token".to_string())));
        assert!(request
            .form
            .contains(&("refresh_token".to_string(), "refresh-123".to_string())));

        let refreshed = refreshed_bundle_from_response(
            &existing,
            r#"{"access_token":"new-access","token_type":"Bearer","expires_in":3600}"#,
        )
        .unwrap();
        assert_eq!(refreshed.access_token, "new-access");
        assert_eq!(refreshed.refresh_token, "refresh-123");
        assert_eq!(refreshed.scope, "https://mail.google.com/");
        assert_eq!(refreshed.client_id, "client-123");
    }

    #[test]
    fn parses_local_callback_endpoint_and_payload() {
        let endpoint =
            parse_local_callback_endpoint("http://127.0.0.1:17645/oauth/callback").unwrap();
        assert_eq!(endpoint.bind_host, "127.0.0.1");
        assert_eq!(endpoint.port, 17645);
        assert_eq!(endpoint.path, "/oauth/callback");

        let payload = parse_local_callback_url("/oauth/callback?state=s-123&code=c%20123")
            .expect("callback parses");
        assert_eq!(payload.state, "s-123");
        assert_eq!(payload.code, "c 123");

        let error = parse_local_callback_url("/oauth/callback?error=access_denied")
            .expect_err("callback error should be reported");
        assert_eq!(error, "OAuth2 授权失败：access_denied");

        let described_error = parse_local_callback_url(
            "/oauth/callback?error=server_error&error_description=Try%20again",
        )
        .expect_err("callback error description should be reported");
        assert_eq!(described_error, "OAuth2 授权失败：Try again");
    }
}
