use super::common::is_pop3_account;
use crate::db::{MailError, MailResult, MailStore, MessageRemoteRef};
use crate::imap_probe;
use crate::models::{
    FolderReadReport, Message, MessageSummary, ParsedMessagePreview, PendingRemoteWrite,
    RawMessageInput, ReleasedSnoozedCount, RemoteActionReport, RemoteImageTrust,
    RemoteImageTrustInput, RestoreMessageReport, ThreadSummary, TrashActionReport,
};
use crate::protocol;
use std::collections::BTreeMap;
use tauri::State;
#[tauri::command]
pub fn list_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    offset: Option<i64>,
    limit: i64,
) -> MailResult<Vec<MessageSummary>> {
    store.list_messages_for_scope_sorted_page(
        account_id,
        folder_id.unwrap_or_default(),
        query,
        filter,
        sort,
        offset.unwrap_or_default(),
        limit,
    )
}

#[tauri::command]
pub fn list_provider_write_validation_messages(
    store: State<'_, MailStore>,
    account_id: i64,
    validation_id: String,
) -> MailResult<Vec<Message>> {
    store.list_provider_write_validation_messages(account_id, validation_id)
}

#[tauri::command]
pub fn list_thread_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    thread_key: String,
    limit: i64,
) -> MailResult<Vec<MessageSummary>> {
    store.list_thread_messages(account_id, thread_key, limit)
}

#[tauri::command]
pub fn get_message_detail(store: State<'_, MailStore>, message_id: i64) -> MailResult<Message> {
    store.message_with_remote_image_policy(message_id)
}

#[tauri::command]
pub fn set_threads_muted(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
    muted: bool,
) -> MailResult<i64> {
    store.set_threads_muted_for_messages(&message_ids, muted)
}

