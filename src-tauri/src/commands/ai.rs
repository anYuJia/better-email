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
    // 聊天补全只允许 HTTP 型服务，且 endpoint 必须与已保存配置一致，
    // 保存的密钥绝不会被发送到调用方构造的任意端点。
    let (endpoint, api_key) =
        enforce_saved_http_request(&store, "http", &input.endpoint, &input.api_key)?;
    crate::ai::call_chat_completion(
        &endpoint,
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
    let (endpoint, api_key) = match input.service_type.as_str() {
        "mcp" => enforce_saved_http_request(&store, "mcp", &input.endpoint, &input.api_key)?,
        _ => enforce_saved_http_request(&store, "http", &input.endpoint, &input.api_key)?,
    };
    input.endpoint = endpoint;
    input.api_key = api_key;
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
    // 「测试连接」测试的是用户本次输入的新配置：只使用本次传入的 key。
    // 仅当 endpoint 与已保存配置完全一致时，才允许复用已保存 key（目标不变）。
    let service_kind = if service_type.as_str() == "mcp" {
        "mcp"
    } else {
        "http"
    };
    let api_key = test_connection_key(&store, service_kind, &endpoint, &api_key)?;
    test_connection_inner(&service_type, &endpoint, &api_key, &model, timeout_seconds)
}

