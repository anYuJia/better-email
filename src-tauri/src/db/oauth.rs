use super::accounts::account_for_conn;
use super::*;

impl MailStore {
    pub fn save_oauth_session(
        &self,
        mut report: OAuthStartReport,
        code_verifier: &str,
    ) -> MailResult<OAuthStartReport> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, None)?;
            let created_at = Utc::now().to_rfc3339();
            conn.execute(
                "
                INSERT INTO oauth_sessions(
                    account_id, provider, authorization_url, redirect_uri, state,
                    code_challenge, code_verifier, scopes, status, created_at, message
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', ?9, ?10)
                ",
                params![
                    account.id,
                    &report.provider,
                    &report.authorization_url,
                    &report.redirect_uri,
                    &report.state,
                    &report.code_challenge,
                    code_verifier,
                    report.scopes.join("\n"),
                    created_at,
                    &report.message
                ],
            )?;
            report.session_id = conn.last_insert_rowid();
            Ok(report)
        })
    }
    pub fn list_oauth_sessions(&self) -> MailResult<Vec<OAuthSession>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT id, provider, authorization_url, redirect_uri, state, code_challenge,
                       scopes, status, created_at, completed_at, message
                FROM oauth_sessions
                ORDER BY created_at DESC
                LIMIT 10
                ",
            )?;
            let sessions = stmt
                .query_map([], |row| {
                    let scopes: String = row.get(6)?;
                    Ok(OAuthSession {
                        id: row.get(0)?,
                        provider: row.get(1)?,
                        authorization_url: row.get(2)?,
                        redirect_uri: row.get(3)?,
                        state: row.get(4)?,
                        code_challenge: row.get(5)?,
                        scopes: scopes
                            .lines()
                            .map(str::trim)
                            .filter(|scope| !scope.is_empty())
                            .map(ToOwned::to_owned)
                            .collect(),
                        status: row.get(7)?,
                        created_at: row.get(8)?,
                        completed_at: row.get(9)?,
                        message: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(sessions)
        })
    }
    pub fn complete_oauth_callback(
        &self,
        state: &str,
        code: &str,
    ) -> MailResult<OAuthCallbackReport> {
        let state = state.trim();
        let code = code.trim();
        if state.is_empty() || code.is_empty() {
            return Err(crate::db::MailError::Imap(
                "OAuth2 回调必须包含 state 和 code。".to_string(),
            ));
        }

        self.with_conn(|conn| {
            let (id, provider, status): (i64, String, String) = conn.query_row(
                "SELECT id, provider, status FROM oauth_sessions WHERE state = ?1",
                params![state],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            if status != "pending" {
                return Err(crate::db::MailError::Imap(format!(
                    "OAuth2 会话状态为 {status}，不能重复处理回调。"
                )));
            }
            let now = Utc::now().to_rfc3339();
            let message = "OAuth2 授权码已接收；下一步执行 token 交换并写入本地 SQLite 凭据。";
            conn.execute(
                "
                UPDATE oauth_sessions
                SET authorization_code = ?2,
                    status = 'code_received',
                    completed_at = ?3,
                    message = ?4
                WHERE id = ?1
                ",
                params![id, code, now, message],
            )?;
            Ok(OAuthCallbackReport {
                session_id: id,
                provider,
                status: "code_received".to_string(),
                message: message.to_string(),
            })
        })
    }
    pub fn oauth_session_for_token_exchange(
        &self,
        session_id: i64,
    ) -> MailResult<OAuthTokenExchangeSession> {
        self.with_conn(|conn| {
            let session = conn.query_row(
                "
                SELECT s.id, a.email, s.provider, s.redirect_uri, s.code_verifier,
                       s.scopes, s.authorization_code, s.status
                 FROM oauth_sessions s
                 JOIN accounts a ON a.id = s.account_id
                 WHERE s.id = ?1
                 ",
                params![session_id],
                |row| {
                    let scopes: String = row.get(5)?;
                    Ok(OAuthTokenExchangeSession {
                        id: row.get(0)?,
                        account_email: row.get(1)?,
                        provider: row.get(2)?,
                        redirect_uri: row.get(3)?,
                        code_verifier: row.get(4)?,
                        scopes: scopes
                            .lines()
                            .map(str::trim)
                            .filter(|scope| !scope.is_empty())
                            .map(ToOwned::to_owned)
                            .collect(),
                        authorization_code: row.get(6)?,
                        status: row.get(7)?,
                    })
                },
            )?;
            if !matches!(
                session.status.as_str(),
                "code_received" | "token_exchange_failed"
            ) {
                return Err(crate::db::MailError::Imap(format!(
                    "OAuth2 会话状态为 {}，需要先记录授权码。",
                    session.status
                )));
            }
            if session.authorization_code.trim().is_empty() {
                return Err(crate::db::MailError::Imap(
                    "OAuth2 会话没有授权码，无法交换 token。".to_string(),
                ));
            }
            Ok(session)
        })
    }
    pub fn mark_oauth_token_stored(
        &self,
        session_id: i64,
        expires_at: &str,
    ) -> MailResult<OAuthTokenExchangeReport> {
        self.with_conn(|conn| {
            let (id, provider): (i64, String) = conn.query_row(
                "SELECT id, provider FROM oauth_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let now = Utc::now().to_rfc3339();
            let message = "OAuth2 token 已交换并保存到系统凭据库。";
            conn.execute(
                "
                UPDATE oauth_sessions
                SET status = 'token_stored',
                    completed_at = ?2,
                    message = ?3,
                    code_verifier = '',
                    authorization_code = ''
                WHERE id = ?1
                ",
                params![id, now, message],
            )?;
            Ok(OAuthTokenExchangeReport {
                session_id: id,
                provider,
                status: "token_stored".to_string(),
                expires_at: expires_at.to_string(),
                message: message.to_string(),
            })
        })
    }
    pub fn mark_oauth_token_exchange_failed(
        &self,
        session_id: i64,
        reason: &str,
    ) -> MailResult<OAuthTokenExchangeReport> {
        self.with_conn(|conn| {
            let (id, provider): (i64, String) = conn.query_row(
                "SELECT id, provider FROM oauth_sessions WHERE id = ?1",
                params![session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let now = Utc::now().to_rfc3339();
            let message = format!("OAuth2 token 交换失败：{reason}");
            conn.execute(
                "
                UPDATE oauth_sessions
                SET status = 'token_exchange_failed',
                    completed_at = ?2,
                    message = ?3
                WHERE id = ?1
                ",
                params![id, now, &message],
            )?;
            Ok(OAuthTokenExchangeReport {
                session_id: id,
                provider,
                status: "token_exchange_failed".to_string(),
                expires_at: String::new(),
                message,
            })
        })
    }
}
