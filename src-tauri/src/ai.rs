use crate::models::AiChatCompletionInput;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MAX_AI_CONTENT_CHARS: usize = 60_000;
/// AI/MCP HTTP 响应读取上限：防止恶意服务端返回超大响应把应用内存打满。
const MAX_AI_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct AiChatRequest {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<AiChatCompletionInput>,
    pub timeout_seconds: u64,
}

#[derive(Debug, Deserialize)]
pub struct AiRequestInput {
    pub operation: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub target_language: String,
    #[serde(default)]
    pub prompt: String,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub service_type: String,
}

#[derive(Debug, Serialize)]
pub struct AiRequestResult {
    pub operation: String,
    pub content: String,
    pub truncated: bool,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct AiConnectionReport {
    pub ok: bool,
    pub service_type: String,
    pub message: String,
    pub latency_ms: u64,
}

#[derive(Debug, Serialize)]
struct OpenAiChatBody<'a> {
    model: &'a str,
    messages: &'a [AiChatCompletionInput],
    temperature: f64,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChatChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatChoice {
    message: OpenAiChatMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    total_tokens: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct AiChatOutcome {
    pub content: String,
    pub model: String,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub latency_ms: u64,
}

pub fn call_chat_completion(
    endpoint: &str,
    api_key: &str,
    model: &str,
    messages: &[AiChatCompletionInput],
    timeout_seconds: u64,
) -> Result<AiChatOutcome, String> {
    if endpoint.trim().is_empty() {
        return Err("AI 服务地址为空，请先在设置中配置。".to_string());
    }
    let validated = validate_ai_endpoint(endpoint)?;
    let url = normalize_endpoint(&validated);
    let started_at = std::time::Instant::now();
    let body = OpenAiChatBody {
        model,
        messages,
        temperature: 0.2,
    };
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(timeout_seconds.clamp(5, 300))))
        .build()
        .new_agent();
    let mut request = agent.post(&url).header("Content-Type", "application/json");
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let payload =
        serde_json::to_vec(&body).map_err(|error| format!("AI 请求序列化失败：{error}"))?;
    let mut response = request
        .send(payload)
        .map_err(|error| format!("AI 服务请求失败：{error}"))?;
    let status = response.status();
    let raw_body =
        crate::http::read_response_capped(response.body_mut().as_reader(), MAX_AI_RESPONSE_BYTES)?;
    let payload: OpenAiChatResponse = serde_json::from_str(&raw_body).map_err(|error| {
        if status.is_success() {
            format!("AI 服务响应解析失败：{error}")
        } else {
            format!("AI 服务返回 HTTP {status}")
        }
    })?;
    let latency_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;
    let content = payload
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone())
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err("AI 服务未返回有效内容。".to_string());
    }
    Ok(AiChatOutcome {
        content,
        model: model.to_string(),
        prompt_tokens: payload.usage.as_ref().and_then(|usage| usage.prompt_tokens),
        completion_tokens: payload
            .usage
            .as_ref()
            .and_then(|usage| usage.completion_tokens),
        total_tokens: payload.usage.as_ref().and_then(|usage| usage.total_tokens),
        latency_ms,
    })
}

fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim();
    if trimmed.ends_with("/chat/completions") || trimmed.ends_with("/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed.trim_end_matches('/'))
    }
}

/// 是否为本机回环开发主机（127.0.0.1 / localhost / [::1]）。
fn is_loopback_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).to_ascii_lowercase();
    matches!(
        normalized.as_str(),
        "localhost" | "127.0.0.1" | "::1" | "0:0:0:0:0:0:0:1"
    )
}

