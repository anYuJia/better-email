use crate::credentials;
use crate::imap_probe::{self, ImapHeaderFetchOptions};
use crate::models::Account;
use crate::smtp;
use chrono::Utc;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::Instant;

#[derive(Debug, Clone, Serialize)]
pub struct ProviderProbeAccount {
    pub account_id: i64,
    pub account_masked: String,
    pub domain: String,
    pub provider: String,
    pub auth_type: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub incoming_protocol: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderProbeStage {
    pub status: String,
    pub duration_ms: u128,
    pub message: String,
    pub item_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderProbeReport {
    pub status: String,
    pub checked_at: String,
    pub account: ProviderProbeAccount,
    pub credential: ProviderProbeStage,
    pub imap_login: ProviderProbeStage,
    pub smtp_login: ProviderProbeStage,
    pub folder_discovery: ProviderProbeStage,
    pub inbox_header_sample: ProviderProbeStage,
}

pub fn list_provider_probe_accounts(
    database_path: &Path,
) -> Result<Vec<ProviderProbeAccount>, String> {
    let connection = open_read_only(database_path)?;
    let mut statement = connection
        .prepare(
            "SELECT id, email, display_name, provider, imap_host, smtp_host,
                    incoming_protocol, auth_type, sync_mode, remote_images_allowed,
                    signature, is_default
             FROM accounts ORDER BY is_default DESC, id",
        )
        .map_err(|error| format!("读取账号列表失败：{error}"))?;
    let rows = statement
        .query_map([], map_account)
        .map_err(|error| format!("读取账号列表失败：{error}"))?;
    rows.map(|row| {
        row.map(|account| probe_account(&account))
            .map_err(|error| format!("解析账号列表失败：{error}"))
    })
    .collect()
}

pub fn run_provider_probe(
    database_path: &Path,
    account_id: i64,
) -> Result<ProviderProbeReport, String> {
    let account = load_account(database_path, account_id)?;
    let account_summary = probe_account(&account);

    let credential_started = Instant::now();
    let secret = match load_account_secret(database_path, &account)
        .and_then(|raw| credentials::account_secret_from_raw(&account.auth_type, &raw))
    {
        Ok(secret) => secret,
        Err(error) => {
            let credential =
                failed_stage(credential_started, sanitize_message(&error, &account.email));
            return Ok(ProviderProbeReport {
                status: "error".to_string(),
                checked_at: Utc::now().to_rfc3339(),
                account: account_summary,
                credential,
                imap_login: skipped_stage("未读取到可用凭据，跳过 IMAP 登录。"),
                smtp_login: skipped_stage("未读取到可用凭据，跳过 SMTP 登录。"),
                folder_discovery: skipped_stage("IMAP 登录未执行，跳过文件夹发现。"),
                inbox_header_sample: skipped_stage("文件夹发现未执行，跳过邮件头样本。"),
            });
        }
    };
    let credential = success_stage(
        credential_started,
        "已从本地应用数据读取授权码，报告不会输出敏感内容。",
        None,
    );

    let imap_started = Instant::now();
    let imap_result = imap_probe::verify_credentials(&account, &secret);
    let imap_ok = imap_result.is_ok();
    let imap_login = match imap_result {
        Ok(()) => success_stage(imap_started, "IMAP 登录成功。", None),
        Err(error) => failed_stage(
            imap_started,
            sanitize_message(&error.to_string(), &account.email),
        ),
    };

    let smtp_started = Instant::now();
    let smtp_result = smtp::verify_credentials(&account, &secret);
    let smtp_ok = smtp_result.is_ok();
    let smtp_login = match smtp_result {
        Ok(()) => success_stage(smtp_started, "SMTP 认证与 NOOP 成功，未发送邮件。", None),
        Err(error) => failed_stage(
            smtp_started,
            sanitize_message(&error.to_string(), &account.email),
        ),
    };

    let (folder_discovery, inbox_header_sample, folders_ok, headers_ok) = if imap_ok {
        probe_folders_and_headers(&account, &secret)
    } else {
        (
            skipped_stage("IMAP 登录失败，跳过文件夹发现。"),
            skipped_stage("IMAP 登录失败，跳过邮件头样本。"),
            false,
            false,
        )
    };

    let status = if imap_ok && smtp_ok && folders_ok && headers_ok {
        "ok"
    } else if imap_ok || smtp_ok || folders_ok || headers_ok {
        "partial"
    } else {
        "error"
    };

    Ok(ProviderProbeReport {
        status: status.to_string(),
        checked_at: Utc::now().to_rfc3339(),
        account: account_summary,
        credential,
        imap_login,
        smtp_login,
        folder_discovery,
        inbox_header_sample,
    })
}

fn load_account_secret(database_path: &Path, account: &Account) -> Result<String, String> {
    let connection = open_read_only(database_path)?;
    let raw = connection
        .query_row(
            "SELECT secret FROM account_credentials WHERE account_email = ?1",
            [account.email.trim().to_ascii_lowercase()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("读取本地授权码失败：{error}"))?;
    raw.filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| "未保存该账号授权码。".to_string())
}

fn probe_folders_and_headers(
    account: &Account,
    secret: &credentials::AccountSecret,
) -> (ProviderProbeStage, ProviderProbeStage, bool, bool) {
    let folder_started = Instant::now();
    let report = match imap_probe::discover_folders(account, secret) {
        Ok(report) => report,
        Err(error) => {
            return (
                failed_stage(
                    folder_started,
                    sanitize_message(&error.to_string(), &account.email),
                ),
                skipped_stage("文件夹发现失败，跳过邮件头样本。"),
                false,
                false,
            );
        }
    };
    let inbox = report
        .folders
        .iter()
        .find(|folder| folder.name.eq_ignore_ascii_case("INBOX"))
        .or_else(|| {
            report.folders.iter().find(|folder| {
                folder
                    .attributes
                    .iter()
                    .any(|attribute| attribute.to_ascii_lowercase().contains("inbox"))
            })
        })
        .map(|folder| folder.name.clone());
    let folder_discovery = success_stage(
        folder_started,
        "IMAP 文件夹发现成功。",
        Some(report.folder_count),
    );
    let Some(inbox) = inbox else {
        return (
            folder_discovery,
            skipped_stage("未识别到收件箱，未抓取邮件头样本。"),
            true,
            false,
        );
    };

    let header_started = Instant::now();
    let header_result = imap_probe::fetch_header_page(
        account,
        secret,
        &inbox,
        ImapHeaderFetchOptions {
            uid_validity: "",
            highest_uid: 0,
            lowest_uid: 0,
            history_complete: false,
            include_recent: true,
            include_history: false,
        },
    );
    match header_result {
        Ok(result) => (
            folder_discovery,
            success_stage(
                header_started,
                "收件箱邮件头只读抓取成功，未下载正文。",
                Some(result.headers.headers.len() as i64),
            ),
            true,
            true,
        ),
        Err(error) => (
            folder_discovery,
            failed_stage(
                header_started,
                sanitize_message(&error.to_string(), &account.email),
            ),
            true,
            false,
        ),
    }
}

fn open_read_only(database_path: &Path) -> Result<Connection, String> {
    if !database_path.exists() {
        return Err(format!(
            "Better Email 数据库不存在：{}",
            database_path.display()
        ));
    }
    Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("只读打开数据库失败：{error}"))
}

fn load_account(database_path: &Path, account_id: i64) -> Result<Account, String> {
    let connection = open_read_only(database_path)?;
    connection
        .query_row(
            "SELECT id, email, display_name, provider, imap_host, smtp_host,
                    incoming_protocol, auth_type, sync_mode, remote_images_allowed,
                    signature, is_default
             FROM accounts WHERE id = ?1",
            [account_id],
            map_account,
        )
        .optional()
        .map_err(|error| format!("读取账号失败：{error}"))?
        .ok_or_else(|| format!("未找到账号 ID {account_id}。"))
}

fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        provider: row.get(3)?,
        imap_host: row.get(4)?,
        smtp_host: row.get(5)?,
        incoming_protocol: row.get(6)?,
        auth_type: row.get(7)?,
        sync_mode: row.get(8)?,
        remote_images_allowed: row.get::<_, i64>(9)? != 0,
        signature: row.get(10)?,
        is_default: row.get::<_, i64>(11)? != 0,
    })
}