#[tauri::command]
pub fn save_ai_settings(
    store: State<'_, MailStore>,
    input: AiSettingsSaveInput,
) -> Result<String, String> {
    // 密钥必须绑定到 (service_type, endpoint)：API key 不能跟随 endpoint 或服务
    // 类型变化而被静默沿用，否则旧 key 可能被发到新的端点。
    let existing = store.load_ai_settings().ok();
    let (api_key, mcp_api_key) = resolve_ai_secrets_for_save(existing.as_ref(), &input)?;
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

/// 端点规范化：去首尾空白、去掉末尾斜杠。用于判断端点是否变化、是否与已保存
/// 端点匹配（末尾斜杠差异视为同一目标，不构成密钥泄露）。
fn normalized_endpoint(endpoint: &str) -> String {
    endpoint.trim().trim_end_matches('/').to_string()
}

/// 解析保存时的密钥（返回 (api_key, mcp_api_key)），密钥绑定到 (service_type, endpoint)：
/// - service_type 变化：不得跨服务类型复用旧 key；
/// - 同类型但端点变化：空 key 不得静默沿用旧 key，拒绝保存并要求重新输入；
/// - 类型与端点均未变：空值表示保持现有密钥；显式清除标记则删除。
fn resolve_ai_secrets_for_save(
    existing: Option<&AiSettingsRecord>,
    input: &AiSettingsSaveInput,
) -> Result<(String, String), String> {
    let service_type_changed =
        existing.is_some_and(|record| record.service_type != input.service_type);
    let http_endpoint_changed = existing.is_some_and(|record| {
        normalized_endpoint(&record.endpoint) != normalized_endpoint(&input.endpoint)
    });
    let mcp_endpoint_changed = existing.is_some_and(|record| {
        normalized_endpoint(&record.mcp_endpoint) != normalized_endpoint(&input.mcp_endpoint)
    });
    let api_key = resolve_bound_secret_key(
        input.api_key.trim(),
        input.clear_api_key,
        existing.map(|record| record.api_key.as_str()),
        service_type_changed,
        http_endpoint_changed,
    )?;
    let mcp_api_key = resolve_bound_secret_key(
        input.mcp_api_key.trim(),
        input.clear_mcp_api_key,
        existing.map(|record| record.mcp_api_key.as_str()),
        service_type_changed,
        mcp_endpoint_changed,
    )?;
    Ok((api_key, mcp_api_key))
}

/// 单条密钥的绑定解析：
/// - 显式清除标记：删除；
/// - service_type 变化：不得跨服务类型复用旧 key，采用新输入值（为空则清空）；
/// - 同类型但端点变化：空 key 拒绝保存并要求重新输入；
/// - 类型与端点均未变：空值表示保持现有密钥。
fn resolve_bound_secret_key(
    incoming: &str,
    clear: bool,
    existing: Option<&str>,
    service_type_changed: bool,
    endpoint_changed: bool,
) -> Result<String, String> {
    if clear {
        return Ok(String::new());
    }
    if service_type_changed {
        return Ok(incoming.to_string());
    }
    if incoming.is_empty() {
        if endpoint_changed {
            return Err("服务端点已更改，请重新输入 API Key 后再保存。".to_string());
        }
        return Ok(existing.unwrap_or_default().to_string());
    }
    Ok(incoming.to_string())
}

#[tauri::command]
pub fn load_ai_settings(store: State<'_, MailStore>) -> Result<AiSettingsReport, String> {
    store
        .load_ai_settings()
        .map(AiSettingsReport::from)
        .map_err(|error| error.to_string())
}

/// 后端安全边界：校验一次外部 AI/MCP 请求是否可以使用保存的密钥。
///
/// 只有同时满足以下条件才允许携带保存的密钥发出请求：
/// - AI 已启用；
/// - 外部服务隐私已确认；
/// - service_type 与保存配置匹配；
/// - endpoint 与保存配置（http 用 endpoint，mcp 用 mcp_endpoint）完全一致；
/// - MCP 请求还要求 mcp_enabled。
///
/// 调用方传入的非空 key 允许使用（用户更新了密钥），但 endpoint 仍必须与保存
/// 配置一致，因此保存的密钥绝不会被发送到调用方构造的任意 HTTPS/loopback 端点。
fn enforce_saved_http_request(
    store: &MailStore,
    service_type: &str,
    endpoint: &str,
    api_key: &str,
) -> Result<(String, String), String> {
    let saved = store
        .load_ai_settings()
        .map_err(|error| format!("读取 AI 设置失败：{error}"))?;
    if !saved.enabled {
        return Err("AI 服务已关闭，请先在设置中开启。".to_string());
    }
    if saved.service_type != service_type {
        return Err(format!(
            "AI 服务类型与已保存配置不一致（当前 {service_type}，已保存为 {}），已拒绝请求。",
            saved.service_type
        ));
    }
    if !saved.privacy_acknowledged {
        return Err(
            "首次发送邮件内容到外部 AI 服务前，请先在设置 > AI 服务中确认隐私说明。".to_string(),
        );
    }
    if service_type == "mcp" {
        if !saved.mcp_enabled {
            return Err("MCP 服务未开启，请先在设置中启用 MCP 服务。".to_string());
        }
        if normalized_endpoint(endpoint) != normalized_endpoint(&saved.mcp_endpoint) {
            return Err("MCP 服务地址与已保存配置不一致，已拒绝发送密钥。".to_string());
        }
        let key = if api_key.trim().is_empty() {
            saved.mcp_api_key
        } else {
            api_key.trim().to_string()
        };
        return Ok((saved.mcp_endpoint, key));
    }
    if normalized_endpoint(endpoint) != normalized_endpoint(&saved.endpoint) {
        return Err("AI 服务地址与已保存配置不一致，已拒绝发送密钥。".to_string());
    }
    let key = if api_key.trim().is_empty() {
        saved.api_key
    } else {
        api_key.trim().to_string()
    };
    Ok((saved.endpoint, key))
}

/// 「测试连接」的密钥解析：只使用本次传入的 key。
///
/// 仅当测试的 endpoint 与已保存配置（service_type + endpoint）完全一致（规范化
/// 后）时，才允许复用已保存的 key（目标与保存时完全相同）；测试任何未保存的
/// 新端点都必须显式传入本次要测试的 key，绝不回退到已保存 key。
fn test_connection_key(
    store: &MailStore,
    service_type: &str,
    endpoint: &str,
    api_key: &str,
) -> Result<String, String> {
    if !api_key.trim().is_empty() {
        return Ok(api_key.trim().to_string());
    }
    let saved = store.load_ai_settings().ok();
    let matches_saved = saved.as_ref().is_some_and(|record| {
        record.service_type == service_type
            && normalized_endpoint(endpoint)
                == if service_type == "mcp" {
                    normalized_endpoint(&record.mcp_endpoint)
                } else {
                    normalized_endpoint(&record.endpoint)
                }
    });
    if !matches_saved {
        return Err(
            "测试连接不能复用已保存密钥到新端点，请先输入本次要测试的 API Key。".to_string(),
        );
    }
    let key = saved
        .map(|record| {
            if service_type == "mcp" {
                record.mcp_api_key
            } else {
                record.api_key
            }
        })
        .unwrap_or_default();
    Ok(key)
}
#[cfg(test)]
mod tests {
    use super::{
        enforce_saved_http_request, resolve_ai_secrets_for_save, resolve_bound_secret_key,
        test_connection_key,
    };
    use crate::db::ai_settings::AiSettingsRecord;
    use crate::db::MailStore;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_AI_DATABASE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_database_path() -> std::path::PathBuf {
        let unique = TEST_AI_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "better-email-ai-settings-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("test data dir created");
        dir.join("better-email.sqlite3")
    }

    fn stored_http_record() -> AiSettingsRecord {
        AiSettingsRecord {
            enabled: true,
            service_type: "http".to_string(),
            endpoint: "https://api.example.com/v1".to_string(),
            api_key: "sk-saved-secret".to_string(),
            model: "gpt-4o-mini".to_string(),
            timeout_seconds: 30,
            privacy_acknowledged: true,
            mcp_enabled: false,
            mcp_endpoint: "https://mcp.example.com".to_string(),
            mcp_api_key: "mcp-saved-secret".to_string(),
        }
    }

    fn store_with(record: AiSettingsRecord) -> MailStore {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        store.save_ai_settings(&record).expect("settings saved");
        store
    }

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
    fn empty_key_preserves_existing_only_when_binding_is_unchanged() {
        // 类型与端点均未变：空 key 保持现有；显式清除删除；新输入覆盖。
        assert_eq!(
            resolve_bound_secret_key("", false, Some("existing-key"), false, false).expect("keep"),
            "existing-key",
            "绑定未变时空值应保持现有密钥"
        );
        assert_eq!(
            resolve_bound_secret_key("", true, Some("existing-key"), false, false).expect("clear"),
            "",
            "显式清除应删除密钥"
        );
        assert_eq!(
            resolve_bound_secret_key("new-key", false, Some("existing-key"), false, false)
                .expect("replace"),
            "new-key",
            "新输入应覆盖旧密钥"
        );
        assert_eq!(
            resolve_bound_secret_key("", false, None, false, false).expect("none"),
            "",
            "无既有密钥且未输入时保持空"
        );

        // 端点变化：空 key 不得静默沿用旧 key。
        let err = resolve_bound_secret_key("", false, Some("existing-key"), false, true)
            .expect_err("endpoint changed rejects empty key");
        assert!(err.contains("重新输入"), "端点变化应要求重新输入：{err}");

        // 类型变化：不得跨服务类型复用旧 key（清空）。
        assert_eq!(
            resolve_bound_secret_key("", false, Some("existing-key"), true, false)
                .expect("type change"),
            "",
            "类型变化不得跨服务类型复用旧 key"
        );
    }

    fn save_input(record: &AiSettingsRecord) -> super::AiSettingsSaveInput {
        super::AiSettingsSaveInput {
            enabled: record.enabled,
            service_type: record.service_type.clone(),
            endpoint: record.endpoint.clone(),
            api_key: String::new(),
            model: record.model.clone(),
            timeout_seconds: record.timeout_seconds,
            privacy_acknowledged: record.privacy_acknowledged,
            mcp_enabled: record.mcp_enabled,
            mcp_endpoint: record.mcp_endpoint.clone(),
            mcp_api_key: String::new(),
            clear_api_key: false,
            clear_mcp_api_key: false,
        }
    }

    #[test]
    fn saving_with_changed_endpoint_requires_reentering_http_key() {
        let existing = stored_http_record();
        // 已保存旧 endpoint + key；保存新 endpoint 且 key 为空：必须拒绝，不得沿用旧 key。
        let mut input = save_input(&existing);
        input.endpoint = "https://attacker.example.com/v1".to_string();
        let err = resolve_ai_secrets_for_save(Some(&existing), &input)
            .expect_err("changed http endpoint with empty key rejected");
        assert!(
            err.contains("重新输入"),
            "HTTP 端点变化应要求重新输入：{err}"
        );
    }

    #[test]
    fn saving_with_changed_mcp_endpoint_requires_reentering_mcp_key() {
        let existing = stored_http_record();
        let mut input = save_input(&existing);
        input.mcp_endpoint = "https://mcp.example.com/new".to_string();
        input.mcp_api_key = String::new();
        let err = resolve_ai_secrets_for_save(Some(&existing), &input)
            .expect_err("changed mcp endpoint with empty key rejected");
        assert!(
            err.contains("重新输入"),
            "MCP 端点变化应要求重新输入：{err}"
        );
    }

    #[test]
    fn saving_with_service_type_change_clears_keys_not_reuses() {
        let existing = stored_http_record();
        // 修改 service_type：不得跨服务类型复用旧 http key（清空），也不沿用旧 mcp key。
        let mut input = save_input(&existing);
        input.service_type = "mcp".to_string();
        input.mcp_enabled = true;
        let (api_key, mcp_api_key) =
            resolve_ai_secrets_for_save(Some(&existing), &input).expect("save proceeds");
        assert_eq!(api_key, "", "类型变化后旧 http key 不得保留");
        assert_eq!(mcp_api_key, "", "类型变化后旧 mcp key 不得保留");
    }

    #[test]
    fn saving_unchanged_binding_preserves_both_keys() {
        let existing = stored_http_record();
        // 类型与端点均未变：空 key 保持现有 http/mcp key。
        let input = save_input(&existing);
        let (api_key, mcp_api_key) =
            resolve_ai_secrets_for_save(Some(&existing), &input).expect("save proceeds");
        assert_eq!(api_key, "sk-saved-secret", "同绑定下 http key 保持");
        assert_eq!(mcp_api_key, "mcp-saved-secret", "同绑定下 mcp key 保持");
    }

    #[test]
    fn saving_explicit_new_key_overrides_on_endpoint_change() {
        let existing = stored_http_record();
        let mut input = save_input(&existing);
        input.endpoint = "https://api.example.com/v2".to_string();
        input.api_key = "sk-new".to_string();
        let (api_key, _) = resolve_ai_secrets_for_save(Some(&existing), &input).expect("save");
        assert_eq!(api_key, "sk-new", "端点变化时显式输入的新 key 生效");
    }

    #[test]
    fn trailing_slash_endpoint_is_considered_same_target_for_key_preservation() {
        let existing = stored_http_record();
        let mut input = save_input(&existing);
        input.endpoint = "https://api.example.com/v1/".to_string();
        let (api_key, _) = resolve_ai_secrets_for_save(Some(&existing), &input).expect("save");
        assert_eq!(
            api_key, "sk-saved-secret",
            "末尾斜杠差异视为同一目标，key 可保留"
        );
    }

    #[test]
    fn external_request_rejects_when_ai_disabled() {
        let store = store_with(AiSettingsRecord {
            enabled: false,
            ..stored_http_record()
        });
        let err = enforce_saved_http_request(&store, "http", "https://api.example.com/v1", "")
            .unwrap_err();
        assert!(err.contains("已关闭"), "关闭时应拒绝：{err}");
    }

    #[test]
    fn external_request_rejects_without_privacy_acknowledgement() {
        let store = store_with(AiSettingsRecord {
            privacy_acknowledged: false,
            ..stored_http_record()
        });
        let err = enforce_saved_http_request(&store, "http", "https://api.example.com/v1", "")
            .unwrap_err();
        assert!(err.contains("隐私"), "未确认隐私时应拒绝：{err}");
    }

    #[test]
    fn external_request_rejects_endpoint_mismatch() {
        let store = store_with(stored_http_record());
        // 调用方构造任意端点：即使与已保存配置同为 HTTPS 也必须拒绝，防止密钥泄露。
        let err = enforce_saved_http_request(&store, "http", "https://attacker.example.com/v1", "")
            .unwrap_err();
        assert!(err.contains("不一致"), "endpoint 不匹配应拒绝：{err}");

        let err =
            enforce_saved_http_request(&store, "http", "https://127.0.0.1:9999/v1", "sk-passed-in")
                .unwrap_err();
        assert!(err.contains("不一致"), "loopback 端点不匹配也应拒绝：{err}");
    }

    #[test]
    fn external_request_rejects_service_type_mismatch() {
        let store = store_with(stored_http_record());
        let err =
            enforce_saved_http_request(&store, "mcp", "https://mcp.example.com", "").unwrap_err();
        assert!(err.contains("服务类型"), "service_type 不匹配应拒绝：{err}");
    }

    #[test]
    fn mcp_request_requires_mcp_enabled_and_matching_endpoint() {
        // MCP 未开启：即使 endpoint 匹配也拒绝。
        let store = store_with(AiSettingsRecord {
            service_type: "mcp".to_string(),
            mcp_enabled: false,
            ..stored_http_record()
        });
        let err =
            enforce_saved_http_request(&store, "mcp", "https://mcp.example.com", "").unwrap_err();
        assert!(err.contains("MCP 服务未开启"), "MCP 未开启应拒绝：{err}");

        // MCP 已开启 + endpoint 匹配：允许使用保存的 MCP key。
        let store = store_with(AiSettingsRecord {
            service_type: "mcp".to_string(),
            mcp_enabled: true,
            ..stored_http_record()
        });
        let (endpoint, key) =
            enforce_saved_http_request(&store, "mcp", "https://mcp.example.com", "")
                .expect("enabled mcp with matching endpoint allowed");
        assert_eq!(endpoint, "https://mcp.example.com");
        assert_eq!(key, "mcp-saved-secret");

        // MCP 已开启但 endpoint 不匹配：拒绝。
        let err = enforce_saved_http_request(&store, "mcp", "https://mcp.example.com/other", "")
            .unwrap_err();
        assert!(err.contains("不一致"), "MCP endpoint 不匹配应拒绝：{err}");
    }

    #[test]
    fn matching_endpoint_allows_saved_key_while_passed_key_wins() {
        let store = store_with(stored_http_record());
        let (endpoint, key) =
            enforce_saved_http_request(&store, "http", "https://api.example.com/v1", "")
                .expect("matching endpoint allowed");
        assert_eq!(endpoint, "https://api.example.com/v1");
        assert_eq!(key, "sk-saved-secret");

        // 调用方传入新 key（同端点）：以传入为准。
        let (_, key) =
            enforce_saved_http_request(&store, "http", "https://api.example.com/v1", "sk-incoming")
                .expect("incoming key used");
        assert_eq!(key, "sk-incoming");
    }

    #[test]
    fn test_connection_never_reuses_saved_key_for_new_endpoint() {
        let store = store_with(stored_http_record());
        // 新端点（即使同为 HTTPS）：空 key 必须拒绝，不能回退到保存密钥。
        let err =
            test_connection_key(&store, "http", "https://attacker.example.com/v1", "").unwrap_err();
        assert!(err.contains("不能复用"), "新端点测试应要求显式 key：{err}");

        // 新端点 + 显式传入 key：允许使用传入 key。
        let key = test_connection_key(&store, "http", "https://attacker.example.com/v1", "sk-temp")
            .expect("passed key used for new endpoint");
        assert_eq!(key, "sk-temp");
    }

    #[test]
    fn test_connection_reuses_saved_key_only_for_identical_endpoint() {
        let store = store_with(stored_http_record());
        let key = test_connection_key(&store, "http", "https://api.example.com/v1", "")
            .expect("saved key reused for identical endpoint");
        assert_eq!(key, "sk-saved-secret");

        // 完全相同但为 MCP 服务：复用 MCP key。
        let store = store_with(AiSettingsRecord {
            service_type: "mcp".to_string(),
            mcp_enabled: true,
            ..stored_http_record()
        });
        let key = test_connection_key(&store, "mcp", "https://mcp.example.com", "")
            .expect("saved mcp key reused for identical endpoint");
        assert_eq!(key, "mcp-saved-secret");

        // 未保存任何配置时，任何端点都必须显式传入 key。
        let empty = MailStore::open_at(unique_test_database_path()).expect("store opens");
        let err =
            test_connection_key(&empty, "http", "https://api.example.com/v1", "").unwrap_err();
        assert!(err.contains("不能复用"), "无保存配置时应要求 key：{err}");
    }
}