/// 校验 AI/MCP endpoint 的安全策略。
///
/// - 默认只允许 HTTPS。
/// - 仅对明确的 loopback 开发端点（127.0.0.1 / localhost / [::1]）允许 HTTP，
///   并返回清晰提示说明这是本机开发用途。
/// - 禁止 HTTP 到局域网或公网主机。
/// - 拒绝 userinfo（`http://user:pass@host`）与畸形 URL。
///
/// 返回校验通过、去掉首尾空白的 endpoint 字符串。
pub fn validate_ai_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim();
    if trimmed.is_empty() {
        return Err("AI 服务地址为空，请先在设置中配置。".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|_| {
        "AI 服务地址不是合法 URL，请检查是否包含协议前缀（https:// 或 http://）。".to_string()
    })?;
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("AI 服务地址缺少主机名。".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("AI 服务地址不允许包含用户名或密码（userinfo），请移除。".to_string());
    }
    match parsed.scheme() {
        "https" => Ok(trimmed.to_string()),
        "http" => {
            let host = parsed.host_str().unwrap_or_default();
            if is_loopback_host(host) {
                Ok(trimmed.to_string())
            } else {
                Err(format!(
                    "AI 服务仅允许 HTTPS 传输邮件内容与密钥；HTTP 仅允许用于本机开发端点 \
                     （127.0.0.1 / localhost / [::1]），当前主机 {host} 不受支持。"
                ))
            }
        }
        other => Err(format!(
            "AI 服务地址仅支持 https:// 或 http:// 协议，当前为 {other}://。"
        )),
    }
}

fn prompt_for_operation(
    operation: &str,
    text: &str,
    target_language: &str,
    prompt: &str,
) -> Vec<AiChatCompletionInput> {
    match operation {
        "translate" => {
            let target = if target_language.trim().is_empty() {
                "中文".to_string()
            } else {
                target_language.trim().to_string()
            };
            vec![
                AiChatCompletionInput {
                    role: "system".to_string(),
                    content: format!(
                        "你是专业的邮件翻译助手。把用户提供的邮件内容翻译成{target}，\
                         保持原文语气与格式，只输出译文，不要解释。"
                    ),
                },
                AiChatCompletionInput {
                    role: "user".to_string(),
                    content: text.to_string(),
                },
            ]
        }
        "generate_template" => vec![
            AiChatCompletionInput {
                role: "system".to_string(),
                content: "你是邮件写作助手。根据用户描述生成一封邮件模板，\
                         输出格式为：\n主题：<主题>\n正文：\n<正文>。正文可以使用 {{contact.name}}、\
                         {{account.email}} 等变量。不要输出多余说明。".to_string(),
            },
            AiChatCompletionInput {
                role: "user".to_string(),
                content: if prompt.trim().is_empty() {
                    "写一封通用商务邮件模板。".to_string()
                } else {
                    prompt.to_string()
                },
            },
        ],
        "summarize" => vec![
            AiChatCompletionInput {
                role: "system".to_string(),
                content: "你是邮件摘要助手。用简洁的中文总结以下邮件内容，列出关键信息与待办事项。".to_string(),
            },
            AiChatCompletionInput {
                role: "user".to_string(),
                content: text.to_string(),
            },
        ],
        _ => vec![AiChatCompletionInput {
            role: "user".to_string(),
            content: if prompt.trim().is_empty() { text.to_string() } else { prompt.to_string() },
        }],
    }
}

pub fn run_ai_request(input: &AiRequestInput) -> Result<AiRequestResult, String> {
    let started_at = std::time::Instant::now();
    let messages = prompt_for_operation(
        &input.operation,
        &input.text,
        &input.target_language,
        &input.prompt,
    );
    let outcome = call_chat_completion(
        &input.endpoint,
        &input.api_key,
        &input.model,
        &messages,
        input.timeout_seconds.max(5),
    )?;
    let raw = outcome.content;
    let truncated = raw.chars().count() > MAX_AI_CONTENT_CHARS;
    let content = raw.chars().take(MAX_AI_CONTENT_CHARS).collect::<String>();
    Ok(AiRequestResult {
        operation: input.operation.clone(),
        content,
        truncated,
        latency_ms: started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
    })
}

