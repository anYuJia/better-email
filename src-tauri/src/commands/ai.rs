use crate::ai::{
    run_ai_request, run_mcp_tool_call, test_ai_connection as test_connection_inner, AiChatOutcome,
    AiChatRequest, AiConnectionReport, AiRequestInput, AiRequestResult,
};

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
