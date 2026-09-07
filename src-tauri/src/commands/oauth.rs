use super::common::validate_external_url;
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
    account_id: Option<i64>,
) -> MailResult<OAuthStartReport> {
    let account = store.get_account_by_id(account_id)?;
    if account.email != input.login_hint.trim().to_lowercase() {
        return Err(crate::db::MailError::Imap(
            "OAuth2 登录提示与所选账号不匹配。".into(),
        ));
    }
    let draft = oauth::start_pkce_authorization(input).map_err(crate::db::MailError::Imap)?;
    let report = store.save_oauth_session_for_account(
        draft.report,
        &draft.code_verifier,
        Some(account.id),
    )?;
    app.shell()
        .open(report.authorization_url.clone(), None)
        .map_err(|error| crate::db::MailError::Imap(format!("无法打开 OAuth2 授权页：{error}")))?;
    Ok(report)
}

#[tauri::command]
pub fn list_oauth_sessions(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<OAuthSession>> {
    store.list_oauth_sessions_for_account(account_id)
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
    account_id: Option<i64>,
) -> MailResult<OAuthCallbackReport> {
    // 只接受匹配当前待处理会话 state 的回调：随机探测、错误 state 不会终止监听。
    let sessions = store.list_oauth_sessions_for_account(account_id)?;
    let expected_states = sessions
        .into_iter()
        .filter(|session| session.status == "pending")
        .map(|session| session.state)
        .collect::<Vec<_>>();
    let payload = oauth::wait_for_local_callback(
        &input.redirect_uri,
        &expected_states,
        input.timeout_seconds,
    )
    .map_err(crate::db::MailError::Imap)?;
    store.complete_oauth_callback(&payload.state, &payload.code)
}

#[tauri::command]
pub async fn exchange_oauth2_token(
    store: State<'_, MailStore>,
    input: OAuthTokenExchangeInput,
    account_id: Option<i64>,
) -> MailResult<OAuthTokenExchangeReport> {
    let session = store.oauth_session_for_token_exchange(input.session_id)?;
    let account = store.oauth_account_for_session(session.id)?;
    if account_id.is_some_and(|id| id != account.id) {
        return Err(crate::db::MailError::Imap(
            "OAuth2 会话不属于所选账号。".into(),
        ));
    }
    let previous = store.credential_snapshot_optional(&account)?;
    match oauth::exchange_token(&session, &input.client_id, &input.client_secret) {
        Ok(bundle) => {
            let expires_at = bundle.expires_at.clone();
            let secret = serde_json::to_string(&bundle).map_err(|error| {
                crate::db::MailError::Imap(format!("OAuth2 token 序列化失败：{error}"))
            })?;
            store.store_oauth_exchange_result(
                &account,
                &session,
                previous.as_deref(),
                &secret,
                &expires_at,
            )
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
    account_id: Option<i64>,
) -> MailResult<OAuthRefreshReport> {
    let account = store.get_account_by_id(account_id)?;
    let refreshed =
        store.refresh_account_oauth_secret(&account, &input.client_id, &input.client_secret)?;
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