#[tauri::command]
pub fn list_muted_thread_keys(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Vec<String>> {
    store.list_muted_thread_keys(account_id)
}

#[tauri::command]
pub fn list_pending_remote_writes(
    store: State<'_, MailStore>,
) -> MailResult<Vec<PendingRemoteWrite>> {
    store.list_pending_remote_writes()
}

#[tauri::command]
pub fn list_messages_by_ids(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
) -> MailResult<Vec<Message>> {
    store.list_messages_by_ids(&message_ids)
}

#[tauri::command]
pub fn list_remote_image_trusts(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<RemoteImageTrust>> {
    store.list_remote_image_trusts(account_id)
}

#[tauri::command]
pub fn trust_remote_images(
    store: State<'_, MailStore>,
    input: RemoteImageTrustInput,
) -> MailResult<RemoteImageTrust> {
    store.upsert_remote_image_trust(input)
}

#[tauri::command]
pub fn delete_remote_image_trust(store: State<'_, MailStore>, trust_id: i64) -> MailResult<()> {
    store.delete_remote_image_trust(trust_id)
}

#[tauri::command]
pub fn render_message_with_remote_image_policy(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    store.message_with_remote_image_policy(message_id)
}

#[tauri::command]
pub fn render_message_with_remote_images_once(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    store.persist_message_remote_images_once(message_id)
}

#[tauri::command]
pub async fn set_message_read(
    store: State<'_, MailStore>,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    store.set_message_read(message_id, is_read)?;
    sync_remote_seen(&store, message_id, is_read)
}

#[tauri::command]
pub async fn mark_folder_read(
    store: State<'_, MailStore>,
    folder_id: i64,
    role: String,
    is_virtual: bool,
) -> MailResult<FolderReadReport> {
    let unread_messages = store.mark_folder_read(folder_id, &role, is_virtual)?;
    let updated_count = unread_messages.len() as i64;
    if unread_messages.is_empty() {
        return Ok(FolderReadReport {
            updated_count: 0,
            remote_attempted_count: 0,
            remote_applied_count: 0,
            remote_skipped_count: 0,
            remote_failed_count: 0,
            message: "该文件夹没有未读邮件。".to_string(),
        });
    }

    let mut groups = BTreeMap::<(i64, String), Vec<i64>>::new();
    let mut remote_skipped_count = 0_i64;
    for reference in unread_messages {
        if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
            remote_skipped_count += 1;
            continue;
        }
        groups
            .entry((reference.account_id, reference.remote_mailbox))
            .or_default()
            .push(reference.remote_uid);
    }

    let mut remote_attempted_count = 0_i64;
    let mut remote_applied_count = 0_i64;
    let mut remote_failed_count = 0_i64;
    for ((account_id, remote_mailbox), remote_uids) in groups {
        let account = match store.get_account_by_id(Some(account_id)) {
            Ok(account) => account,
            Err(_) => {
                remote_skipped_count += remote_uids.len() as i64;
                continue;
            }
        };
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(_) => {
                remote_skipped_count += remote_uids.len() as i64;
                continue;
            }
        };
        let group_count = remote_uids.len() as i64;
        remote_attempted_count += group_count;
        match imap_probe::set_remote_seen_batch(
            &account,
            &secret,
            &remote_mailbox,
            &remote_uids,
            true,
        ) {
            Ok(()) => remote_applied_count += group_count,
            Err(_) => remote_failed_count += group_count,
        }
    }

    let message = if remote_failed_count > 0 {
        format!(
            "已将 {updated_count} 封邮件标为已读；远端同步成功 {remote_applied_count} 封，失败 {remote_failed_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else if remote_attempted_count > 0 {
        format!(
            "已将 {updated_count} 封邮件标为已读；远端同步成功 {remote_applied_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else {
        format!(
            "已将 {updated_count} 封邮件标为已读；{remote_skipped_count} 封没有可用远端状态，已保留本地结果。"
        )
    };

    Ok(FolderReadReport {
        updated_count,
        remote_attempted_count,
        remote_applied_count,
        remote_skipped_count,
        remote_failed_count,
        message,
    })
}

#[tauri::command]
pub async fn set_message_starred(
    store: State<'_, MailStore>,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    store.set_message_starred(message_id, is_starred)?;
    sync_remote_flagged(&store, message_id, is_starred)
}

#[tauri::command]
pub async fn move_message_to_role(
    store: State<'_, MailStore>,
    message_id: i64,
    role: String,
) -> MailResult<RemoteActionReport> {
    store.move_message_to_role(message_id, &role)?;
    sync_remote_move(&store, message_id, &role)
}

#[tauri::command]
pub async fn restore_message_to_inbox(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RestoreMessageReport> {
    store.restore_message_to_inbox(message_id)?;
    let mut remote = sync_remote_move(&store, message_id, "inbox")?;
    remote.message = remote
        .message
        .replacen("本地已移动", "本地已恢复到收件箱", 1);
    Ok(RestoreMessageReport {
        restored: store.get_message(message_id)?,
        remote,
    })
}

#[tauri::command]
pub async fn delete_message_permanently(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RemoteActionReport> {
    let reference = store.delete_message_permanently(message_id)?;
    // 草稿/邮件被永久删除后，其临时附件不再被任何草稿/发件箱引用，立即清理。
    let _ = store.prune_temp_attachments(std::time::Duration::from_secs(0));
    sync_remote_delete_reference(&store, &reference, "本地已永久删除")
}

#[tauri::command]
pub async fn empty_trash(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<TrashActionReport> {
    let (local_deleted_count, references) = store.empty_trash_for_account(account_id)?;
    // 数据库删除已经提交，引用关系随之消失；立即回收不再被任何草稿/发件状态
    // 引用的临时附件。远端删除失败不影响本地生命周期状态。
    let _ = store.prune_temp_attachments(std::time::Duration::from_secs(0));
    let mut groups = BTreeMap::<(i64, String), Vec<MessageRemoteRef>>::new();
    let mut remote_skipped_count = 0_i64;
    for reference in references {
        if reference.remote_mailbox.trim().is_empty() {
            remote_skipped_count += 1;
            continue;
        }
        groups
            .entry((reference.account_id, reference.remote_mailbox.clone()))
            .or_default()
            .push(reference);
    }

    let mut remote_attempted_count = 0_i64;
    let mut remote_applied_count = 0_i64;
    let mut remote_failed_count = 0_i64;
    for ((account_id, remote_mailbox), references) in groups {
        let group_count = references.len() as i64;
        let account = match store.get_account_by_id(Some(account_id)) {
            Ok(account) => account,
            Err(_) => {
                remote_skipped_count += group_count;
                continue;
            }
        };
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(_) => {
                remote_skipped_count += group_count;
                continue;
            }
        };
        remote_attempted_count += group_count;
        let candidates = references
            .iter()
            .map(|reference| imap_probe::RemoteDeleteCandidate {
                remote_uid: reference.remote_uid,
                message_id_header: reference.message_id_header.clone(),
            })
            .collect::<Vec<_>>();
        match imap_probe::delete_remote_messages(&account, &secret, &remote_mailbox, &candidates) {
            Ok(result) => {
                remote_applied_count += result.deleted_count;
                remote_skipped_count += result.skipped_count;
            }
            Err(_) => remote_failed_count += group_count,
        }
    }

    let message = if local_deleted_count == 0 {
        "废纸篓已经为空。".to_string()
    } else if remote_failed_count > 0 {
        format!(
            "本地已永久删除 {local_deleted_count} 封；远端成功 {remote_applied_count} 封，失败 {remote_failed_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else if remote_attempted_count > 0 {
        format!(
            "本地已永久删除 {local_deleted_count} 封；远端成功 {remote_applied_count} 封，跳过 {remote_skipped_count} 封。"
        )
    } else {
        format!(
            "本地已永久删除 {local_deleted_count} 封；{remote_skipped_count} 封没有可用远端状态。"
        )
    };

    Ok(TrashActionReport {
        local_deleted_count,
        remote_attempted_count,
        remote_applied_count,
        remote_skipped_count,
        remote_failed_count,
        message,
    })
}

#[tauri::command]
pub fn snooze_message(
    store: State<'_, MailStore>,
    message_id: i64,
    snoozed_until: String,
) -> MailResult<Message> {
    store.snooze_message(message_id, &snoozed_until)
}

#[tauri::command]
pub fn snooze_messages(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
    snoozed_until: String,
) -> MailResult<Vec<Message>> {
    store.snooze_messages(&message_ids, &snoozed_until)
}

#[tauri::command]
pub fn unsnooze_message(store: State<'_, MailStore>, message_id: i64) -> MailResult<Message> {
    store.unsnooze_message(message_id)
}

#[tauri::command]
pub fn release_due_snoozed_messages(
    store: State<'_, MailStore>,
    now: String,
) -> MailResult<ReleasedSnoozedCount> {
    store.release_due_snoozed_messages(&now)
}

#[tauri::command]
pub fn apply_label_to_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    store.apply_label_to_message(message_id, label_id)
}

#[tauri::command]
pub fn remove_label_from_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    store.remove_label_from_message(message_id, label_id)
}

#[tauri::command]
pub fn parse_raw_message(input: RawMessageInput) -> ParsedMessagePreview {
    protocol::parse_message_preview(&input.raw)
}

fn sync_remote_seen(
    store: &MailStore,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Ok(local_only_report(
            "本地已更新；该邮件没有远端 UID，跳过远端已读回写。",
        ));
    }
    let account = store.get_message_account(message_id)?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地已更新；POP3 不支持远端已读状态回写。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已更新；无法读取本地凭据，远端已读回写已跳过：{error}"
            )));
        }
    };
    match imap_probe::set_remote_seen(&account, &secret, &remote_mailbox, remote_uid, is_read) {
        Ok(()) => {
            let _ = store.clear_pending_remote_write(message_id, "seen");
            Ok(remote_ok_report(if is_read {
                "本地已标为已读，远端 \\Seen 状态已同步。"
            } else {
                "本地已标为未读，远端 \\Seen 状态已同步。"
            }))
        }
        Err(error) => {
            // 写回失败：记录待处理意图，避免下次同步静默撤销本地已读状态。
            let _ = store.record_pending_remote_write(
                message_id,
                "seen",
                if is_read { "1" } else { "0" },
            );
            Ok(remote_failed_report(format!(
                "本地已更新；远端已读状态回写失败：{error}"
            )))
        }
    }
}

