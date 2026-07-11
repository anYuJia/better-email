use crate::models::{Account, CredentialStatus};
use crate::oauth::{self, OAuthTokenBundle};
use keyring::Entry;
#[cfg(target_os = "macos")]
use security_framework::os::macos::keychain::SecKeychain;
#[cfg(target_os = "macos")]
use security_framework::os::macos::passwords::find_generic_password;

const SERVICE: &str = "Better Email";
const LEGACY_SERVICE: &str = "SwiftMail";

pub fn get_secret(account_email: &str) -> Result<String, String> {
    let current = Entry::new(SERVICE, account_email)
        .and_then(|entry| entry.get_password())
        .ok();
    if let Some(secret) = current {
        return Ok(secret);
    }

    let legacy = Entry::new(LEGACY_SERVICE, account_email)
        .and_then(|entry| entry.get_password())
        .map_err(|error| format!("未读取到系统凭据：{error}"))?;
    let _ = Entry::new(SERVICE, account_email).and_then(|entry| entry.set_password(&legacy));
    Ok(legacy)
}

#[derive(Debug, Clone)]
pub enum AccountSecret {
    Password(String),
    OAuth2(OAuthTokenBundle),
}

pub fn get_account_secret(account: &Account) -> Result<AccountSecret, String> {
    let raw = get_secret(&account.email)?;
    if account.auth_type.trim() != "oauth2" {
        return Ok(AccountSecret::Password(raw));
    }
    let bundle = oauth_bundle_from_raw(&raw)?;
    if !oauth::token_needs_refresh(&bundle) {
        return Ok(AccountSecret::OAuth2(bundle));
    }
    let refreshed = oauth::refresh_token(&bundle, "", "")?;
    let secret = serde_json::to_string(&refreshed)
        .map_err(|error| format!("OAuth2 token 序列化失败：{error}"))?;
    let status = store_secret(&account.email, &secret);
    if !status.exists {
        return Err(status.message);
    }
    Ok(AccountSecret::OAuth2(refreshed))
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

pub fn store_secret(account_email: &str, secret: &str) -> CredentialStatus {
    match Entry::new(SERVICE, account_email).and_then(|entry| entry.set_password(secret)) {
        Ok(()) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: true,
            message: "凭据已保存到系统凭据库。".to_string(),
        },
        Err(error) if should_try_keychain_update(&error.to_string()) => {
            match update_existing_secret(account_email, secret) {
                Ok(()) => CredentialStatus {
                    account_email: account_email.to_string(),
                    exists: true,
                    message: "已更新系统凭据库中的现有凭据。".to_string(),
                },
                Err(update_error) => CredentialStatus {
                    account_email: account_email.to_string(),
                    exists: false,
                    message: format!(
                        "系统凭据库保存失败：{error}；覆盖现有凭据失败：{update_error}"
                    ),
                },
            }
        }
        Err(error) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: false,
            message: format!("系统凭据库保存失败：{error}"),
        },
    }
}

fn should_try_keychain_update(error: &str) -> bool {
    let normalized = error.to_lowercase();
    normalized.contains("already exists") || normalized.contains("specified item already exists")
}

#[cfg(target_os = "macos")]
fn update_existing_secret(account_email: &str, secret: &str) -> Result<(), String> {
    let keychain = SecKeychain::default().map_err(|error| error.to_string())?;
    let (_, mut item) = find_generic_password(Some(&[keychain]), SERVICE, account_email)
        .map_err(|error| error.to_string())?;
    item.set_password(secret.as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn update_existing_secret(account_email: &str, secret: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, account_email).map_err(|error| error.to_string())?;
    entry
        .delete_credential()
        .map_err(|error| error.to_string())?;
    entry.set_password(secret).map_err(|error| error.to_string())
}

pub fn check_secret(account_email: &str) -> CredentialStatus {
    match get_secret(account_email) {
        Ok(secret) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: !secret.is_empty(),
            message: "系统凭据库中存在该账号凭据。".to_string(),
        },
        Err(error) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: false,
            message: format!("未读取到系统凭据：{error}"),
        },
    }
}

pub fn delete_secret(account_email: &str) -> CredentialStatus {
    let current = Entry::new(SERVICE, account_email)
        .and_then(|entry| entry.delete_credential())
        .map_err(|error| error.to_string());
    let legacy = Entry::new(LEGACY_SERVICE, account_email)
        .and_then(|entry| entry.delete_credential())
        .map_err(|error| error.to_string());
    match (current, legacy) {
        (Ok(()), _) | (_, Ok(())) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: false,
            message: "系统凭据已删除。".to_string(),
        },
        (Err(current_error), Err(legacy_error)) => CredentialStatus {
            account_email: account_email.to_string(),
            exists: false,
            message: format!("系统凭据删除失败或不存在：{current_error}；旧凭据：{legacy_error}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_shape_does_not_expose_secret() {
        let status = CredentialStatus {
            account_email: "a@example.com".to_string(),
            exists: true,
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
