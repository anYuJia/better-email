use super::common::{
    command_info, is_pop3_account, mask_email, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH,
    SYNCABLE_IMAP_ROLES,
};
use crate::credentials;
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{
    Account, ConnectionReport, CredentialProtocolCheck, CredentialVerificationInput,
    CredentialVerificationReport, ImapMailboxState, ImapProbeReport, Message, SyncRun,
    SyncSchedulePlan,
};
use crate::pop3_probe;
use crate::protocol;
use crate::smtp;
use chrono::Utc;
use tauri::State;
#[tauri::command]
pub fn test_connection(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ConnectionReport> {
    let account = store.get_account_by_id(account_id)?;
    protocol::test_endpoints(
        &account.email,
        &account.incoming_protocol,
        &account.imap_host,
        &account.smtp_host,
    )
}

#[tauri::command]
pub async fn verify_account_credentials(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<CredentialVerificationReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(credential_error_report(&account, error.to_string())),
    };
    let incoming_result = verify_incoming_credentials(&account, &secret);
    let smtp_result =
        smtp::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    Ok(credential_verification_report(
        &account,
        incoming_result,
        smtp_result,
    ))
}

#[tauri::command]
pub async fn verify_account_credentials_with_secret(
    store: State<'_, MailStore>,
    input: CredentialVerificationInput,
) -> MailResult<CredentialVerificationReport> {
    let account = store.get_account_by_id(input.account_id)?;
    let raw_secret = input.secret.trim();
    if raw_secret.is_empty() {
        return Ok(credential_error_report(
            &account,
            "请输入授权码或密码后再验证。".to_string(),
        ));
    }
    let secret = match credentials::account_secret_from_raw(&account.auth_type, raw_secret) {
        Ok(secret) => secret,
        Err(error) => return Ok(credential_error_report(&account, error)),
    };
    let incoming_result = verify_incoming_credentials(&account, &secret);
    let smtp_result =
        smtp::verify_credentials(&account, &secret).map_err(|error| error.to_string());
    Ok(credential_verification_report(
        &account,
        incoming_result,
        smtp_result,
    ))
}

fn incoming_protocol_name(account: &Account) -> &'static str {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        "POP3"
    } else {
        "IMAP"
    }
}

fn verify_incoming_credentials(
    account: &Account,
    secret: &credentials::AccountSecret,
) -> Result<(), String> {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        pop3_probe::verify_credentials(account, secret).map_err(|error| error.to_string())
    } else {
        imap_probe::verify_credentials(account, secret).map_err(|error| error.to_string())
    }
}

fn credential_error_report(account: &Account, error: String) -> CredentialVerificationReport {
    let incoming_name = incoming_protocol_name(account);
    let message = format!("本地凭据不可用，未发起 {incoming_name}/SMTP 登录验证：{error}");
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        checks: vec![
            CredentialProtocolCheck {
                name: incoming_name.to_string(),
                address: account.imap_host.clone(),
                authenticated: false,
                message: "未发起登录：本地凭据不可用。".to_string(),
            },
            CredentialProtocolCheck {
                name: "SMTP".to_string(),
                address: account.smtp_host.clone(),
                authenticated: false,
                message: "未发起登录：本地凭据不可用。".to_string(),
            },
        ],
        authenticated: false,
        status: "credential_error".to_string(),
        message,
    }
}