fn probe_account(account: &Account) -> ProviderProbeAccount {
    let domain = account
        .email
        .split_once('@')
        .map(|(_, domain)| domain.to_ascii_lowercase())
        .unwrap_or_default();
    ProviderProbeAccount {
        account_id: account.id,
        account_masked: mask_email(&account.email),
        domain,
        provider: account.provider.clone(),
        auth_type: account.auth_type.clone(),
        imap_host: account.imap_host.clone(),
        smtp_host: account.smtp_host.clone(),
        incoming_protocol: account.incoming_protocol.clone(),
    }
}

fn mask_email(value: &str) -> String {
    let Some((local, domain)) = value.trim().split_once('@') else {
        return "***".to_string();
    };
    let first = local.chars().next().unwrap_or('*');
    format!("{first}***@{domain}")
}

fn sanitize_message(message: &str, account_email: &str) -> String {
    message.replace(account_email, &mask_email(account_email))
}

fn success_stage(
    started: Instant,
    message: impl Into<String>,
    item_count: Option<i64>,
) -> ProviderProbeStage {
    ProviderProbeStage {
        status: "ok".to_string(),
        duration_ms: started.elapsed().as_millis(),
        message: message.into(),
        item_count,
    }
}

fn failed_stage(started: Instant, message: impl Into<String>) -> ProviderProbeStage {
    ProviderProbeStage {
        status: "error".to_string(),
        duration_ms: started.elapsed().as_millis(),
        message: message.into(),
        item_count: None,
    }
}

