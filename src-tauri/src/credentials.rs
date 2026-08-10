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
}
