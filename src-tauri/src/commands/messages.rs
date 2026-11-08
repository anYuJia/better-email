use super::common::is_pop3_account;
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{
    FolderReadReport, Message, MessageSummary, PendingRemoteWrite, ReleasedSnoozedCount,
    RemoteActionReport, RemoteImageTrust, RemoteImageTrustInput, RestoreMessageReport,
    ThreadSummary, TrashActionReport,
};
use once_cell::sync::Lazy;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, Weak};
use tauri::State;

static REMOTE_WRITE_LOCKS: Lazy<Mutex<HashMap<i64, Weak<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RETRY_OFFSETS: Lazy<Mutex<HashMap<(std::path::PathBuf, i64), usize>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static ACCOUNT_SNAPSHOT_LOCKS: Lazy<Mutex<HashMap<i64, Weak<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(super) fn account_snapshot_lock(account_id: i64) -> Arc<Mutex<()>> {
    let mut locks = ACCOUNT_SNAPSHOT_LOCKS
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&account_id).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(account_id, Arc::downgrade(&lock));
    lock
}
fn remote_write_lock(message_id: i64) -> Arc<Mutex<()>> {
    let mut locks = REMOTE_WRITE_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&message_id).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(message_id, Arc::downgrade(&lock));
    lock
}
#[tauri::command]
// The IPC contract intentionally keeps scope, search, sort, and paging fields
// flat so the generated command schema remains backwards-compatible.
#[allow(clippy::too_many_arguments)]
pub async fn list_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
    sort: Option<String>,
    offset: Option<i64>,
    limit: i64,
) -> MailResult<Vec<MessageSummary>> {
    let store = store.inner().clone();
    super::executor::database(move || {
        store.list_messages_for_scope_sorted_page(
            account_id,
            folder_id.unwrap_or_default(),
            query,
            filter,
            sort,
            offset.unwrap_or_default(),
            limit,
        )
    })
    .await
}

#[tauri::command]
pub async fn list_provider_write_validation_messages(
    store: State<'_, MailStore>,
    account_id: i64,
    validation_id: String,
) -> MailResult<Vec<Message>> {
    let store = store.inner().clone();
    super::executor::database(move || {
        store.list_provider_write_validation_messages(account_id, validation_id)
    })
    .await
}

#[tauri::command]
pub async fn list_thread_messages(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    thread_key: String,
    limit: i64,
) -> MailResult<Vec<MessageSummary>> {
    let store = store.inner().clone();
    super::executor::database(move || store.list_thread_messages(account_id, thread_key, limit))
        .await
}

#[tauri::command]
pub async fn get_message_detail(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    let store = store.inner().clone();
    super::executor::database(move || store.message_with_remote_image_policy(message_id)).await
}

#[tauri::command]
pub async fn set_threads_muted(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
    muted: bool,
) -> MailResult<i64> {
    let store = store.inner().clone();
    super::executor::database(move || store.set_threads_muted_for_messages(&message_ids, muted))
        .await
}