fn json_rpc_call(
    endpoint: &str,
    api_key: &str,
    method: &str,
    params: serde_json::Value,
    timeout_seconds: u64,
) -> Result<serde_json::Value, String> {
    let validated = validate_ai_endpoint(endpoint)?;
    let url = validated.trim_end_matches('/').to_string();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(timeout_seconds.clamp(5, 300))))
        .build()
        .new_agent();
    let mut request = agent.post(&url).header("Content-Type", "application/json");
    if !api_key.trim().is_empty() {
        request = request.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    let payload =
        serde_json::to_vec(&body).map_err(|error| format!("MCP 请求序列化失败：{error}"))?;
    let mut response = request
        .send(payload)
        .map_err(|error| format!("MCP 服务请求失败：{error}"))?;
    let status = response.status();
    let raw_body =
        crate::http::read_response_capped(response.body_mut().as_reader(), MAX_AI_RESPONSE_BYTES)?;
    let payload: serde_json::Value = serde_json::from_str(&raw_body).map_err(|error| {
        if status.is_success() {
            format!("MCP 服务响应解析失败：{error}")
        } else {
            format!("MCP 服务返回 HTTP {status}")
        }
    })?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("未知错误");
        return Err(format!("MCP 服务错误：{message}"));
    }
    Ok(payload)
}