fn credential_verification_report(
    account: &Account,
    incoming_result: Result<(), String>,
    smtp_result: Result<(), String>,
) -> CredentialVerificationReport {
    let incoming_name = incoming_protocol_name(account);
    let checks = vec![
        credential_protocol_check(incoming_name, &account.imap_host, incoming_result),
        credential_protocol_check("SMTP", &account.smtp_host, smtp_result),
    ];
    let passed = checks.iter().filter(|check| check.authenticated).count();
    let (status, message) = match passed {
        2 => (
            "ok",
            format!("{incoming_name} 与 SMTP 登录验证通过，未发送任何邮件。"),
        ),
        1 => (
            "partial",
            "仅一个协议登录成功，请检查失败协议的服务器、授权码或 OAuth2 配置。".to_string(),
        ),
        _ => (
            "error",
            format!("{incoming_name} 与 SMTP 登录均未通过，请先确认本地凭据和服务商设置。"),
        ),
    };
    CredentialVerificationReport {
        account_email: account.email.clone(),
        checked_at: Utc::now().to_rfc3339(),
        authenticated: passed == checks.len(),
        checks,
        status: status.to_string(),
        message,
    }
}

fn credential_protocol_check(
    name: &str,
    address: &str,
    result: Result<(), String>,
) -> CredentialProtocolCheck {
    match result {
        Ok(()) => CredentialProtocolCheck {
            name: name.to_string(),
            address: address.to_string(),
            authenticated: true,
            message: format!("{name} 登录认证成功。"),
        },
        Err(message) => CredentialProtocolCheck {
            name: name.to_string(),
            address: address.to_string(),
            authenticated: false,
            message,
        },
    }
}

#[tauri::command]
pub async fn discover_imap_folders(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<ImapProbeReport> {
    let account = store.get_account_by_id(account_id)?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => return Ok(imap_probe::failed_report(&account.email, error.to_string())),
    };

    match imap_probe::discover_folders(&account, &secret) {
        Ok(report) => {
            if report.status == "ok" {
                store.save_imap_mailboxes_for_account(Some(account.id), &report.folders)?;
            }
            Ok(report)
        }
        Err(error) => Ok(imap_probe::failed_report(&account.email, error.to_string())),
    }
}

#[tauri::command]
pub fn list_imap_mailboxes(store: State<'_, MailStore>) -> MailResult<Vec<ImapMailboxState>> {
    store.list_imap_mailboxes()
}

#[tauri::command]
pub fn map_imap_mailbox(
    store: State<'_, MailStore>,
    mailbox_id: i64,
    folder_id: Option<i64>,
) -> MailResult<ImapMailboxState> {
    store.map_imap_mailbox(mailbox_id, folder_id)
}

#[tauri::command]
pub fn run_sync_dry_run(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    store.run_sync_dry_run(account_id)
}

#[tauri::command]
pub fn get_sync_schedule_plan(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncSchedulePlan> {
    let plan = store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)?;
    command_info(format!(
        "[better-email][sync] plan account_id={account_id:?} total_accounts={} batch_accounts={} delayed_accounts={}",
        plan.total_accounts,
        plan.batch_accounts.len(),
        plan.delayed_accounts.len()
    ));
    Ok(plan)
}


