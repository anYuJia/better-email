use crate::oauth::OAuthTokenBundle;

#[derive(Debug, Clone)]
pub enum AccountSecret {
    Password(String),
    OAuth2(OAuthTokenBundle),
}

pub fn account_secret_from_raw(auth_type: &str, raw: &str) -> Result<AccountSecret, String> {
    if auth_type.trim() == "oauth2" {
        Ok(AccountSecret::OAuth2(oauth_bundle_from_raw(raw)?))
    } else {
        Ok(AccountSecret::Password(raw.to_string()))
    }
}

fn oauth_bundle_from_raw(raw: &str) -> Result<OAuthTokenBundle, String> {
    let bundle: OAuthTokenBundle = serde_json::from_str(raw)
        .map_err(|error| format!("OAuth2 token 格式无效，请重新完成授权码 token 交换：{error}"))?;
    if bundle.access_token.trim().is_empty() {
        return Err("OAuth2 token 缺少 access_token，请重新授权。".to_string());
    }
    Ok(bundle)
}

/// 系统凭据服务名（macOS Keychain / Windows Credential Manager / Linux secret-service）。
pub const KEYCHAIN_SERVICE: &str = "app.betteremail.client";

/// 将账号凭据写入系统凭据库。失败时返回错误信息，由调用方决定是否回退。
pub fn keychain_set_secret(account_email: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account_email.trim())
        .map_err(|error| format!("系统凭据库初始化失败：{error}"))?;
    entry
        .set_password(secret)
        .map_err(|error| format!("系统凭据库写入失败：{error}"))
}

/// 从系统凭据库读取账号凭据。不存在时返回 Ok(None)。
pub fn keychain_get_secret(account_email: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account_email.trim())
        .map_err(|error| format!("系统凭据库初始化失败：{error}"))?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("系统凭据库读取失败：{error}")),
    }
}

/// 从系统凭据库删除账号凭据。不存在时视为已删除。
pub fn keychain_delete_secret(account_email: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, account_email.trim())
        .map_err(|error| format!("系统凭据库初始化失败：{error}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("系统凭据库删除失败：{error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CredentialStatus;

    #[test]
    fn status_shape_does_not_expose_secret() {
        let status = CredentialStatus {
            account_email: "a@example.com".to_string(),
            exists: true,
            status: "exists".to_string(),
            message: "ok".to_string(),
        };
        assert_eq!(status.account_email, "a@example.com");
        assert!(status.exists);
    }

    #[test]
    fn parses_password_and_oauth_secret_shapes() {
        let password = account_secret_from_raw("password", "app-password").unwrap();
        match password {
            AccountSecret::Password(secret) => assert_eq!(secret, "app-password"),
            AccountSecret::OAuth2(_) => panic!("password auth should keep raw secret"),
        }

        let oauth = account_secret_from_raw(
            "oauth2",
            r#"{"provider":"gmail","access_token":"access-123","refresh_token":"refresh-123","token_type":"Bearer","scope":"https://mail.google.com/","expires_at":"2026-07-08T00:00:00Z","stored_at":"2026-07-08T00:00:00Z"}"#,
        )
        .unwrap();
        match oauth {
            AccountSecret::OAuth2(bundle) => assert_eq!(bundle.access_token, "access-123"),
            AccountSecret::Password(_) => panic!("oauth2 auth should parse token bundle"),
        }
    }

    #[test]
    fn keychain_missing_entry_reads_as_none_without_error() {
        let email = "keychain-test-none@example.com";
        let _ = keychain_delete_secret(email);
        match keychain_get_secret(email) {
            Ok(option) => assert!(option.is_none()),
            Err(error) => {
                // 无可用系统凭据库（如 headless Linux）时跳过，不视为失败。
                assert!(error.contains("系统凭据库"));
            }
        }
    }
}
