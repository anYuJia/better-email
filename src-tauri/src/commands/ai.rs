use crate::ai::{
    run_ai_request, run_mcp_tool_call, test_ai_connection as test_connection_inner, AiChatOutcome,
    AiChatRequest, AiConnectionReport, AiRequestInput, AiRequestResult,
};
use crate::db::ai_settings::AiSettingsRecord;
use crate::db::MailStore;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiSettingsSaveInput {
    pub enabled: bool,
    pub service_type: String,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub privacy_acknowledged: bool,
    pub mcp_enabled: bool,
    pub mcp_endpoint: String,
    pub mcp_api_key: String,
    /// 为 true 时显式删除已保存的 API key；空 api_key 且未标记清除时表示「保持现有密钥」。
    #[serde(default)]
    pub clear_api_key: bool,
    #[serde(default)]
    pub clear_mcp_api_key: bool,
}

/// 前端可见的 AI 设置报告：绝不回传完整密钥，只返回「是否已配置」。
#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsReport {
    pub enabled: bool,
    pub service_type: String,
    pub endpoint: String,
    pub has_api_key: bool,
    pub model: String,
    pub timeout_seconds: u64,
    pub privacy_acknowledged: bool,
    pub mcp_enabled: bool,
    pub mcp_endpoint: String,
    pub has_mcp_api_key: bool,
}

impl From<AiSettingsRecord> for AiSettingsReport {
    fn from(record: AiSettingsRecord) -> Self {
        AiSettingsReport {
            enabled: record.enabled,
            service_type: record.service_type,
            endpoint: record.endpoint,
            has_api_key: !record.api_key.trim().is_empty(),
            model: record.model,
            timeout_seconds: record.timeout_seconds,
            privacy_acknowledged: record.privacy_acknowledged,
            mcp_enabled: record.mcp_enabled,
            mcp_endpoint: record.mcp_endpoint,
            has_mcp_api_key: !record.mcp_api_key.trim().is_empty(),
        }
    }
}

#[tauri::command]
pub async fn ai_chat_request(
    store: State<'_, MailStore>,
    input: AiChatRequest,
) -> Result<AiChatOutcome, String> {
    // 优先使用本地存储的密钥，避免前端把已保存密钥来回传递；前端传入的
    // 新密钥仅在本地无存储值时作为测试/暂存值使用。
    let api_key = stored_api_key(&store, &input.api_key);
    crate::ai::call_chat_completion(
        &input.endpoint,
        &api_key,
        &input.model,
        &input.messages,
        input.timeout_seconds,
    )
}

