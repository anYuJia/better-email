use super::common::validate_external_url;
use crate::credentials;
use crate::db::{MailResult, MailStore};
use crate::models::{
    OAuthCallbackInput, OAuthCallbackReport, OAuthLocalCallbackInput, OAuthRefreshInput,
    OAuthRefreshReport, OAuthSession, OAuthStartInput, OAuthStartReport, OAuthTokenExchangeInput,
    OAuthTokenExchangeReport,
};
use crate::oauth;
use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;
#[tauri::command]
#[allow(deprecated)]
pub fn start_oauth2_pkce(
    app: AppHandle,
    store: State<'_, MailStore>,
    input: OAuthStartInput,
) -> MailResult<OAuthStartReport> {
    let draft = oauth::start_pkce_authorization(input).map_err(crate::db::MailError::Imap)?;
    let report = store.save_oauth_session(draft.report, &draft.code_verifier)?;
    app.shell()
        .open(report.authorization_url.clone(), None)
        .map_err(|error| crate::db::MailError::Imap(format!("无法打开 OAuth2 授权页：{error}")))?;
    Ok(report)
}

#[tauri::command]
pub fn list_oauth_sessions(store: State<'_, MailStore>) -> MailResult<Vec<OAuthSession>> {
    store.list_oauth_sessions()
}

#[tauri::command]
pub fn complete_oauth2_callback(
    store: State<'_, MailStore>,
    input: OAuthCallbackInput,
) -> MailResult<OAuthCallbackReport> {
    store.complete_oauth_callback(&input.state, &input.code)
}

#[tauri::command]
pub async fn wait_for_oauth2_callback(
    store: State<'_, MailStore>,
    input: OAuthLocalCallbackInput,
) -> MailResult<OAuthCallbackReport> {
    // 只接受匹配当前待处理会话 state 的回调：随机探测、错误 state 不会终止监听。
    let sessions = store.list_oauth_sessions()?;
    let expected_states = sessions
        .into_iter()
        .filter(|session| session.status == "pending")
        .map(|session| session.state)
        .collect::<Vec<_>>();
    let payload =
        oauth::wait_for_local_callback(&input.redirect_uri, &expected_states, input.timeout_seconds)
            .map_err(crate::db::MailError::Imap)?;
    store.complete_oauth_callback(&payload.state, &payload.code)
}

#[tauri::command]
pub async fn exchange_oauth2_token(
    store: State<'_, MailStore>,
    input: OAuthTokenExchangeInput,
) -> MailResult<OAuthTokenExchangeReport> {
    let session = store.oauth_session_for_token_exchange(input.session_id)?;
    match oauth::exchange_token(&session, &input.client_id, &input.client_secret) {
        Ok(bundle) => {
            let expires_at = bundle.expires_at.clone();
            let secret = serde_json::to_string(&bundle).map_err(|error| {
                crate::db::MailError::Imap(format!("OAuth2 token 序列化失败：{error}"))
            })?;
            let status = store.store_account_secret(&session.account_email, &secret)?;
            if !status.exists {
                let report = store.mark_oauth_token_exchange_failed(session.id, &status.message)?;
                return Err(crate::db::MailError::Imap(report.message));
            }
            store.mark_oauth_token_stored(session.id, &expires_at)
        }
        Err(error) => {
            let report = store.mark_oauth_token_exchange_failed(session.id, &error)?;
            Err(crate::db::MailError::Imap(report.message))
        }
    }
}

#[tauri::command]
pub async fn refresh_oauth2_token(
    store: State<'_, MailStore>,
    input: OAuthRefreshInput,
) -> MailResult<OAuthRefreshReport> {
    let account = store.get_account()?;
    let raw = store.get_account_secret_raw(&account)?;
    let secret = credentials::account_secret_from_raw(&account.auth_type, &raw)
        .map_err(crate::db::MailError::Imap)?;
    let bundle = match secret {
        credentials::AccountSecret::OAuth2(bundle) => bundle,
        credentials::AccountSecret::Password(_) => {
            return Err(crate::db::MailError::Imap(
                "当前账号不是 OAuth2 模式，无法刷新 token。".to_string(),
            ));
        }
    };
    let refreshed = oauth::refresh_token(&bundle, &input.client_id, &input.client_secret)
        .map_err(crate::db::MailError::Imap)?;
    let secret = serde_json::to_string(&refreshed)
        .map_err(|error| crate::db::MailError::Imap(format!("OAuth2 token 序列化失败：{error}")))?;
    let status = store.store_account_secret(&account.email, &secret)?;
    if !status.exists {
        return Err(crate::db::MailError::Imap(status.message));
    }
    Ok(OAuthRefreshReport {
        provider: refreshed.provider,
        status: "token_refreshed".to_string(),
        expires_at: refreshed.expires_at,
        message: "OAuth2 token 已刷新并保存到本地 SQLite 凭据。".to_string(),
    })
}

#[tauri::command]
#[allow(deprecated)]
pub fn open_url(app: AppHandle, url: String) -> MailResult<()> {
    let parsed = validate_external_url(&url)?;
    app.shell()
        .open(parsed.as_str().to_string(), None)
        .map_err(|error| crate::db::MailError::Imap(format!("无法打开 URL: {error}")))?;
    Ok(())
}
