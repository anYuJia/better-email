use super::common::{command_info, mask_email, mask_recipient_list};
use crate::credentials;
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{
    Account, DraftInput, DraftSaveReport, MessageThreadingInput, OutboundMessage, OutboxItem,
};
use crate::smtp;
use tauri::State;
#[tauri::command]
pub fn save_draft(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<DraftSaveReport> {
    let was_update = input.draft_id > 0;
    let previous_reference = if was_update {
        Some(store.get_message_remote_reference(input.draft_id)?)
    } else {
        None
    };
    let draft_id = store.save_draft(input)?;
    store.set_message_threading(draft_id, threading)?;
    let message = store.get_outbound_message(draft_id)?;
    let message_id_header = smtp::outbound_message_id(&message);
    let account = store.get_account_by_id(Some(message.account_id))?;
    let local_action = if was_update {
        "草稿已更新"
    } else {
        "草稿已保存"
    };
    let Some(remote_mailbox) = store.remote_mailbox_for_account_role(account.id, "drafts")? else {
        return Ok(DraftSaveReport {
            draft_id,
            remote_attempted: false,
            remote_synced: false,
            remote_mailbox: String::new(),
            remote_uid: 0,
            message: format!("{local_action}到本地；未发现已映射的远端草稿目录。"),
        });
    };

    if let Some(previous) = previous_reference.as_ref() {
        let previous_mailbox = if previous.remote_mailbox.trim().is_empty() {
            store
                .remote_mailbox_for_account_role(previous.account_id, "drafts")?
                .unwrap_or_default()
        } else {
            previous.remote_mailbox.clone()
        };
        let moved_between_mailboxes = previous.account_id != account.id
            || (!previous_mailbox.trim().is_empty()
                && previous_mailbox.trim() != remote_mailbox.trim());
        if moved_between_mailboxes
            && !previous_mailbox.trim().is_empty()
            && (previous.remote_uid > 0 || !previous.message_id_header.trim().is_empty())
        {
            let previous_account = store.get_account_by_id(Some(previous.account_id))?;
            let previous_secret = match store.get_account_secret(&previous_account) {
                Ok(secret) => secret,
                Err(error) => {
                    return Ok(DraftSaveReport {
                        draft_id,
                        remote_attempted: false,
                        remote_synced: false,
                        remote_mailbox,
                        remote_uid: 0,
                        message: format!(
                            "{local_action}到本地；读取旧账号凭据以清理远端草稿失败：{error}"
                        ),
                    });
                }
            };
            let candidates = [imap_probe::RemoteDeleteCandidate {
                remote_uid: previous.remote_uid,
                message_id_header: previous.message_id_header.clone(),
            }];
            if let Err(error) = imap_probe::delete_remote_messages(
                &previous_account,
                &previous_secret,
                &previous_mailbox,
                &candidates,
            ) {
                return Ok(DraftSaveReport {
                    draft_id,
                    remote_attempted: true,
                    remote_synced: false,
                    remote_mailbox,
                    remote_uid: 0,
                    message: format!("{local_action}到本地；清理旧远端草稿失败：{error}"),
                });
            }
        }
    }

    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(DraftSaveReport {
                draft_id,
                remote_attempted: false,
                remote_synced: false,
                remote_mailbox,
                remote_uid: 0,
                message: format!("{local_action}到本地；读取凭据以同步远端草稿失败：{error}"),
            });
        }
    };
    let raw_message = match smtp::render_outbound(&message) {
        Ok(raw_message) => raw_message,
        Err(error) => {
            return Ok(DraftSaveReport {
                draft_id,
                remote_attempted: false,
                remote_synced: false,
                remote_mailbox,
                remote_uid: 0,
                message: format!("{local_action}到本地；构建远端草稿 MIME 失败：{error}"),
            });
        }
    };
    let previous_message_id_header = previous_reference
        .as_ref()
        .filter(|previous| previous.account_id == account.id)
        .map(|previous| previous.message_id_header.as_str())
        .unwrap_or_default();
    match imap_probe::replace_draft_message(
        &account,
        &secret,
        &remote_mailbox,
        previous_message_id_header,
        &message_id_header,
        &raw_message,
    ) {
        Ok(result) => {
            store.set_message_remote_identity(
                draft_id,
                &remote_mailbox,
                result.remote_uid,
                &message_id_header,
            )?;
            Ok(DraftSaveReport {
                draft_id,
                remote_attempted: true,
                remote_synced: true,
                remote_mailbox,
                remote_uid: result.remote_uid,
                message: format!("{local_action}并同步到远端草稿箱。"),
            })
        }
        Err(error) => Ok(DraftSaveReport {
            draft_id,
            remote_attempted: true,
            remote_synced: false,
            remote_mailbox,
            remote_uid: 0,
            message: format!("{local_action}到本地；远端草稿同步失败：{error}"),
        }),
    }
}