fn sync_remote_flagged(
    store: &MailStore,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    let (remote_mailbox, remote_uid) = store.get_message_remote_ref(message_id)?;
    if remote_mailbox.trim().is_empty() || remote_uid <= 0 {
        return Ok(local_only_report(
            "本地星标已更新；该邮件没有远端 UID，跳过远端星标回写。",
        ));
    }
    let account = store.get_message_account(message_id)?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地星标已更新；POP3 不支持远端星标回写。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地星标已更新；无法读取本地凭据，远端星标回写已跳过：{error}"
            )));
        }
    };
    match imap_probe::set_remote_flagged(&account, &secret, &remote_mailbox, remote_uid, is_starred)
    {
        Ok(()) => {
            let _ = store.clear_pending_remote_write(message_id, "flagged");
            Ok(remote_ok_report(if is_starred {
                "本地已添加星标，远端 \\Flagged 状态已同步。"
            } else {
                "本地已取消星标，远端 \\Flagged 状态已同步。"
            }))
        }
        Err(error) => {
            // 写回失败：记录待处理意图，避免下次同步静默撤销本地星标。
            let _ = store.record_pending_remote_write(
                message_id,
                "flagged",
                if is_starred { "1" } else { "0" },
            );
            Ok(remote_failed_report(format!(
                "本地星标已更新；远端星标状态回写失败：{error}"
            )))
        }
    }
}

