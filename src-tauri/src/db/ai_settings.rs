use super::*;

const AI_KEYCHAIN_KIND_HTTP: &str = "ai:http";
const AI_KEYCHAIN_KIND_MCP: &str = "ai:mcp";

impl MailStore {
    pub fn save_ai_settings(&self, record: &AiSettingsRecord) -> MailResult<()> {
        self.with_conn(|conn| store_ai_settings_for_conn(conn, record))
    }

    pub fn load_ai_settings(&self) -> MailResult<AiSettingsRecord> {
        self.with_conn(load_ai_settings_for_conn)
    }
}

#[derive(Debug, Clone)]
pub struct AiSettingsRecord {
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

pub fn store_ai_settings_for_conn(conn: &Connection, record: &AiSettingsRecord) -> MailResult<()> {
    let keychain_ok =
        crate::credentials::keychain_set_secret(AI_KEYCHAIN_KIND_HTTP, &record.api_key).is_ok();
    let mcp_keychain_ok =
        crate::credentials::keychain_set_secret(AI_KEYCHAIN_KIND_MCP, &record.mcp_api_key).is_ok();
    conn.execute(
        "
        INSERT INTO ai_settings(id, enabled, service_type, endpoint, api_key, model,
                                timeout_seconds, privacy_acknowledged,
                                mcp_enabled, mcp_endpoint, mcp_api_key, updated_at)
        VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            service_type = excluded.service_type,
            endpoint = excluded.endpoint,
            api_key = excluded.api_key,
            model = excluded.model,
            timeout_seconds = excluded.timeout_seconds,
            privacy_acknowledged = excluded.privacy_acknowledged,
            mcp_enabled = excluded.mcp_enabled,
            mcp_endpoint = excluded.mcp_endpoint,
            mcp_api_key = excluded.mcp_api_key,
            updated_at = excluded.updated_at
        ",
        params![
            record.enabled,
            record.service_type,
            record.endpoint,
            if keychain_ok {
                ""
            } else {
                record.api_key.as_str()
            },
            record.model,
            record.timeout_seconds as i64,
            record.privacy_acknowledged,
            record.mcp_enabled,
            record.mcp_endpoint,
            if mcp_keychain_ok {
                ""
            } else {
                record.mcp_api_key.as_str()
            },
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

pub fn load_ai_settings_for_conn(conn: &Connection) -> MailResult<AiSettingsRecord> {
    let row = conn
        .query_row(
            "SELECT enabled, service_type, endpoint, api_key, model, timeout_seconds,
                    privacy_acknowledged, mcp_enabled, mcp_endpoint, mcp_api_key
             FROM ai_settings WHERE id = 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;
    let Some((
        enabled,
        service_type,
        endpoint,
        api_key,
        model,
        timeout_seconds,
        privacy_acknowledged,
        mcp_enabled,
        mcp_endpoint,
        mcp_api_key,
    )) = row
    else {
        return Ok(AiSettingsRecord {
            enabled: false,
            service_type: "mock".to_string(),
            endpoint: String::new(),
            api_key: String::new(),
            model: String::new(),
            timeout_seconds: 30,
            privacy_acknowledged: false,
            mcp_enabled: false,
            mcp_endpoint: String::new(),
            mcp_api_key: String::new(),
        });
    };
    Ok(AiSettingsRecord {
        enabled: enabled != 0,
        service_type,
        endpoint,
        api_key: load_ai_secret(AI_KEYCHAIN_KIND_HTTP, &api_key),
        model,
        timeout_seconds: timeout_seconds as u64,
        privacy_acknowledged: privacy_acknowledged != 0,
        mcp_enabled: mcp_enabled != 0,
        mcp_endpoint,
        mcp_api_key: load_ai_secret(AI_KEYCHAIN_KIND_MCP, &mcp_api_key),
    })
}

fn load_ai_secret(kind: &str, fallback: &str) -> String {
    match crate::credentials::keychain_get_secret(kind) {
        Ok(Some(secret)) if !secret.trim().is_empty() => secret,
        _ => fallback.to_string(),
    }
}
