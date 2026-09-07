use super::accounts::{account_for_conn, create_account_for_conn};
use super::*;
use crate::credentials::{account_secret_from_raw, AccountSecret};
use std::io::ErrorKind;

fn status(email: &str, state: &str, message: &str) -> CredentialStatus {
    CredentialStatus {
        account_email: email.trim().to_lowercase(),
        exists: state == "exists",
        status: state.to_string(),
        message: message.to_string(),
    }
}

fn stored_secret(conn: &Connection, email: &str) -> MailResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT secret FROM account_credentials WHERE account_email = ?1",
            params![email.trim().to_lowercase()],
            |row| row.get(0),
        )
        .optional()?)
}

fn validate_secret(auth_type: &str, raw: &str) -> MailResult<AccountSecret> {
    if raw.trim().is_empty() {
        return Err(MailError::Imap(
            "本机未保存可用登录凭据，请在“登录与安全”重新保存并验证；无需删除账号。".into(),
        ));
    }
    account_secret_from_raw(auth_type, raw).map_err(|_| {
        MailError::Imap("登录凭据与当前认证方式不匹配，请在“登录与安全”重新保存并验证。".into())
    })
}

impl MailStore {
    pub fn create_account_with_secret(
        &self,
        input: AccountCreateInput,
        secret: &str,
    ) -> MailResult<Account> {
        validate_secret(&input.auth_type, secret.trim())?;
        self.with_conn(|conn| {
            let transaction = rusqlite::Transaction::new_unchecked(
                conn,
                rusqlite::TransactionBehavior::Immediate,
            )?;
            let account = create_account_for_conn(&transaction, input)?;
            self.store_secret_for_conn(&transaction, &account.email, secret.trim())?;
            transaction.commit()?;
            Ok(account)
        })
    }