fn sync_remote_move(
    store: &MailStore,
    message_id: i64,
    role: &str,
) -> MailResult<RemoteActionReport> {
    let reference = store.get_message_remote_reference(message_id)?;
    if reference.remote_mailbox.trim().is_empty()
        || (reference.remote_uid <= 0 && reference.message_id_header.trim().is_empty())
    {
        return Ok(local_only_report(
            "本地已移动；该邮件没有远端 UID，跳过远端移动。",
        ));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地已移动；POP3 不支持远端移动，远端邮件保持不变。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已移动；无法读取本地凭据，远端移动已跳过：{error}"
            )));
        }
    };
    let target = store.remote_mailbox_for_account_role(account.id, role)?;
    match target {
        Some(target_mailbox) => match imap_probe::move_remote_message(
            &account,
            &secret,
            &reference.remote_mailbox,
            reference.remote_uid,
            &target_mailbox,
            &reference.message_id_header,
        ) {
            Ok(target_uid) => {
                let _ = store.clear_pending_remote_write(message_id, "move");
                store.set_message_remote_ref(
                    message_id,
                    &target_mailbox,
                    target_uid.unwrap_or(0),
                )?;
                Ok(remote_ok_report(if target_uid.is_some() {
                    format!("本地已移动；远端邮件已移动到 {target_mailbox}，UID 已重绑定。")
                } else {
                    format!(
                        "本地已移动；远端邮件已移动到 {target_mailbox}，目标 UID 将在下次同步时重绑定。"
                    )
                }))
            }
            Err(error) => {
                // 写回失败：记录待处理移动意图，避免下次同步把本地文件夹拉回原目录。
                let _ = store.record_pending_remote_write(message_id, "move", role);
                Ok(remote_failed_report(format!(
                    "本地已移动；远端移动失败：{error}"
                )))
            }
        },
        None if role == "trash" => {
            let candidates = [imap_probe::RemoteDeleteCandidate {
                remote_uid: reference.remote_uid,
                message_id_header: reference.message_id_header.clone(),
            }];
            match imap_probe::delete_remote_messages(
                &account,
                &secret,
                &reference.remote_mailbox,
                &candidates,
            ) {
                Ok(result) if result.deleted_count == 1 => {
                    store.set_message_remote_ref(message_id, "", 0)?;
                    Ok(remote_ok_report(
                        "本地已移到废纸篓；远端没有废纸篓映射，邮件已直接删除并 expunge。",
                    ))
                }
                Ok(_) => Ok(remote_skipped_report(
                    "本地已移到废纸篓；远端邮件无法唯一定位，删除已跳过。",
                )),
                Err(error) => Ok(remote_failed_report(format!(
                    "本地已移到废纸篓；远端删除失败：{error}"
                ))),
            }
        }
        None => Ok(remote_skipped_report(format!(
            "本地已移动；未发现角色 {role} 对应的远端文件夹，远端移动已跳过。"
        ))),
    }
}

fn sync_remote_delete_reference(
    store: &MailStore,
    reference: &MessageRemoteRef,
    local_action: &str,
) -> MailResult<RemoteActionReport> {
    if reference.remote_mailbox.trim().is_empty()
        || (reference.remote_uid <= 0 && reference.message_id_header.trim().is_empty())
    {
        return Ok(local_only_report(format!(
            "{local_action}；该邮件没有可用远端状态，跳过远端删除。"
        )));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(format!(
            "{local_action}；POP3 不执行远端删除，远端邮件保持不变。"
        )));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "{local_action}；无法读取本地凭据，远端删除已跳过：{error}"
            )));
        }
    };
    let candidates = [imap_probe::RemoteDeleteCandidate {
        remote_uid: reference.remote_uid,
        message_id_header: reference.message_id_header.clone(),
    }];
    match imap_probe::delete_remote_messages(
        &account,
        &secret,
        &reference.remote_mailbox,
        &candidates,
    ) {
        Ok(result) if result.deleted_count == 1 => Ok(remote_ok_report(format!(
            "{local_action}；远端邮件已标记删除并 expunge。"
        ))),
        Ok(_) => Ok(remote_skipped_report(format!(
            "{local_action}；远端邮件无法唯一定位，删除已跳过。"
        ))),
        Err(error) => Ok(remote_failed_report(format!(
            "{local_action}；远端删除失败：{error}"
        ))),
    }
}

fn local_only_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: message.into(),
    }
}

fn remote_skipped_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: false,
        remote_applied: false,
        message: message.into(),
    }
}

fn remote_ok_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: true,
        remote_applied: true,
        message: message.into(),
    }
}

fn remote_failed_report(message: impl Into<String>) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: true,
        remote_attempted: true,
        remote_applied: false,
        message: message.into(),
    }
}

#[tauri::command]
pub async fn list_threads(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    limit: i64,
) -> MailResult<Vec<ThreadSummary>> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.list_threads_for_scope_sorted(account_id, folder_id, query, filter, sort, limit)
    })
    .await
    .map_err(|error| {
        MailError::Io(std::io::Error::other(format!(
            "list_threads task failed: {error}"
        )))
    })?
}
