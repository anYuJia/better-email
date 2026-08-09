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
}

#[derive(Debug, Clone, Serialize)]
pub struct AiSettingsReport {
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
}

impl From<AiSettingsRecord> for AiSettingsReport {
    fn from(record: AiSettingsRecord) -> Self {
        AiSettingsReport {
            enabled: record.enabled,
            service_type: record.service_type,
            endpoint: record.endpoint,
            api_key: record.api_key,
            model: record.model,
            timeout_seconds: record.timeout_seconds,
            privacy_acknowledged: record.privacy_acknowledged,
            mcp_enabled: record.mcp_enabled,
            mcp_endpoint: record.mcp_endpoint,
            mcp_api_key: record.mcp_api_key,
        }
    }
}

#[tauri::command]
pub async fn ai_chat_request(input: AiChatRequest) -> Result<AiChatOutcome, String> {
    crate::ai::call_chat_completion(
        &input.endpoint,
        &input.api_key,
        &input.model,
        &input.messages,
        input.timeout_seconds,
    )
}

#[tauri::command]
pub async fn ai_request(input: AiRequestInput) -> Result<AiRequestResult, String> {
    match input.service_type.as_str() {
        "mcp" => run_mcp_tool_call(&input),
        _ => run_ai_request(&input),
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    service_type: String,
    endpoint: String,
    api_key: String,
    model: String,
    timeout_seconds: u64,
) -> Result<AiConnectionReport, String> {
    test_connection_inner(&service_type, &endpoint, &api_key, &model, timeout_seconds)
}

#[tauri::command]
pub fn save_ai_settings(
    store: State<'_, MailStore>,
    input: AiSettingsSaveInput,
) -> Result<String, String> {
    let record = AiSettingsRecord {
        enabled: input.enabled,
        service_type: input.service_type,
        endpoint: input.endpoint,
        api_key: input.api_key,
        model: input.model,
        timeout_seconds: input.timeout_seconds,
        privacy_acknowledged: input.privacy_acknowledged,
        mcp_enabled: input.mcp_enabled,
        mcp_endpoint: input.mcp_endpoint,
        mcp_api_key: input.mcp_api_key,
    };
    // AI 密钥只写入应用自己的本地数据库，不触碰系统凭据库，
    // 保证打开设置页时不会触发任何 Keychain 访问或授权提示。
    store
        .save_ai_settings(&record)
        .map_err(|error| error.to_string())?;
    Ok("AI 服务设置已保存。".to_string())
}

#[tauri::command]
pub fn load_ai_settings(store: State<'_, MailStore>) -> Result<AiSettingsReport, String> {
    store
        .load_ai_settings()
        .map(AiSettingsReport::from)
        .map_err(|error| error.to_string())
}