#[tauri::command]
pub async fn sync_imap_headers(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let command_started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][sync] command start account_id={account_id:?}"
    ));
    let plan = store.header_sync_schedule_plan(account_id, MAX_UNIFIED_SYNC_ACCOUNTS_PER_BATCH)?;
    let accounts = plan.batch_accounts.clone();
    command_info(format!(
        "[better-email][sync] command plan account_id={account_id:?} total_accounts={} batch_accounts={} delayed_accounts={}",
        plan.total_accounts,
        accounts.len(),
        plan.delayed_accounts.len()
    ));
    if account_id.is_some() {
        let account = accounts
            .first()
            .ok_or_else(|| crate::db::MailError::Imap("没有可同步账号。".to_string()))?;
        let result = sync_headers_for_account(&store, account, false);
        match &result {
            Ok(run) => command_info(format!(
                "[better-email][sync] command done account_id={account_id:?} status={} scanned_folders={} imported_messages={} duration_ms={}",
                run.status,
                run.scanned_folders,
                run.imported_messages,
                command_started_at.elapsed().as_millis()
            )),
            Err(error) => eprintln!(
                "[better-email][sync] command failed account_id={account_id:?} error={error} duration_ms={}",
                command_started_at.elapsed().as_millis()
            ),
        }
        return result;
    }

    let started_at = Utc::now().to_rfc3339();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut synced_accounts = 0;
    let mut failures = Vec::new();
    let mut warnings = Vec::new();

    for account in accounts {
        match sync_headers_for_account(&store, &account, false) {
            Ok(run) => {
                scanned_folders += run.scanned_folders;
                imported_messages += run.imported_messages;
                synced_accounts += 1;
                if run.status.ends_with("_account_partial") {
                    warnings.push(format!("{}: {}", account.email, run.message));
                }
            }
            Err(error) => {
                eprintln!(
                    "[better-email][sync] account failed account_id={} email={} error={error}",
                    account.id,
                    mask_email(&account.email),
                );
                failures.push(format!("{}: {error}", account.email));
            }
        }
    }

    let finished_at = Utc::now().to_rfc3339();
    let delayed_count = plan.delayed_accounts.len();
    let status = if failures.is_empty() && warnings.is_empty() {
        if delayed_count > 0 {
            "imap_headers_limited"
        } else {
            "imap_headers_multi"
        }
    } else if synced_accounts > 0 {
        "imap_headers_partial"
    } else {
        "imap_headers_failed"
    };
    let message = if failures.is_empty() && warnings.is_empty() {
        if delayed_count > 0 {
            format!(
                "统一邮箱限流同步完成：本轮 {} / {} 个账号，扫描 {} 个文件夹，新增 {} 封；{} 个账号留到下一轮。",
                synced_accounts,
                plan.total_accounts,
                scanned_folders,
                imported_messages,
                delayed_count
            )
        } else {
            format!(
                "统一邮箱同步完成：{} 个账号，扫描 {} 个文件夹，新增 {} 封。",
                synced_accounts, scanned_folders, imported_messages
            )
        }
    } else if synced_accounts > 0 {
        format!(
            "统一邮箱同步部分完成：{} 个账号完成，{} 个账号失败，{} 个账号存在目录警告，{} 个账号延后，扫描 {} 个文件夹，新增 {} 封。{}{}",
            synced_accounts,
            failures.len(),
            warnings.len(),
            delayed_count,
            scanned_folders,
            imported_messages,
            warnings.join("；"),
            if warnings.is_empty() || failures.is_empty() {
                failures.join("；")
            } else {
                format!("；{}", failures.join("；"))
            }
        )
    } else {
        format!(
            "统一邮箱同步失败：{} 个账号失败。{}",
            failures.len(),
            failures.join("；")
        )
    };

    let result = store.record_sync_run(
        &started_at,
        &finished_at,
        status,
        scanned_folders,
        imported_messages,
        &message,
    );
    match &result {
        Ok(run) => command_info(format!(
            "[better-email][sync] command done account_id={account_id:?} status={} scanned_folders={} imported_messages={} synced_accounts={} failures={} warnings={} duration_ms={} message={}",
            run.status,
            run.scanned_folders,
            run.imported_messages,
            synced_accounts,
            failures.len(),
            warnings.len(),
            command_started_at.elapsed().as_millis(),
            run.message,
        )),
        Err(error) => eprintln!(
            "[better-email][sync] record failed account_id={account_id:?} error={error} duration_ms={}",
            command_started_at.elapsed().as_millis()
        ),
    }
    result
}

#[tauri::command]
pub async fn sync_imap_history(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<SyncRun> {
    let account = store.get_account_by_id(account_id)?;
    sync_headers_for_account(&store, &account, true)
}

fn sync_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    if account
        .incoming_protocol
        .trim()
        .eq_ignore_ascii_case("pop3")
    {
        sync_pop3_headers_for_account(store, account, history_only)
    } else {
        sync_imap_headers_for_account(store, account, history_only)
    }
}