#[tauri::command]
pub async fn ai_request(
    store: State<'_, MailStore>,
    input: AiRequestInput,
) -> Result<AiRequestResult, String> {
    let mut input = input;
    if input.service_type.as_str() == "mcp" {
        input.api_key = stored_mcp_api_key(&store, &input.api_key);
    } else {
        input.api_key = stored_api_key(&store, &input.api_key);
    }
    match input.service_type.as_str() {
        "mcp" => run_mcp_tool_call(&input),
        _ => run_ai_request(&input),
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    store: State<'_, MailStore>,
    service_type: String,
    endpoint: String,
    api_key: String,
    model: String,
    timeout_seconds: u64,
) -> Result<AiConnectionReport, String> {
    let api_key = if service_type.as_str() == "mcp" {
        stored_mcp_api_key(&store, &api_key)
    } else {
        stored_api_key(&store, &api_key)
    };
    test_connection_inner(&service_type, &endpoint, &api_key, &model, timeout_seconds)
}

#[tauri::command]
pub fn save_ai_settings(
    store: State<'_, MailStore>,
    input: AiSettingsSaveInput,
) -> Result<String, String> {
    // 前端不回传已保存的密钥：空值表示「保持现有」，clear_api_key 表示显式删除。
    let existing = store.load_ai_settings().ok();
    let api_key = resolve_secret_key(
        input.api_key.trim(),
        input.clear_api_key,
        existing.as_ref().map(|record| record.api_key.as_str()),
    );
    let mcp_api_key = resolve_secret_key(
        input.mcp_api_key.trim(),
        input.clear_mcp_api_key,
        existing.as_ref().map(|record| record.mcp_api_key.as_str()),
    );
    let record = AiSettingsRecord {
        enabled: input.enabled,
        service_type: input.service_type,
        endpoint: input.endpoint,
        api_key,
        model: input.model,
        timeout_seconds: input.timeout_seconds,
        privacy_acknowledged: input.privacy_acknowledged,
        mcp_enabled: input.mcp_enabled,
        mcp_endpoint: input.mcp_endpoint,
        mcp_api_key,
    };
    // AI 密钥只写入应用自己的本地数据库，不触碰系统凭据库，
    // 保证打开设置页时不会触发任何 Keychain 访问或授权提示。
    store
        .save_ai_settings(&record)
        .map_err(|error| error.to_string())?;
    Ok("AI 服务设置已保存。".to_string())
}

/// 空值表示保持现有密钥；显式清除标记则删除；否则采用新输入值。
fn resolve_secret_key(
    incoming: &str,
    clear: bool,
    existing: Option<&str>,
) -> String {
    if clear {
        String::new()
    } else if incoming.is_empty() {
        existing.unwrap_or_default().to_string()
    } else {
        incoming.to_string()
    }
}

#[tauri::command]
pub fn load_ai_settings(store: State<'_, MailStore>) -> Result<AiSettingsReport, String> {
    store
        .load_ai_settings()
        .map(AiSettingsReport::from)
        .map_err(|error| error.to_string())
}

/// 从本地存储读取 API key（前端不回传已保存密钥时使用）。
fn stored_api_key(store: &MailStore, fallback: &str) -> String {
    let stored = store
        .load_ai_settings()
        .map(|record| record.api_key)
        .unwrap_or_default();
    if stored.trim().is_empty() {
        fallback.trim().to_string()
    } else {
        stored
    }
}

fn stored_mcp_api_key(store: &MailStore, fallback: &str) -> String {
    let stored = store
        .load_ai_settings()
        .map(|record| record.mcp_api_key)
        .unwrap_or_default();
    if stored.trim().is_empty() {
        fallback.trim().to_string()
    } else {
        stored
    }
}
#[cfg(test)]
mod tests {
    use super::resolve_secret_key;
    use crate::db::ai_settings::AiSettingsRecord;

    #[test]
    fn settings_report_never_contains_secret_fields() {
        let record = AiSettingsRecord {
            enabled: true,
            service_type: "http".to_string(),
            endpoint: "https://api.example.com/v1".to_string(),
            api_key: "sk-secret-value".to_string(),
            model: "gpt-4o-mini".to_string(),
            timeout_seconds: 30,
            privacy_acknowledged: true,
            mcp_enabled: true,
            mcp_endpoint: "https://mcp.example.com".to_string(),
            mcp_api_key: "mcp-secret-value".to_string(),
        };
        let report = super::AiSettingsReport::from(record);
        let serialized = serde_json::to_string(&report).expect("report serializes");
        assert!(
            !serialized.contains("sk-secret-value"),
            "load/status 返回不得包含 api_key：{serialized}"
        );
        assert!(
            !serialized.contains("mcp-secret-value"),
            "load/status 返回不得包含 mcp_api_key：{serialized}"
        );
        assert!(
            !serialized.contains("\"api_key\"") && !serialized.contains("\"mcp_api_key\""),
            "load/status 返回不得包含 api_key/mcp_api_key 字段：{serialized}"
        );
        assert!(report.has_api_key);
        assert!(report.has_mcp_api_key);
    }

    #[test]
    fn empty_api_key_preserves_existing_while_clear_flag_deletes() {
        assert_eq!(
            resolve_secret_key("", false, Some("existing-key")),
            "existing-key",
            "空值应保持现有密钥"
        );
        assert_eq!(
            resolve_secret_key("", true, Some("existing-key")),
            "",
            "显式清除应删除密钥"
        );
        assert_eq!(
            resolve_secret_key("new-key", false, Some("existing-key")),
            "new-key",
            "新输入应覆盖旧密钥"
        );
        assert_eq!(
            resolve_secret_key("", false, None),
            "",
            "无既有密钥且未输入时保持空"
        );
    }
}