#[tauri::command]
pub async fn send_message(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<i64> {
    let started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][send] direct smtp start account_id={} to={} subject_len={} attachments={}",
        input.account_id,
        mask_recipient_list(&input.to),
        input.subject.trim().chars().count(),
        input.attachments.len(),
    ));
    let message_id = store.send_message(input)?;
    store.set_message_threading(message_id, threading)?;
    let message = store.get_outbound_message(message_id)?;
    let account = store.get_account_by_id(Some(message.account_id))?;
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            let blocked_error =
                "缺少账号授权码，请在账号设置中重新保存授权码；邮件已留在发件箱。".to_string();
            crate::logging::log_line(format!(
                "[better-email][send] direct smtp credential missing message_id={} account_id={} email={} error={}",
                message_id,
                message.account_id,
                mask_email(&account.email),
                error,
            ));
            store.mark_outbox_blocked(message_id, &blocked_error)?;
            return Err(crate::db::MailError::Smtp(blocked_error));
        }
    };
    let raw_message = match smtp::send_outbound(&account, &message, &secret) {
        Ok(raw_message) => raw_message,
        Err(error) => {
            let error_message = error.to_string();
            crate::logging::log_line(format!(
                "[better-email][send] direct smtp failed message_id={} account_id={} error={}",
                message_id, message.account_id, error,
            ));
            store.mark_outbox_failed(message_id, &error_message)?;
            return Err(error);
        }
    };
    let message_id_header = smtp::outbound_message_id(&message);
    store.mark_outbox_smtp_sent_pending_archive(message_id, &message_id_header)?;
    archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
    command_info(format!(
        "[better-email][send] direct smtp ok message_id={} account_id={} duration_ms={}",
        message_id,
        message.account_id,
        started_at.elapsed().as_millis(),
    ));
    Ok(message_id)
}