    pub(super) fn encrypt_local_secret(&self, conn: &Connection, raw: &str) -> MailResult<String> {
        let require_existing: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM account_credentials WHERE substr(secret, 1, 4) = 'be1:')
                OR EXISTS(SELECT 1 FROM ai_settings WHERE substr(api_key, 1, 4) = 'be1:' OR substr(mcp_api_key, 1, 4) = 'be1:')",
            [], |row| row.get(0),
        )?;
        crate::secret_crypto::encrypt_secret_preserving_key(&self.data_dir, raw, require_existing)
            .map_err(MailError::Io)
    }

    pub(super) fn store_secret_for_conn(
        &self,
        conn: &Connection,
        email: &str,
        raw: &str,
    ) -> MailResult<()> {
        let encrypted = self.encrypt_local_secret(conn, raw)?;
        conn.execute(
            "INSERT INTO account_credentials(account_email, secret, updated_at) VALUES (?1, ?2, ?3)
                ON CONFLICT(account_email) DO UPDATE SET secret = excluded.secret, updated_at = excluded.updated_at",
            params![email, encrypted, Utc::now().to_rfc3339()],
        )?;
        let stored = stored_secret(conn, email)?
            .ok_or_else(|| MailError::Imap("凭据写入后未能读回，未提交本次保存。".into()))?;
        let verified = crate::secret_crypto::decrypt_secret(&self.data_dir, &stored)?;
        if verified != raw {
            return Err(MailError::Imap("凭据读回校验失败，未提交本次保存。".into()));
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn store_account_secret(&self, email: &str, secret: &str) -> MailResult<CredentialStatus> {
        self.store_account_secret_bound(email, secret, None, None)
    }

    pub fn store_account_secret_bound(
        &self,
        email: &str,
        secret: &str,
        account_id: Option<i64>,
        auth_type: Option<&str>,
    ) -> MailResult<CredentialStatus> {
        let email = email.trim().to_lowercase();
        let raw = secret.trim();
        if email.is_empty() || raw.is_empty() {
            return Ok(status(
                &email,
                "invalid_input",
                "账号邮箱和登录凭据不能为空。",
            ));
        }
        self.with_conn(|conn| {
            let transaction = rusqlite::Transaction::new_unchecked(
                conn,
                rusqlite::TransactionBehavior::Immediate,
            )?;
            let target: Option<(i64, String)> = transaction
                .query_row(
                    "SELECT id, auth_type FROM accounts WHERE email = ?1",
                    params![email],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            if let Some((id, current_auth_type)) = target {
                if account_id.is_some_and(|expected| expected != id)
                    || auth_type.is_some_and(|expected| expected != current_auth_type)
                {
                    return Err(MailError::Imap(
                        "账号或认证方式已改变，请重新打开当前账号的登录设置。".into(),
                    ));
                }
                validate_secret(&current_auth_type, raw)?;
            } else if account_id.is_some() {
                return Err(MailError::Imap("邮箱账号已被移除，未写入凭据。".into()));
            }
            self.store_secret_for_conn(&transaction, &email, raw)?;
            transaction.commit()?;
            Ok(status(
                &email,
                "exists",
                "登录凭据已加密保存并读回校验；服务器登录状态仍需验证。",
            ))
        })
    }

    pub fn check_account_secret(&self, email: &str) -> MailResult<CredentialStatus> {
        let email = email.trim().to_lowercase();
        self.with_conn(|conn| {
            let raw = stored_secret(conn, &email)?;
            let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
                return Ok(status(&email, "not_found", "本机未保存登录凭据。账号和缓存邮件仍保留，请在“登录与安全”重新保存并验证；无需删除账号。"));
            };
            let decrypted = match crate::secret_crypto::decrypt_secret(&self.data_dir, &raw) {
                Ok(value) => value,
                Err(error) => return Ok(if error.kind() == ErrorKind::NotFound {
                    status(&email, "key_missing", "已保存的凭据无法读取：原 credentials.key 缺失。请恢复原密钥备份；程序不会创建或覆盖密钥。")
                } else {
                    status(&email, "unreadable", "已保存的凭据无法解密，可能是密钥或数据损坏。请检查原密钥备份；账号和缓存邮件未被删除。")
                }),
            };
            let auth_type: Option<String> = conn.query_row(
                "SELECT auth_type FROM accounts WHERE email = ?1", params![email], |row| row.get(0),
            ).optional()?;
            if validate_secret(auth_type.as_deref().unwrap_or("password"), &decrypted).is_err() {
                return Ok(status(&email, "invalid", "凭据为空或与当前认证方式不匹配，请在“登录与安全”重新保存并验证。"));
            }
            Ok(status(&email, "exists", "本机凭据可读取；这不代表服务器登录验证已经通过。"))
        })
    }

    pub fn list_account_credential_statuses(&self) -> MailResult<Vec<CredentialStatus>> {
        self.list_accounts()?
            .iter()
            .map(|account| self.check_account_secret(&account.email))
            .collect()
    }

    pub(crate) fn credential_snapshot_optional(
        &self,
        account: &Account,
    ) -> MailResult<Option<String>> {
        self.with_conn(|conn| {
            let current = account_for_conn(conn, Some(account.id))?;
            if current.email != account.email || current.auth_type != account.auth_type {
                return Err(MailError::Imap(
                    "账号或认证方式已改变，请重试当前账号。".into(),
                ));
            }
            stored_secret(conn, &account.email)
        })
    }

    fn credential_snapshot(&self, account: &Account) -> MailResult<String> {
        self.credential_snapshot_optional(account)?
            .filter(|raw| !raw.trim().is_empty())
            .ok_or_else(|| {
                MailError::Imap(
                    "本机未保存该账号登录凭据，请在“登录与安全”重新保存并验证；无需删除账号。"
                        .into(),
                )
            })
    }

    pub fn refresh_account_oauth_secret(
        &self,
        account: &Account,
        client_id: &str,
        client_secret: &str,
    ) -> MailResult<crate::oauth::OAuthTokenBundle> {
        let previous = self.credential_snapshot(account)?;
        let raw = crate::secret_crypto::decrypt_secret(&self.data_dir, &previous)?;
        let AccountSecret::OAuth2(bundle) = validate_secret(&account.auth_type, &raw)? else {
            return Err(MailError::Imap("当前账号不是 OAuth2 模式。".into()));
        };
        let refreshed = crate::oauth::refresh_token(&bundle, client_id, client_secret)
            .map_err(MailError::Imap)?;
        let raw = serde_json::to_string(&refreshed)
            .map_err(|_| MailError::Imap("OAuth2 token 序列化失败。".into()))?;
        if !self.replace_refreshed_secret(account, &previous, &raw)? {
            return Err(MailError::Imap(
                "刷新期间账号或凭据已改变，已保留较新的登录状态，请重试。".into(),
            ));
        }
        Ok(refreshed)
    }

    pub fn get_account_secret_raw(&self, account: &Account) -> MailResult<String> {
        let stored = self.credential_snapshot(account)?;
        let raw = crate::secret_crypto::decrypt_secret(&self.data_dir, &stored)?;
        validate_secret(&account.auth_type, &raw)?;
        Ok(raw)
    }

    pub fn get_account_secret(&self, account: &Account) -> MailResult<AccountSecret> {
        let stored = self.credential_snapshot(account)?;
        let raw = crate::secret_crypto::decrypt_secret(&self.data_dir, &stored)?;
        let secret = validate_secret(&account.auth_type, &raw)?;
        let AccountSecret::OAuth2(bundle) = &secret else {
            return Ok(secret);
        };
        if !crate::oauth::token_needs_refresh(bundle) {
            return Ok(secret);
        }
        let refreshed = match crate::oauth::refresh_token(bundle, "", "") {
            Ok(value) => value,
            Err(error) => {
                if self.credential_snapshot(account)? != stored {
                    return validate_secret(
                        &account.auth_type,
                        &self.get_account_secret_raw(account)?,
                    );
                }
                return Err(MailError::Imap(error));
            }
        };
        let serialized = serde_json::to_string(&refreshed)
            .map_err(|_| MailError::Imap("OAuth2 token 序列化失败。".into()))?;
        if !self.replace_refreshed_secret(account, &stored, &serialized)? {
            return validate_secret(&account.auth_type, &self.get_account_secret_raw(account)?);
        }
        Ok(AccountSecret::OAuth2(refreshed))
    }

    fn replace_refreshed_secret(
        &self,
        account: &Account,
        previous: &str,
        raw: &str,
    ) -> MailResult<bool> {
        validate_secret(&account.auth_type, raw)?;
        self.with_conn(|conn| {
            let transaction = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
            let current: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts a JOIN account_credentials c ON c.account_email = a.email
                    WHERE a.id = ?1 AND a.email = ?2 AND a.auth_type = ?3 AND c.secret = ?4)",
                params![account.id, account.email, account.auth_type, previous], |row| row.get(0),
            )?;
            if !current { return Ok(false); }
            self.store_secret_for_conn(&transaction, &account.email, raw)?;
            transaction.commit()?;
            Ok(true)
        })
    }

    pub fn delete_account_secret(&self, email: &str) -> MailResult<CredentialStatus> {
        let email = email.trim().to_lowercase();
        self.with_conn(|conn| {
            let changed = conn.execute(
                "DELETE FROM account_credentials WHERE account_email = ?1",
                params![email],
            )?;
            Ok(if changed == 0 {
                status(&email, "not_found", "本机未找到对应凭据。")
            } else {
                status(&email, "deleted", "本机凭据已删除，账号和缓存邮件仍保留。")
            })
        })
    }
}

#[cfg(test)]
#[path = "account_credentials_tests.rs"]
mod tests;