fn skipped_stage(message: impl Into<String>) -> ProviderProbeStage {
    ProviderProbeStage {
        status: "skipped".to_string(),
        duration_ms: 0,
        message: message.into(),
        item_count: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn lists_accounts_without_exposing_full_email() {
        let path = test_database_path("list");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE accounts(
                    id INTEGER PRIMARY KEY,
                    email TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    imap_host TEXT NOT NULL,
                    smtp_host TEXT NOT NULL,
                    incoming_protocol TEXT NOT NULL,
                    auth_type TEXT NOT NULL,
                    sync_mode TEXT NOT NULL,
                    remote_images_allowed INTEGER NOT NULL,
                    signature TEXT NOT NULL,
                    is_default INTEGER NOT NULL
                );
                INSERT INTO accounts VALUES(
                    7, 'reader@example.com', 'Reader', 'custom',
                    'imap.example.com:993', 'smtp.example.com:465',
                    'imap', 'password', 'manual', 0, '', 1
                );",
            )
            .unwrap();
        drop(connection);

        let accounts = list_provider_probe_accounts(&path).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].account_id, 7);
        assert_eq!(accounts[0].account_masked, "r***@example.com");
        assert_eq!(accounts[0].domain, "example.com");
        assert!(!serde_json::to_string(&accounts)
            .unwrap()
            .contains("reader@"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn sanitizes_account_email_from_stage_errors() {
        let sanitized = sanitize_message(
            "IMAP login failed for reader@example.com",
            "reader@example.com",
        );
        assert_eq!(sanitized, "IMAP login failed for r***@example.com");
    }

    fn test_database_path(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "better-email-provider-probe-{label}-{}-{nonce}.sqlite3",
            std::process::id()
        ))
    }
}