fn sync_pop3_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    let started_at = Utc::now().to_rfc3339();
    if history_only {
        let finished_at = Utc::now().to_rfc3339();
        let message = format!(
            "{} 使用 POP3 收信；POP3 无远端文件夹历史游标，本地收件箱同步已覆盖最近邮件。",
            account.email
        );
        return store.record_sync_run(
            &started_at,
            &finished_at,
            "pop3_history_complete",
            0,
            0,
            &message,
        );
    }

    let secret = store.get_account_secret(account)?;
    let messages = pop3_probe::fetch_recent_messages(account, &secret)?;
    let fetched_messages = messages.len() as i64;
    let imported_messages = store.import_pop3_messages(account.id, &messages)?;
    let finished_at = Utc::now().to_rfc3339();
    let message = format!(
        "{} POP3 同步完成：检查 {} 封最近邮件，新增 {} 封到收件箱。",
        account.email, fetched_messages, imported_messages
    );
    store.record_sync_run(
        &started_at,
        &finished_at,
        "pop3_headers_account",
        1,
        imported_messages,
        &message,
    )
}

fn sync_imap_headers_for_account(
    store: &MailStore,
    account: &Account,
    history_only: bool,
) -> MailResult<SyncRun> {
    let secret = store.get_account_secret(account)?;
    let started_at = Utc::now().to_rfc3339();
    let mut mailboxes = store.list_imap_mailboxes_for_account(Some(account.id))?;
    if mailboxes.is_empty() {
        let report = imap_probe::discover_folders(account, &secret)?;
        mailboxes = store.save_imap_mailboxes_for_account(Some(account.id), &report.folders)?;
    }
    let (mailboxes, skipped_custom_folders) = syncable_mailboxes(mailboxes);
    if mailboxes.is_empty() {
        return Err(crate::db::MailError::Imap(
            "IMAP 未发现可同步的核心文件夹。".to_string(),
        ));
    }

    let total_mapped_folders = mailboxes.len();
    let mut scanned_folders = 0;
    let mut imported_messages = 0;
    let mut updated_remote_states = 0;
    let mut removed_remote_messages = 0;
    let mut failures = Vec::new();
    let mut completed_history_folders = 0;
    for mailbox in mailboxes {
        if history_only && mailbox.history_complete {
            completed_history_folders += 1;
            continue;
        }
        match imap_probe::fetch_header_page(
            account,
            &secret,
            &mailbox.remote_name,
            imap_probe::ImapHeaderFetchOptions {
                uid_validity: &mailbox.uid_validity,
                highest_uid: mailbox.highest_uid,
                lowest_uid: mailbox.lowest_uid,
                history_complete: mailbox.history_complete,
                include_recent: !history_only,
                include_history: true,
            },
        ) {
            Ok(fetch) => {
                let reconcile = store.reconcile_imap_flag_snapshot(mailbox.id, &fetch.flags);
                let imported = store.import_imap_headers_batch(mailbox.id, &fetch.headers);
                match (reconcile, imported) {
                    (Ok(reconciled), Ok(imported)) => {
                        scanned_folders += 1;
                        imported_messages += imported;
                        updated_remote_states += reconciled.updated_messages;
                        removed_remote_messages += reconciled.removed_messages;
                    }
                    (Err(error), _) | (_, Err(error)) => {
                        failures.push(format!("{}: {error}", mailbox.remote_name));
                    }
                }
            }
            Err(error) => failures.push(format!("{}: {error}", mailbox.remote_name)),
        }
    }

    let finished_at = Utc::now().to_rfc3339();
    let custom_note = if skipped_custom_folders > 0 {
        format!(
            " 跳过 {} 个尚未建立本地映射的自定义目录。",
            skipped_custom_folders
        )
    } else {
        String::new()
    };
    if history_only && scanned_folders == 0 && failures.is_empty() {
        let message = format!(
            "{} 的 {} 个已映射文件夹历史邮件已全部回填。{}",
            account.email, completed_history_folders, custom_note
        );
        return store.record_sync_run(
            &started_at,
            &finished_at,
            "imap_history_complete",
            0,
            0,
            &message,
        );
    }
    if scanned_folders == 0 {
        let message = format!(
            "{} 的 {} 个已映射文件夹{}均失败。{}{}",
            account.email,
            total_mapped_folders,
            if history_only {
                "历史回填"
            } else {
                "同步"
            },
            failures.join("；"),
            custom_note
        );
        store.record_sync_run(
            &started_at,
            &finished_at,
            if history_only {
                "imap_history_account_failed"
            } else {
                "imap_headers_account_failed"
            },
            0,
            0,
            &message,
        )?;
        return Err(crate::db::MailError::Imap(message));
    }

    let (status, message) = if failures.is_empty() {
        (
            if history_only {
                "imap_history_account"
            } else {
                "imap_headers_account"
            },
            if history_only {
                format!(
                    "{} 历史回填完成：扫描 {} 个文件夹，补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录此前已完成。{}",
                    account.email,
                    scanned_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    completed_history_folders,
                    custom_note
                )
            } else {
                format!(
                    "{} 同步完成：扫描 {} 个已映射文件夹，新增或补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封，并推进历史回填。{}",
                    account.email,
                    scanned_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    custom_note
                )
            },
        )
    } else {
        (
            if history_only {
                "imap_history_account_partial"
            } else {
                "imap_headers_account_partial"
            },
            if history_only {
                format!(
                    "{} 历史回填部分完成：扫描 {}/{} 个文件夹，补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录失败：{}。{}",
                    account.email,
                    scanned_folders,
                    total_mapped_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    failures.len(),
                    failures.join("；"),
                    custom_note
                )
            } else {
                format!(
                    "{} 同步部分完成：扫描 {}/{} 个已映射文件夹，新增或补充 {} 封，更新远端状态 {} 封，移除远端已删除邮件 {} 封；{} 个目录失败：{}。{}",
                    account.email,
                    scanned_folders,
                    total_mapped_folders,
                    imported_messages,
                    updated_remote_states,
                    removed_remote_messages,
                    failures.len(),
                    failures.join("；"),
                    custom_note
                )
            },
        )
    };
    store.record_sync_run(
        &started_at,
        &finished_at,
        status,
        scanned_folders,
        imported_messages,
        &message,
    )
}