#[tauri::command]
pub fn queue_outbox_message(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<OutboxItem> {
    let started_at = std::time::Instant::now();
    command_info(format!(
        "[better-email][send] queue start account_id={} to={} send_at={} attachments={}",
        input.account_id,
        mask_recipient_list(&input.to),
        if input.send_at.trim().is_empty() {
            "now"
        } else {
            "scheduled"
        },
        input.attachments.len(),
    ));
    let item = store.queue_outbox_message(input)?;
    store.set_message_threading(item.message_id, threading)?;
    command_info(format!(
        "[better-email][send] queue ok outbox_id={} message_id={} status={} duration_ms={}",
        item.id,
        item.message_id,
        item.status,
        started_at.elapsed().as_millis(),
    ));
    Ok(item)
}

#[tauri::command]
pub fn cancel_outbox_item(store: State<'_, MailStore>, outbox_id: i64) -> MailResult<OutboxItem> {
    store.cancel_outbox_item(outbox_id)
}

#[tauri::command]
pub fn list_outbox(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    store.list_outbox()
}

#[tauri::command]
pub fn flush_outbox_dry_run(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    store.flush_outbox_dry_run()
}

#[tauri::command]
pub fn release_due_outbox_items(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    command_info("[better-email][send] release due outbox start");
    let outbox = store.release_due_outbox_items()?;
    command_info(format!(
        "[better-email][send] release due outbox done outbox_items={}",
        outbox.len(),
    ));
    Ok(outbox)
}

fn archive_sent_message(
    store: &MailStore,
    account: &Account,
    secret: &credentials::AccountSecret,
    message: &OutboundMessage,
    raw_message: &[u8],
) -> MailResult<()> {
    let Some(remote_name) = store.remote_mailbox_for_account_role(account.id, "sent")? else {
        return store.mark_outbox_remote_archive_failed(
            message.id,
            "SMTP 已发送；未发现已映射的远端已发送目录，稍后仅重试留档。",
        );
    };
    let message_id_header = smtp::outbound_message_id(message);
    match imap_probe::append_sent_message(
        account,
        secret,
        &remote_name,
        &message_id_header,
        raw_message,
    ) {
        Ok(result) => {
            store.mark_outbox_remote_archived(message.id, &remote_name, result.remote_uid)
        }
        Err(error) => store.mark_outbox_remote_archive_failed(
            message.id,
            &format!("SMTP 已发送；远端已发送留档失败：{error}"),
        ),
    }
}

fn retry_pending_remote_archives(store: &MailStore) -> MailResult<()> {
    for message in store.pending_remote_archive_messages()? {
        let account = store.get_account_by_id(Some(message.account_id))?;
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                store.mark_outbox_remote_archive_failed(
                    message.id,
                    &format!("SMTP 已发送；读取凭据以重试远端留档失败：{error}"),
                )?;
                continue;
            }
        };
        let raw_message = match smtp::render_outbound(&message) {
            Ok(raw_message) => raw_message,
            Err(error) => {
                store.mark_outbox_remote_archive_failed(
                    message.id,
                    &format!("SMTP 已发送；重建原始邮件以重试远端留档失败：{error}"),
                )?;
                continue;
            }
        };
        archive_sent_message(store, &account, &secret, &message, &raw_message)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn flush_outbox_smtp(store: State<'_, MailStore>) -> MailResult<Vec<OutboxItem>> {
    let started_at = std::time::Instant::now();
    command_info("[better-email][send] flush smtp start");
    retry_pending_remote_archives(store.inner())?;

    for message in store.pending_outbox_messages()? {
        let account = store.get_account_by_id(Some(message.account_id))?;
        command_info(format!(
            "[better-email][send] smtp item start message_id={} account_id={} email={} to={} attachments={}",
            message.id,
            message.account_id,
            mask_email(&account.email),
            mask_recipient_list(&message.recipients),
            message.attachments.len(),
        ));
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                let blocked_error =
                    "缺少账号授权码，请在账号设置中重新保存授权码；已暂停自动发送。".to_string();
                crate::logging::log_line(format!(
                    "[better-email][send] smtp item credential blocked message_id={} account_id={} email={} error={}",
                    message.id,
                    message.account_id,
                    mask_email(&account.email),
                    error,
                ));
                store.mark_outbox_blocked(message.id, &blocked_error)?;
                continue;
            }
        };
        match smtp::send_outbound(&account, &message, &secret) {
            Ok(raw_message) => {
                let message_id_header = smtp::outbound_message_id(&message);
                store.mark_outbox_smtp_sent_pending_archive(message.id, &message_id_header)?;
                archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
                command_info(format!(
                    "[better-email][send] smtp item ok message_id={} account_id={}",
                    message.id, message.account_id,
                ));
            }
            Err(error) => {
                crate::logging::log_line(format!(
                    "[better-email][send] smtp item failed message_id={} account_id={} error={}",
                    message.id, message.account_id, error,
                ));
                store.mark_outbox_failed(message.id, &error.to_string())?;
            }
        }
    }

    let outbox = store.list_outbox()?;
    command_info(format!(
        "[better-email][send] flush smtp done outbox_items={} duration_ms={}",
        outbox.len(),
        started_at.elapsed().as_millis(),
    ));
    Ok(outbox)
}