#[tauri::command]
pub async fn list_muted_thread_keys(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Vec<String>> {
    let store = store.inner().clone();
    super::executor::database(move || store.list_muted_thread_keys(account_id)).await
}

#[derive(serde::Serialize)]
pub struct DetachedPendingWrite {
    #[serde(flatten)]
    pending: PendingRemoteWrite,
    subject: String,
}

#[tauri::command]
pub async fn list_detached_pending_writes(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Vec<DetachedPendingWrite>> {
    let store = store.inner().clone();
    super::executor::database(move || {
        Ok(store
            .list_detached_pending_writes(account_id)?
            .into_iter()
            .map(|(pending, subject)| DetachedPendingWrite { pending, subject })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn discard_detached_pending_write(
    store: State<'_, MailStore>,
    account_id: i64,
    pending: PendingRemoteWrite,
) -> MailResult<bool> {
    let store = store.inner().clone();
    super::executor::database(move || store.discard_detached_pending_write(account_id, &pending))
        .await
}

#[tauri::command]
pub async fn list_pending_remote_writes(
    store: State<'_, MailStore>,
) -> MailResult<Vec<PendingRemoteWrite>> {
    let store = store.inner().clone();
    super::executor::database(move || store.list_pending_remote_writes()).await
}

#[tauri::command]
pub async fn list_messages_by_ids(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
) -> MailResult<Vec<Message>> {
    let store = store.inner().clone();
    super::executor::database(move || store.list_messages_by_ids(&message_ids)).await
}

#[tauri::command]
pub async fn list_remote_image_trusts(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<RemoteImageTrust>> {
    let store = store.inner().clone();
    super::executor::database(move || store.list_remote_image_trusts(account_id)).await
}

#[tauri::command]
pub async fn trust_remote_images(
    store: State<'_, MailStore>,
    input: RemoteImageTrustInput,
) -> MailResult<RemoteImageTrust> {
    let store = store.inner().clone();
    super::executor::database(move || store.upsert_remote_image_trust(input)).await
}

#[tauri::command]
pub async fn delete_remote_image_trust(
    store: State<'_, MailStore>,
    trust_id: i64,
) -> MailResult<()> {
    let store = store.inner().clone();
    super::executor::database(move || store.delete_remote_image_trust(trust_id)).await
}

#[tauri::command]
pub async fn render_message_with_remote_image_policy(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    let store = store.inner().clone();
    super::executor::database(move || store.message_with_remote_image_policy(message_id)).await
}

#[tauri::command]
pub async fn render_message_with_remote_images_once(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<Message> {
    let store = store.inner().clone();
    super::executor::database(move || store.persist_message_remote_images_once(message_id)).await
}

#[tauri::command]
pub async fn set_message_read(
    store: State<'_, MailStore>,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    let store = store.inner().clone();
    let lookup = store.clone();
    let account_id = super::executor::database(move || {
        lookup
            .get_message_account(message_id)
            .map(|account| account.id)
    })
    .await?;
    super::executor::network(account_id, move || {
        store.apply_local_remote_intent(message_id, "seen", if is_read { "1" } else { "0" })?;
        sync_remote_seen(&store, message_id, is_read)
    })
    .await
}

#[tauri::command]
pub async fn mark_folder_read(
    store: State<'_, MailStore>,
    folder_id: i64,
    role: String,
    is_virtual: bool,
) -> MailResult<FolderReadReport> {
    let store = store.inner().clone();
    let account_id = 0;
    super::executor::network(account_id, move || {
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

    // Batch compatible messages into one IMAP command per mailbox and generation.
    // The local edits and intents were committed atomically above.
    let mut groups = BTreeMap::<(i64, String, String), Vec<i64>>::new();
    let mut remote_skipped_count = 0_i64;
    let mut remote_attempted_count = 0_i64;
    let mut remote_applied_count = 0_i64;
    let mut remote_failed_count = 0_i64;
    for entry in unread_messages {
        let reference = store.get_message_remote_reference(entry.message_id)?;
        if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0
            || pending_for(&store, entry.message_id, "seen")?.is_none() {
            remote_skipped_count += 1;
            continue;
        }
        groups.entry((reference.account_id, reference.remote_mailbox, reference.remote_uid_validity))
            .or_default().push(entry.message_id);
    }
    for ((account_id, mailbox, validity), mut ids) in groups {
        ids.sort_unstable();
        for chunk in ids.chunks(100) {
            let account_lock = account_snapshot_lock(account_id);
            let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
            let locks = chunk.iter().map(|id| remote_write_lock(*id)).collect::<Vec<_>>();
            let _guards = locks.iter().map(|lock| lock.lock().unwrap_or_else(|e| e.into_inner())).collect::<Vec<_>>();
            let mut writes = Vec::new();
            for id in chunk {
                let reference = store.get_message_remote_reference(*id)?;
                let pending = pending_for(&store, *id, "seen")?;
                if reference.account_id == account_id && reference.remote_mailbox == mailbox
                    && reference.remote_uid_validity == validity && reference.remote_uid > 0
                    && pending.as_ref().is_some_and(|p| p.value == "1") {
                    writes.push((reference.remote_uid, pending.unwrap()));
                } else { remote_skipped_count += 1; }
            }
            if writes.is_empty() { continue; }
            let count = writes.len() as i64;
            let account = match store.get_account_by_id(Some(account_id)) {
                Ok(account) => account,
                Err(_) => { remote_skipped_count += count; continue; }
            };
            let secret = match store.get_account_secret(&account) {
                Ok(secret) => secret,
                Err(_) => { remote_skipped_count += count; continue; }
            };
            let uids = writes.iter().map(|(uid, _)| *uid).collect::<Vec<_>>();
            remote_attempted_count += count;
            match imap_probe::set_remote_seen_batch(&account, &secret, &mailbox, &uids, &validity, true) {
                Ok(()) => {
                    for (_, pending) in writes { store.clear_pending_remote_write_if_unchanged(&pending)?; }
                    remote_applied_count += count;
                }
                Err(_) => remote_failed_count += count,
            }
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

    }).await
}

#[tauri::command]
pub async fn set_message_starred(
    store: State<'_, MailStore>,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    let store = store.inner().clone();
    let lookup = store.clone();
    let account_id = super::executor::database(move || {
        lookup
            .get_message_account(message_id)
            .map(|account| account.id)
    })
    .await?;
    super::executor::network(account_id, move || {
        store.apply_local_remote_intent(
            message_id,
            "flagged",
            if is_starred { "1" } else { "0" },
        )?;
        sync_remote_flagged(&store, message_id, is_starred)
    })
    .await
}

#[tauri::command]
pub async fn move_message_to_role(
    store: State<'_, MailStore>,
    message_id: i64,
    role: String,
) -> MailResult<RemoteActionReport> {
    let store = store.inner().clone();
    let lookup = store.clone();
    let account_id = super::executor::database(move || {
        lookup
            .get_message_account(message_id)
            .map(|account| account.id)
    })
    .await?;
    super::executor::network(account_id, move || {
        let account_lock = account_snapshot_lock(account_id);
        let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
        store.apply_local_remote_intent(message_id, "move", &role)?;
        sync_remote_move_locked(&store, message_id, &role)
    })
    .await
}

#[tauri::command]
pub async fn restore_message_to_inbox(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RestoreMessageReport> {
    let store = store.inner().clone();
    let lookup = store.clone();
    let account_id = super::executor::database(move || {
        lookup
            .get_message_account(message_id)
            .map(|account| account.id)
    })
    .await?;
    super::executor::network(account_id, move || {
        let account_lock = account_snapshot_lock(account_id);
        let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
        store.apply_local_remote_intent(message_id, "move", "inbox")?;
        let mut remote = sync_remote_move_locked(&store, message_id, "inbox")?;
        remote.message = remote
            .message
            .replacen("本地已移动", "本地已恢复到收件箱", 1);
        Ok(RestoreMessageReport {
            restored: store.get_message(message_id)?,
            remote,
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_message_permanently(
    store: State<'_, MailStore>,
    message_id: i64,
) -> MailResult<RemoteActionReport> {
    let store = store.inner().clone();
    let lookup = store.clone();
    let account_id = super::executor::database(move || {
        lookup
            .get_message_account(message_id)
            .map(|account| account.id)
    })
    .await?;
    super::executor::network(account_id, move || {
        super::message_deletion::delete_one(&store, message_id)
    })
    .await
}

#[tauri::command]
pub async fn empty_trash(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<TrashActionReport> {
    let store = store.inner().clone();
    let network_key = account_id.unwrap_or_default();
    super::executor::network(network_key, move || {
        super::message_deletion::empty_trash(&store, account_id.filter(|id| *id > 0))
    })
    .await
}

#[tauri::command]
pub async fn snooze_message(
    store: State<'_, MailStore>,
    message_id: i64,
    snoozed_until: String,
) -> MailResult<Message> {
    let store = store.inner().clone();
    super::executor::database(move || store.snooze_message(message_id, &snoozed_until)).await
}

#[tauri::command]
pub async fn snooze_messages(
    store: State<'_, MailStore>,
    message_ids: Vec<i64>,
    snoozed_until: String,
) -> MailResult<Vec<Message>> {
    let store = store.inner().clone();
    super::executor::database(move || store.snooze_messages(&message_ids, &snoozed_until)).await
}

#[tauri::command]
pub async fn unsnooze_message(store: State<'_, MailStore>, message_id: i64) -> MailResult<Message> {
    let store = store.inner().clone();
    super::executor::database(move || store.unsnooze_message(message_id)).await
}

#[tauri::command]
pub async fn release_due_snoozed_messages(
    store: State<'_, MailStore>,
    now: String,
) -> MailResult<ReleasedSnoozedCount> {
    let store = store.inner().clone();
    super::executor::database(move || store.release_due_snoozed_messages(&now)).await
}

#[tauri::command]
pub async fn apply_label_to_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    let store = store.inner().clone();
    super::executor::database(move || store.apply_label_to_message(message_id, label_id)).await
}

#[tauri::command]
pub async fn remove_label_from_message(
    store: State<'_, MailStore>,
    message_id: i64,
    label_id: i64,
) -> MailResult<()> {
    let store = store.inner().clone();
    super::executor::database(move || store.remove_label_from_message(message_id, label_id)).await
}

fn pending_for(
    store: &MailStore,
    message_id: i64,
    kind: &str,
) -> MailResult<Option<PendingRemoteWrite>> {
    store.get_pending_remote_write(message_id, kind)
}

fn sync_remote_seen(
    store: &MailStore,
    message_id: i64,
    is_read: bool,
) -> MailResult<RemoteActionReport> {
    let account_id = store.get_message_remote_reference(message_id)?.account_id;
    let account_lock = account_snapshot_lock(account_id);
    let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
    let lock = remote_write_lock(message_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let reference = store.get_message_remote_reference(message_id)?;
    if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
        return Ok(local_only_report("本地已更新；该邮件没有可用的远端 UID。"));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地已更新；POP3 不支持远端已读状态回写。",
        ));
    }
    let pending = pending_for(store, message_id, "seen")?;
    if pending
        .as_ref()
        .is_none_or(|p| p.value != if is_read { "1" } else { "0" })
    {
        return Ok(remote_skipped_report(
            "已存在更新的本地操作，保留待同步状态。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已更新；凭据不可用，已保留远端待同步操作：{error}"
            )))
        }
    };
    match imap_probe::set_remote_seen(
        &account,
        &secret,
        &reference.remote_mailbox,
        reference.remote_uid,
        &reference.remote_uid_validity,
        is_read,
    ) {
        Ok(()) => {
            if let Some(pending) = pending {
                store.clear_pending_remote_write_if_unchanged(&pending)?;
            }
            Ok(remote_ok_report("本地已更新，远端已读状态已同步。"))
        }
        Err(error) => Ok(remote_failed_report(format!(
            "本地已更新；远端已读状态待重试：{error}"
        ))),
    }
}

fn sync_remote_flagged(
    store: &MailStore,
    message_id: i64,
    is_starred: bool,
) -> MailResult<RemoteActionReport> {
    let account_id = store.get_message_remote_reference(message_id)?.account_id;
    let account_lock = account_snapshot_lock(account_id);
    let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
    let lock = remote_write_lock(message_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let reference = store.get_message_remote_reference(message_id)?;
    if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
        return Ok(local_only_report(
            "本地星标已更新；该邮件没有可用的远端 UID。",
        ));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    if is_pop3_account(&account) {
        return Ok(local_only_report(
            "本地星标已更新；POP3 不支持远端星标回写。",
        ));
    }
    let pending = pending_for(store, message_id, "flagged")?;
    if pending
        .as_ref()
        .is_none_or(|p| p.value != if is_starred { "1" } else { "0" })
    {
        return Ok(remote_skipped_report(
            "已存在更新的本地操作，保留待同步状态。",
        ));
    }
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地星标已更新；凭据不可用，已保留远端待同步操作：{error}"
            )))
        }
    };
    match imap_probe::set_remote_flagged(
        &account,
        &secret,
        &reference.remote_mailbox,
        reference.remote_uid,
        &reference.remote_uid_validity,
        is_starred,
    ) {
        Ok(()) => {
            if let Some(pending) = pending {
                store.clear_pending_remote_write_if_unchanged(&pending)?;
            }
            Ok(remote_ok_report("本地星标已更新，远端星标状态已同步。"))
        }
        Err(error) => Ok(remote_failed_report(format!(
            "本地星标已更新；远端星标状态待重试：{error}"
        ))),
    }
}

fn sync_remote_move(
    store: &MailStore,
    message_id: i64,
    role: &str,
) -> MailResult<RemoteActionReport> {
    let account_id = store.get_message_remote_reference(message_id)?.account_id;
    let account_lock = account_snapshot_lock(account_id);
    let _account_guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
    sync_remote_move_locked(store, message_id, role)
}

fn sync_remote_move_locked(
    store: &MailStore,
    message_id: i64,
    role: &str,
) -> MailResult<RemoteActionReport> {
    let lock = remote_write_lock(message_id);
    let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
    let reference = store.get_message_remote_reference(message_id)?;
    if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
        return Ok(local_only_report("本地已移动；该邮件没有可用的远端 UID。"));
    }
    let account = store.get_account_by_id(Some(reference.account_id))?;
    if is_pop3_account(&account) {
        return Ok(local_only_report("本地已移动；POP3 不支持远端移动。"));
    }
    let pending = pending_for(store, message_id, "move")?;
    if pending.as_ref().is_none_or(|p| p.value != role) {
        return Ok(remote_skipped_report(
            "已存在更新的本地操作，保留待同步状态。",
        ));
    }
    let target = match store.remote_mailbox_for_account_role(account.id, role)? {
        Some(target) => target,
        None => {
            return Ok(remote_skipped_report(format!(
                "本地已移动；未发现角色 {role} 对应的远端文件夹，已保留待同步操作。"
            )))
        }
    };
    let secret = match store.get_account_secret(&account) {
        Ok(secret) => secret,
        Err(error) => {
            return Ok(remote_skipped_report(format!(
                "本地已移动；凭据不可用，已保留远端待同步操作：{error}"
            )))
        }
    };
    match imap_probe::move_remote_message(
        &account,
        &secret,
        &reference.remote_mailbox,
        reference.remote_uid,
        &reference.remote_uid_validity,
        &target,
        &reference.message_id_header,
    ) {
        Ok(Some((uid, validity))) if uid > 0 && !validity.is_empty() => {
            if let Some(pending) = pending {
                if !store.finish_pending_move(&pending, &reference, &target, uid, &validity)? {
                    return Ok(remote_skipped_report(
                        "远端操作已完成，但本地状态已变化，保留新的待同步操作。",
                    ));
                }
            }
            Ok(remote_ok_report(format!(
                "本地已移动；远端邮件已移动到 {target}。"
            )))
        }
        Ok(_) => Ok(remote_failed_report(
            "服务器未确认目标邮件身份；已保留待同步操作。",
        )),
        Err(error) => Ok(remote_failed_report(format!(
            "本地已移动；远端移动待重试：{error}"
        ))),
    }
}

/// Retry queued writes before importing server flags. A failed or ambiguous
/// operation remains queued and continues to protect the local state.
pub(super) fn retry_pending_remote_writes(
    store: &MailStore,
    account_id: i64,
    ensure_not_cancelled: &dyn Fn() -> MailResult<()>,
) -> MailResult<(usize, usize)> {
    retry_pending_remote_writes_with(store, account_id, ensure_not_cancelled, |pending| {
        match pending.kind.as_str() {
            "seen" => sync_remote_seen(store, pending.message_id, pending.value == "1"),
            "flagged" => sync_remote_flagged(store, pending.message_id, pending.value == "1"),
            "move" => sync_remote_move(store, pending.message_id, &pending.value),
            _ => Ok(remote_skipped_report("未知的待同步操作。")),
        }
    })
}

fn retry_pending_remote_writes_with(
    store: &MailStore,
    account_id: i64,
    ensure_not_cancelled: &dyn Fn() -> MailResult<()>,
    mut attempt: impl FnMut(&PendingRemoteWrite) -> MailResult<RemoteActionReport>,
) -> MailResult<(usize, usize)> {
    // Keep a message's writes together and rotate the starting message between
    // syncs, so a permanently failing operation cannot starve the queue.
    let mut groups: Vec<Vec<PendingRemoteWrite>> = Vec::new();
    let mut detached = 0;
    let mut indexes = HashMap::new();
    for pending in store.list_pending_remote_writes()? {
        ensure_not_cancelled()?;
        let reference = match store.get_message_remote_reference(pending.message_id) {
            Ok(reference) => reference,
            Err(_) => continue,
        };
        if reference.account_id != account_id {
            continue;
        }
        if reference.remote_mailbox.trim().is_empty() || reference.remote_uid <= 0 {
            detached += 1;
            continue;
        }
        let index = *indexes.entry(pending.message_id).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        groups[index].push(pending);
    }
    if groups.is_empty() {
        return Ok((0, detached));
    }
    let total: usize = detached + groups.iter().map(Vec::len).sum::<usize>();
    let retry_scope = (store.database_identity().to_path_buf(), account_id);
    let start = RETRY_OFFSETS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&retry_scope)
        .copied()
        .unwrap_or(0)
        % groups.len();
    let mut applied = 0;
    let mut attempted_groups = 0;
    let mut failures = 0;
    for step in 0..groups.len().min(20) {
        ensure_not_cancelled()?;
        attempted_groups += 1;
        let mut group_failed = false;
        for pending in &groups[(start + step) % groups.len()] {
            ensure_not_cancelled()?;
            match attempt(pending) {
                Ok(report) if report.remote_applied => applied += 1,
                _ => group_failed = true,
            }
        }
        if group_failed {
            failures += 1;
        } else {
            failures = 0;
        }
        // A disconnected server should not delay fetching new mail for every
        // queued write. The next sync resumes at the next message.
        if failures >= 3 {
            break;
        }
    }
    RETRY_OFFSETS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(retry_scope, (start + attempted_groups) % groups.len());
    Ok((applied, total - applied))
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
    super::executor::database(move || {
        store.list_threads_for_scope_sorted(account_id, folder_id, query, filter, sort, limit)
    })
    .await
}

#[tauri::command]
pub async fn get_message_count(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    folder_id: Option<i64>,
    query: Option<String>,
    filter: Option<String>,
) -> MailResult<i64> {
    let store = store.inner().clone();
    super::executor::database(move || {
        store.count_messages_for_scope(account_id, folder_id.unwrap_or_default(), query, filter)
    })
    .await
}

#[cfg(test)]
mod remote_write_tests {
    use super::*;
    use crate::models::AccountCreateInput;

    fn fixture() -> (tempfile::TempDir, MailStore, i64) {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at(dir.path().join("test.sqlite3")).unwrap();
        store
            .create_account(AccountCreateInput {
                email: "remote-write-test@example.invalid".into(),
                display_name: "Test".into(),
                provider: "custom".into(),
                imap_host: "invalid.invalid:993".into(),
                smtp_host: "invalid.invalid:465".into(),
                incoming_protocol: "imap".into(),
                auth_type: "password".into(),
                sync_mode: "manual".into(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .unwrap();
        let message = store
            .import_eml_message(
                None,
                b"From: sender@example.invalid\r\nSubject: test\r\n\r\nbody",
            )
            .unwrap();
        store
            .set_message_remote_identity(message.id, "INBOX", 41, "<test@example.invalid>", "100")
            .unwrap();
        (dir, store, message.id)
    }

    #[test]
    fn failed_retries_are_bounded_and_rotate_to_other_messages() {
        let (_dir, store, first) = fixture();
        let account = store.get_message_account(first).unwrap();
        let mut ids = vec![first];
        for n in 0..6 {
            let content =
                format!("From: sender@example.invalid\r\nSubject: queued-{n}\r\n\r\nbody");
            let message = store.import_eml_message(None, content.as_bytes()).unwrap();
            store
                .set_message_remote_identity(
                    message.id,
                    "INBOX",
                    100 + n,
                    "<test@example.invalid>",
                    "100",
                )
                .unwrap();
            ids.push(message.id);
        }
        for id in &ids {
            store.apply_local_remote_intent(*id, "seen", "1").unwrap();
        }
        let mut first_round = Vec::new();
        let first_result =
            retry_pending_remote_writes_with(&store, account.id, &|| Ok(()), |pending| {
                first_round.push(pending.message_id);
                Ok(remote_failed_report("offline"))
            })
            .unwrap();
        let mut second_round = Vec::new();
        retry_pending_remote_writes_with(&store, account.id, &|| Ok(()), |pending| {
            second_round.push(pending.message_id);
            Ok(remote_failed_report("offline"))
        })
        .unwrap();
        assert_eq!(first_result, (0, 7));
        assert_eq!(first_round.len(), 3);
        assert_eq!(second_round.len(), 3);
        assert!(second_round.iter().all(|id| !first_round.contains(id)));
    }

    #[test]
    fn missing_credentials_persist_local_flag_and_retry_intent() {
        let (dir, store, id) = fixture();
        store.apply_local_remote_intent(id, "seen", "1").unwrap();
        let report = sync_remote_seen(&store, id, true).unwrap();
        assert!(!report.remote_attempted);
        assert!(store.get_message(id).unwrap().is_read);
        let account_id = store.get_message_account(id).unwrap().id;
        assert_eq!(
            retry_pending_remote_writes(&store, account_id, &|| Ok(())).unwrap(),
            (0, 1)
        );
        drop(store);
        let reopened = MailStore::open_at(dir.path().join("test.sqlite3")).unwrap();
        assert!(reopened.get_message(id).unwrap().is_read);
        assert!(reopened
            .list_pending_remote_writes()
            .unwrap()
            .iter()
            .any(|p| p.message_id == id && p.kind == "seen" && p.value == "1"));
    }

    #[test]
    fn unmapped_trash_never_deletes_or_discards_pending_move() {
        let (_dir, store, id) = fixture();
        store
            .apply_local_remote_intent(id, "move", "trash")
            .unwrap();
        let report = sync_remote_move(&store, id, "trash").unwrap();
        assert!(!report.remote_attempted);
        assert!(report.message.contains("文件夹"));
        assert_eq!(store.get_message(id).unwrap().folder_role, "trash");
        assert_eq!(
            store.get_message_remote_reference(id).unwrap().remote_uid,
            41
        );
        assert!(store
            .list_pending_remote_writes()
            .unwrap()
            .iter()
            .any(|p| p.kind == "move" && p.value == "trash"));
    }

    #[test]
    fn newer_intent_is_not_cleared_by_older_completion() {
        let (_dir, store, id) = fixture();
        store.apply_local_remote_intent(id, "seen", "1").unwrap();
        let old = pending_for(&store, id, "seen").unwrap().unwrap();
        store.apply_local_remote_intent(id, "seen", "0").unwrap();
        assert!(!store.clear_pending_remote_write_if_unchanged(&old).unwrap());
        assert!(!store.get_message(id).unwrap().is_read);
        assert_eq!(pending_for(&store, id, "seen").unwrap().unwrap().value, "0");
        assert!(!sync_remote_seen(&store, id, true).unwrap().remote_attempted);
    }

    #[test]
    fn retry_keeps_failed_intents_then_consumes_acknowledged_writes() {
        let (_dir, store, id) = fixture();
        store.apply_local_remote_intent(id, "seen", "1").unwrap();
        store.apply_local_remote_intent(id, "flagged", "1").unwrap();
        let account_id = store.get_message_account(id).unwrap().id;
        let retry = || {
            retry_pending_remote_writes_with(&store, account_id, &|| Ok(()), |pending| {
                if pending.kind == "seen" {
                    store.clear_pending_remote_write_if_unchanged(pending)?;
                    Ok(remote_ok_report("mock acknowledged"))
                } else {
                    Ok(remote_failed_report("mock disconnected"))
                }
            })
        };
        assert_eq!(retry().unwrap(), (1, 1));
        assert!(pending_for(&store, id, "seen").unwrap().is_none());
        assert!(pending_for(&store, id, "flagged").unwrap().is_some());
        assert_eq!(
            retry_pending_remote_writes_with(&store, account_id, &|| Ok(()), |pending| {
                store.clear_pending_remote_write_if_unchanged(pending)?;
                Ok(remote_ok_report("mock recovered"))
            })
            .unwrap(),
            (1, 0)
        );
        assert!(store.list_pending_remote_writes().unwrap().is_empty());
    }

    #[test]
    fn remote_write_waits_for_inflight_account_snapshot() {
        let (_dir, store, id) = fixture();
        store.apply_local_remote_intent(id, "seen", "1").unwrap();
        let account_id = store.get_message_account(id).unwrap().id;
        let lock = account_snapshot_lock(account_id);
        let guard = lock.lock().unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker_store = store.clone();
        let worker = std::thread::spawn(move || {
            started_tx.send(()).unwrap();
            done_tx
                .send(sync_remote_seen(&worker_store, id, true))
                .unwrap();
        });
        started_rx.recv().unwrap();
        assert!(done_rx
            .recv_timeout(std::time::Duration::from_millis(50))
            .is_err());
        drop(guard);
        assert!(done_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap()
            .is_ok());
        worker.join().unwrap();
        assert!(pending_for(&store, id, "seen").unwrap().is_some());
    }
}