fn syncable_mailboxes(mailboxes: Vec<ImapMailboxState>) -> (Vec<ImapMailboxState>, usize) {
    let mut syncable = Vec::new();
    let mut skipped_custom = 0;
    for mailbox in mailboxes {
        if SYNCABLE_IMAP_ROLES.contains(&mailbox.local_role.as_str())
            || (mailbox.local_role == "custom" && mailbox.local_folder_id.is_some())
        {
            syncable.push(mailbox);
        } else {
            skipped_custom += 1;
        }
    }
    (syncable, skipped_custom)
}

#[tauri::command]
pub async fn fetch_message_body(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    command_info(format!(
        "[better-email][body] fetch command start message_id={message_id}"
    ));
    let account = store.get_message_account(message_id)?;
    if is_pop3_account(&account) {
        command_info(format!(
            "[better-email][body] fetch command skipped pop3 message_id={} account_id={}",
            message_id, account.id
        ));
        return store.get_message(message_id);
    }
    let secret = store.get_account_secret(&account)?;
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        command_info(format!(
            "[better-email][body] fetch command missing remote ref message_id={} account_id={} mailbox={} uid={}",
            message_id, account.id, remote_mailbox, remote_uid
        ));
        return Err(crate::db::MailError::Imap(
            "该邮件没有远端 UID，无法按需拉取正文。".to_string(),
        ));
    }
    let body = imap_probe::fetch_message_body(&account, &secret, &remote_mailbox, remote_uid)?;
    let updated = store.update_message_body(message_id, &body)?;
    command_info(format!(
        "[better-email][body] fetch command ok message_id={} account_id={} mailbox={} uid={} body_chars={} html_chars={} attachments={}",
        message_id,
        account.id,
        remote_mailbox,
        remote_uid,
        updated.body.chars().count(),
        updated.sanitized_html.chars().count(),
        body.attachments.len()
    ));
    Ok(updated)
}