fn mcp_result_content(result: &serde_json::Value) -> Option<String> {
    if let Some(text) = result.get("text").and_then(|value| value.as_str()) {
        return Some(text.to_string());
    }
    if let Some(content) = result.get("content").and_then(|value| value.as_array()) {
        let mut parts = Vec::new();
        for item in content {
            if let Some(text) = item.get("text").and_then(|value| value.as_str()) {
                parts.push(text.to_string());
            } else if let Ok(serialized) = serde_json::to_string(item) {
                parts.push(serialized);
            }
        }
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    if let Some(string) = result.as_str() {
        return Some(string.to_string());
    }
    None
}

pub fn run_mcp_tool_call(input: &AiRequestInput) -> Result<AiRequestResult, String> {
    let started_at = std::time::Instant::now();
    let endpoint = input.endpoint.trim();
    if endpoint.is_empty() {
        return Err("MCP 服务地址为空，请先在设置中配置。".to_string());
    }
    json_rpc_call(
        endpoint,
        &input.api_key,
        "initialize",
        serde_json::json!({
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": { "name": "better-email", "version": "1.0.0" },
        }),
        input.timeout_seconds.max(5),
    )?;
    let tool_names: Vec<&str> = match input.operation.as_str() {
        "translate" => vec!["translate_message", "translate"],
        "generate_template" => vec!["generate_template"],
        "summarize" => vec!["summarize_message", "summarize"],
        _ => vec!["chat"],
    };
    let arguments = match input.operation.as_str() {
        "translate" => serde_json::json!({
            "text": input.text,
            "target_language": if input.target_language.trim().is_empty() { "中文" } else { input.target_language.trim() },
        }),
        "generate_template" => serde_json::json!({
            "prompt": if input.prompt.trim().is_empty() { "写一封通用商务邮件模板。" } else { input.prompt.trim() },
        }),
        "summarize" => serde_json::json!({ "text": input.text }),
        _ => serde_json::json!({ "text": input.text, "prompt": input.prompt }),
    };
    let mut last_error = String::new();
    for tool_name in tool_names {
        match json_rpc_call(
            endpoint,
            &input.api_key,
            "tools/call",
            serde_json::json!({ "name": tool_name, "arguments": arguments }),
            input.timeout_seconds.max(5),
        ) {
            Ok(payload) => {
                if let Some(content) = payload.get("result").and_then(mcp_result_content) {
                    let truncated = content.chars().count() > MAX_AI_CONTENT_CHARS;
                    let content = content
                        .chars()
                        .take(MAX_AI_CONTENT_CHARS)
                        .collect::<String>();
                    return Ok(AiRequestResult {
                        operation: input.operation.clone(),
                        content,
                        truncated,
                        latency_ms: started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
                    });
                }
                last_error = format!("MCP 工具 {tool_name} 未返回可用文本内容。");
            }
            Err(error) => {
                last_error = format!("MCP 工具 {tool_name} 调用失败：{error}");
            }
        }
    }
    Err(if last_error.is_empty() {
        "MCP 服务没有可用的翻译/模板工具。".to_string()
    } else {
        last_error
    })
}

pub fn test_ai_connection(
    service_type: &str,
    endpoint: &str,
    api_key: &str,
    model: &str,
    timeout_seconds: u64,
) -> Result<AiConnectionReport, String> {
    let started_at = std::time::Instant::now();
    match service_type {
        "mcp" => {
            json_rpc_call(
                endpoint,
                api_key,
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": { "name": "better-email", "version": "1.0.0" },
                }),
                timeout_seconds.max(5),
            )?;
            Ok(AiConnectionReport {
                ok: true,
                service_type: "mcp".to_string(),
                message: "MCP 服务连接正常。".to_string(),
                latency_ms: started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
            })
        }
        _ => {
            let _outcome = call_chat_completion(
                endpoint,
                api_key,
                if model.trim().is_empty() {
                    "gpt-4o-mini"
                } else {
                    model
                },
                &[AiChatCompletionInput {
                    role: "user".to_string(),
                    content: "ping".to_string(),
                }],
                timeout_seconds.max(5),
            )?;
            Ok(AiConnectionReport {
                ok: true,
                service_type: "http".to_string(),
                message: "AI 服务连接正常。".to_string(),
                latency_ms: started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_ai_endpoint;
    use super::MAX_AI_RESPONSE_BYTES;
    use crate::http::read_response_capped;

    #[test]
    fn https_endpoints_are_allowed() {
        assert!(validate_ai_endpoint("https://api.openai.com/v1").is_ok());
        assert!(validate_ai_endpoint("https://mcp.example.com/sse").is_ok());
        assert!(validate_ai_endpoint("https://127.0.0.1:443/v1").is_ok());
    }

    #[test]
    fn http_response_reader_caps_large_payloads_without_buffering_whole_body() {
        let small = read_response_capped(&b"{\"ok\":true}"[..], MAX_AI_RESPONSE_BYTES)
            .expect("small response read");
        assert_eq!(small, "{\"ok\":true}");

        let big = vec![b'x'; (MAX_AI_RESPONSE_BYTES as usize) + 10];
        let err = read_response_capped(&big[..], MAX_AI_RESPONSE_BYTES)
            .expect_err("oversized response rejected");
        assert!(
            err.contains("超过大小上限"),
            "超大响应应在读取阶段被拒绝：{err}"
        );
    }

    #[test]
    fn loopback_http_is_allowed_for_development() {
        assert!(validate_ai_endpoint("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_ai_endpoint("http://localhost:3000").is_ok());
        assert!(validate_ai_endpoint("http://[::1]:8080").is_ok());
    }

    #[test]
    fn public_or_lan_http_is_rejected() {
        let public = validate_ai_endpoint("http://api.example.com/v1");
        assert!(public.is_err());
        assert!(public.unwrap_err().contains("HTTPS"));

        let lan = validate_ai_endpoint("http://192.168.1.10:8080");
        assert!(lan.is_err());
        assert!(lan.unwrap_err().contains("HTTPS"));

        let private = validate_ai_endpoint("http://10.0.0.5/v1");
        assert!(private.is_err());
    }

    #[test]
    fn userinfo_and_malformed_urls_are_rejected() {
        let userinfo = validate_ai_endpoint("http://user:secret@api.example.com/v1");
        assert!(userinfo.is_err());
        assert!(userinfo.unwrap_err().contains("userinfo"));

        let userinfo_https = validate_ai_endpoint("https://user@api.example.com/v1");
        assert!(userinfo_https.is_err());

        let malformed = validate_ai_endpoint("not a url");
        assert!(malformed.is_err());

        let no_scheme = validate_ai_endpoint("api.example.com/v1");
        assert!(no_scheme.is_err());

        let empty = validate_ai_endpoint("   ");
        assert!(empty.is_err());

        let ftp = validate_ai_endpoint("ftp://example.com/v1");
        assert!(ftp.is_err());
        assert!(ftp.unwrap_err().contains("https:// 或 http://"));
    }
}