#[tauri::command]
pub fn list_sync_runs(store: State<'_, MailStore>) -> MailResult<Vec<SyncRun>> {
    store.list_sync_runs()
}

#[cfg(test)]
mod tests {
    use super::{credential_error_report, credential_verification_report, syncable_mailboxes};
    use crate::models::{Account, ImapMailboxState};

    fn sample_account() -> Account {
        Account {
            id: 1,
            email: "me@example.com".to_string(),
            display_name: "Me".to_string(),
            provider: "custom".to_string(),
            imap_host: "imap.example.com:993".to_string(),
            smtp_host: "smtp.example.com:465".to_string(),
            incoming_protocol: "imap".to_string(),
            auth_type: "password".to_string(),
            sync_mode: "manual".to_string(),
            remote_images_allowed: false,
            signature: String::new(),
            is_default: true,
        }
    }

    fn sample_mailbox(id: i64, remote_name: &str, local_role: &str) -> ImapMailboxState {
        ImapMailboxState {
            id,
            account_id: 1,
            account_email: "me@example.com".to_string(),
            remote_name: remote_name.to_string(),
            delimiter: "/".to_string(),
            attributes: String::new(),
            local_role: local_role.to_string(),
            local_folder_id: None,
            local_folder_name: String::new(),
            uid_validity: String::new(),
            highest_uid: 0,
            lowest_uid: 0,
            history_complete: false,
            history_last_sync_at: String::new(),
            last_seen_at: String::new(),
            last_sync_at: String::new(),
        }
    }

    #[test]
    fn credential_verification_report_tracks_success_and_partial_failure() {
        let account = sample_account();
        let success = credential_verification_report(&account, Ok(()), Ok(()));
        assert!(success.authenticated);
        assert_eq!(success.status, "ok");
        assert!(success.checks.iter().all(|check| check.authenticated));

        let partial =
            credential_verification_report(&account, Ok(()), Err("SMTP 登录验证失败".to_string()));
        assert!(!partial.authenticated);
        assert_eq!(partial.status, "partial");
        assert!(partial.checks[0].authenticated);
        assert!(!partial.checks[1].authenticated);
        assert!(partial.checks[1].message.contains("SMTP 登录验证失败"));

        let missing = credential_error_report(&account, "未读取到本地凭据".to_string());
        assert_eq!(missing.status, "credential_error");
        assert!(!missing.authenticated);
        assert!(missing.message.contains("未发起"));
    }

    #[test]
    fn syncable_mailboxes_keep_core_and_mapped_custom_roles() {
        let roles = [
            ("INBOX", "inbox"),
            ("Sent", "sent"),
            ("Drafts", "drafts"),
            ("Archive", "archive"),
            ("Trash", "trash"),
            ("Junk", "spam"),
            ("Projects/Alpha", "custom"),
        ];
        let mut mailboxes = roles
            .into_iter()
            .enumerate()
            .map(|(index, (remote_name, local_role))| {
                sample_mailbox(index as i64 + 1, remote_name, local_role)
            })
            .collect::<Vec<_>>();
        mailboxes.push(ImapMailboxState {
            local_folder_id: Some(42),
            local_folder_name: "项目 Alpha".to_string(),
            ..sample_mailbox(8, "Projects/Mapped", "custom")
        });

        let (mapped, skipped_custom) = syncable_mailboxes(mailboxes);

        assert_eq!(mapped.len(), 7);
        assert_eq!(skipped_custom, 1);
        assert!(mapped
            .iter()
            .any(|mailbox| mailbox.local_folder_name == "项目 Alpha"));
    }
}
