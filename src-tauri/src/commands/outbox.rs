use super::common::{command_info, format_attachment_progress, mask_email, mask_recipient_list};
use crate::commands::attachments::{
    read_verified_outbound_message_attachments, validate_outbound_attachment_inputs,
};
use crate::credentials;
use crate::db::{MailResult, MailStore};
use crate::imap_probe;
use crate::models::{
    Account, DraftInput, DraftSaveReport, MessageThreadingInput, OutboundMessage, OutboxItem,
};
use crate::smtp;
use tauri::State;

/// 发件生命周期（保存/替换附件、发送、排队、刷新）中的临时附件清理使用 TTL=0：
/// 不再被草稿/发件箱/待归档状态引用的临时文件立即删除。启动时单独的 60 秒
/// TTL 只作为异常退出后的兜底，见 db.rs。
const TEMP_ATTACHMENT_LIFECYCLE_TTL: std::time::Duration = std::time::Duration::from_secs(0);

#[derive(Clone, Copy)]
struct OutboxTaskProgress {
    task_id: i64,
}

impl OutboxTaskProgress {
    fn new(task_id: Option<i64>) -> Option<Self> {
        task_id.filter(|id| *id > 0).map(|task_id| Self { task_id })
    }

    fn set(&self, store: &MailStore, progress: i64, message: &str) -> MailResult<()> {
        store.update_background_task_progress(self.task_id, progress.clamp(0, 100), message)?;
        Ok(())
    }
}

fn ensure_outbox_task_not_cancelled(store: &MailStore, task_id: Option<i64>) -> MailResult<()> {
    let task_id = match task_id.filter(|id| *id > 0) {
        Some(task_id) => task_id,
        None => return Ok(()),
    };
    if store.background_task_cancel_requested(task_id)? {
        return Err(crate::db::MailError::Imap(
            "发送任务已取消，已停止继续发送。".to_string(),
        ));
    }
    Ok(())
}

fn read_verified_outbound_message_attachments_with_progress(
    store: &MailStore,
    message: &OutboundMessage,
    task_progress: Option<&OutboxTaskProgress>,
    start_progress: i64,
    end_progress: i64,
) -> MailResult<Vec<Vec<u8>>> {
    let attachments = &message.attachments;
    if attachments.is_empty() {
        if let Some(task_progress) = task_progress {
            task_progress.set(store, end_progress, "无附件，直接构建 MIME")?;
        }
        return Ok(Vec::new());
    }

    let total_size = attachments
        .iter()
        .map(|attachment| attachment.size_bytes.max(0))
        .sum::<i64>();
    let total_count = attachments.len();
    let safe_count = total_count.max(1);
    let span = (end_progress - start_progress).max(0);
    let mut loaded_size = 0_i64;
    let mut attachment_bytes = Vec::with_capacity(total_count);

    for (index, attachment) in attachments.iter().enumerate() {
        if let Some(task_progress) = task_progress {
            let before_progress = if total_size > 0 {
                let safe_total = total_size.max(1);
                start_progress + span * loaded_size / safe_total
            } else {
                start_progress + span * (index as i64) / safe_count as i64
            };
            task_progress.set(
                store,
                before_progress,
                &format!(
                    "读取附件 {} / {}：{}（{}）",
                    index + 1,
                    total_count,
                    attachment.filename,
                    format_attachment_progress(attachment.size_bytes.max(0) as u64),
                ),
            )?;
        }

        let bytes =
            crate::commands::attachments::read_verified_outbound_attachment(store, attachment)?;
        loaded_size = loaded_size.saturating_add(bytes.len() as i64);
        attachment_bytes.push(bytes);

        if let Some(task_progress) = task_progress {
            let after_progress = if total_size > 0 {
                let safe_total = total_size.max(1);
                start_progress + span * loaded_size / safe_total
            } else {
                start_progress + span * (index as i64 + 1) / (safe_count as i64)
            };
            task_progress.set(
                store,
                after_progress,
                &format!(
                    "附件已读取 {} / {}，累计 {} / {}",
                    index + 1,
                    total_count,
                    format_attachment_progress(loaded_size as u64),
                    format_attachment_progress(total_size.max(0) as u64),
                ),
            )?;
        }
    }

    if let Some(task_progress) = task_progress {
        task_progress.set(
            store,
            end_progress,
            &format!(
                "附件读取完成（{}）",
                format_attachment_progress(total_size.max(0) as u64),
            ),
        )?;
    }

    Ok(attachment_bytes)
}

/// 仅供测试与遗留校验入口使用。生产发送/渲染必须使用单次读取的
/// `read_verified_outbound_message_attachments`，避免验证后重新按路径读取。
#[cfg(test)]
fn validate_outbound_message_attachments(
    store: &MailStore,
    message: &OutboundMessage,
) -> MailResult<()> {
    for attachment in &message.attachments {
        crate::commands::attachments::validate_outbound_attachment(store, attachment)?;
    }
    crate::commands::attachments::validate_outbound_message_total_size(message)
}

#[tauri::command]
pub async fn save_draft(
    store: State<'_, MailStore>,
    input: DraftInput,
    threading: Option<MessageThreadingInput>,
) -> MailResult<DraftSaveReport> {
    let was_update = input.draft_id > 0;
    // 持久化前先校验 IPC 传入的附件：未授权路径 / symlink / 大小变化 / 总量超限
    // 都在这里被拒绝，未经授权的附件绝不可能被保存并同步到远端。
    validate_outbound_attachment_inputs(&store, &input.attachments)?;
    let previous_reference = if was_update {
        Some(store.get_message_remote_reference(input.draft_id)?)
    } else {
        None
    };
    let draft_id = store.save_draft(input)?;
    store.set_message_threading(draft_id, threading)?;
    // 保存/替换附件后清理不再被任何草稿/发件箱引用的临时附件。
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);
    let message = store.get_outbound_message(draft_id)?;
    // 渲染/上传前再次校验持久化后的附件（拦截保存后到同步前的文件替换 TOCTOU）。
    let attachment_bytes = read_verified_outbound_message_attachments(&store, &message)?;
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
    let raw_message = match smtp::render_outbound_with_attachment_bytes(&message, &attachment_bytes)
    {
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
    task_id: Option<i64>,
) -> MailResult<i64> {
    let started_at = std::time::Instant::now();
    let task_progress = OutboxTaskProgress::new(task_id);
    command_info(format!(
        "[better-email][send] direct smtp start account_id={} to={} subject_len={} attachments={}",
        input.account_id,
        mask_recipient_list(&input.to),
        input.subject.trim().chars().count(),
        input.attachments.len(),
    ));
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 8, "正在校验邮件与附件...")?;
    }
    validate_outbound_attachment_inputs(&store, &input.attachments)?;
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 16, "草稿入库完成，准备获取账号")?;
    }
    let message_id = store.send_message(input)?;
    store.set_message_threading(message_id, threading)?;
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 24, "邮件记录已落库，准备读取账号与账号凭据")?;
    }
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);
    let message = store.get_outbound_message(message_id)?;
    ensure_outbox_task_not_cancelled(&store, task_id)?;
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
    let attachment_bytes = read_verified_outbound_message_attachments_with_progress(
        &store,
        &message,
        task_progress.as_ref(),
        36,
        60,
    )?;
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 60, "准备发送，执行 SMTP 提交")?;
    }
    let raw_message = match smtp::send_outbound_with_attachment_bytes(
        &account,
        &message,
        &secret,
        &attachment_bytes,
    ) {
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
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 88, "SMTP 已提交，正在写入 sent 归档")?;
    }
    store.mark_outbox_smtp_sent_pending_archive(message_id, &message_id_header)?;
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 96, "远端已发送归档完成")?;
    }
    archive_sent_message(store.inner(), &account, &secret, &message, &raw_message)?;
    // 只有远端 Sent 留档已经成功并切换为 sent 后，这次直接发送的临时附件才
    // 不再有引用，立即清理。归档失败会保持 sent_remote_pending，从而保留附件。
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);
    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 100, "邮件已发送")?;
    }
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
    validate_outbound_attachment_inputs(&store, &input.attachments)?;
    let item = store.queue_outbox_message(input)?;
    store.set_message_threading(item.message_id, threading)?;
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);
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
    let item = store.cancel_outbox_item(outbox_id)?;
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);
    Ok(item)
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
        // 重建原始邮件前再次校验附件授权（拦截替换/删除后仍尝试上传 TOCTOU）。
        let attachment_bytes = match read_verified_outbound_message_attachments(store, &message) {
            Ok(bytes) => bytes,
            Err(error) => {
                store.mark_outbox_remote_archive_failed(
                    message.id,
                    &format!("SMTP 已发送；重建原始邮件前附件校验失败，稍后仅重试留档：{error}"),
                )?;
                continue;
            }
        };
        let raw_message =
            match smtp::render_outbound_with_attachment_bytes(&message, &attachment_bytes) {
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
pub async fn flush_outbox_smtp(
    store: State<'_, MailStore>,
    task_id: Option<i64>,
) -> MailResult<Vec<OutboxItem>> {
    let started_at = std::time::Instant::now();
    let task_progress = OutboxTaskProgress::new(task_id);
    command_info("[better-email][send] flush smtp start");
    retry_pending_remote_archives(store.inner())?;

    let pending = store.pending_outbox_messages()?;
    let total_items = pending.len().max(1);
    if pending.is_empty() {
        if let Some(task_progress) = task_progress {
            task_progress.set(&store, 100, "暂无待发送邮件")?;
        }
        let outbox = store.list_outbox()?;
        command_info(format!(
            "[better-email][send] flush smtp done outbox_items={} duration_ms={}",
            outbox.len(),
            started_at.elapsed().as_millis(),
        ));
        return Ok(outbox);
    }

    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 5, "开始发送发件箱邮件")?;
    }

    for (index, message) in pending.iter().enumerate() {
        ensure_outbox_task_not_cancelled(store.inner(), task_id)?;
        let step_progress = ((index as i64).saturating_mul(80) / total_items as i64).clamp(0, 80);
        if let Some(task_progress) = task_progress {
            task_progress.set(
                &store,
                step_progress,
                &format!(
                    "正在发送第 {}/{} 封：{}",
                    index + 1,
                    total_items,
                    mask_recipient_list(&message.recipients),
                ),
            )?;
        }
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
                if let Some(task_progress) = task_progress {
                    task_progress.set(
                        &store,
                        step_progress.saturating_add(5).min(95),
                        &format!("第 {}/{} 封发送失败：{}", index + 1, total_items, error,),
                    )?;
                }
                continue;
            }
        };
        let attachment_upload_start = step_progress;
        let attachment_upload_end = step_progress.saturating_add(18).min(75);
        let attachment_bytes = match read_verified_outbound_message_attachments_with_progress(
            store.inner(),
            message,
            task_progress.as_ref(),
            attachment_upload_start,
            attachment_upload_end,
        ) {
            Ok(bytes) => bytes,
            Err(error) => {
                crate::logging::log_line(format!(
                    "[better-email][send] smtp item attachment rejected message_id={} account_id={} error={}",
                    message.id,
                    message.account_id,
                    error,
                ));
                store.mark_outbox_failed(message.id, &error.to_string())?;
                if let Some(task_progress) = task_progress {
                    task_progress.set(
                        &store,
                        step_progress.saturating_add(5).min(95),
                        &format!("第 {}/{} 封附件校验失败：{}", index + 1, total_items, error,),
                    )?;
                }
                continue;
            }
        };
        match smtp::send_outbound_with_attachment_bytes(
            &account,
            message,
            &secret,
            &attachment_bytes,
        ) {
            Ok(raw_message) => {
                let message_id_header = smtp::outbound_message_id(message);
                store.mark_outbox_smtp_sent_pending_archive(message.id, &message_id_header)?;
                archive_sent_message(store.inner(), &account, &secret, message, &raw_message)?;
                if let Some(task_progress) = task_progress {
                    task_progress.set(
                        &store,
                        85 + ((index as i64).saturating_mul(15) / total_items as i64),
                        &format!(
                            "第 {}/{} 封已发送：{}",
                            index + 1,
                            total_items,
                            mask_recipient_list(&message.recipients),
                        ),
                    )?;
                }
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
                if let Some(task_progress) = task_progress {
                    task_progress.set(
                        &store,
                        85 + ((index as i64).saturating_mul(15) / total_items as i64),
                        &format!("第 {}/{} 封发送失败：{}", index + 1, total_items, error,),
                    )?;
                }
            }
        }
    }

    if let Some(task_progress) = task_progress {
        task_progress.set(&store, 100, "SMTP 发送完成")?;
    }

    // 发送完成后清理不再被引用的临时附件。
    let _ = store.prune_temp_attachments(TEMP_ATTACHMENT_LIFECYCLE_TTL);

    let outbox = store.list_outbox()?;
    command_info(format!(
        "[better-email][send] flush smtp done outbox_items={} duration_ms={}",
        outbox.len(),
        started_at.elapsed().as_millis(),
    ));
    Ok(outbox)
}

#[cfg(test)]
mod tests {
    use super::validate_outbound_attachment_inputs;
    use crate::commands::attachments::{
        authorize_outbound_path, validate_outbound_message_total_size,
    };
    use crate::db::MailStore;
    use crate::models::{DraftInput, OutboundAttachmentInput};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DATABASE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_database_path() -> std::path::PathBuf {
        let unique = TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "better-email-outbox-test-{}-{}",
            std::process::id(),
            unique
        ));
        std::fs::create_dir_all(&dir).expect("test data dir created");
        dir.join("better-email.sqlite3")
    }

    /// open_at 不播种演示数据，测试需自行创建账号才能保存草稿。
    fn create_test_account(store: &MailStore) {
        store
            .create_account(crate::models::AccountCreateInput {
                email: "outbox@better-email.local".to_string(),
                display_name: "Outbox Tester".to_string(),
                provider: "Local".to_string(),
                imap_host: "imap.example.com:993".to_string(),
                smtp_host: "smtp.example.com:465".to_string(),
                incoming_protocol: "imap".to_string(),
                auth_type: "password".to_string(),
                sync_mode: "manual".to_string(),
                remote_images_allowed: false,
                signature: String::new(),
                cross_account_risk_warning: true,
                block_external_mailboxes: false,
                intercept_https_links: true,
                auto_download_attachments: false,
                fetch_history_attachments: false,
                warn_external_senders: false,
            })
            .expect("account created");
    }

    fn draft_input(attachments: Vec<OutboundAttachmentInput>) -> DraftInput {
        DraftInput {
            draft_id: 0,
            account_id: 0,
            identity_id: 0,
            to: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Draft with attachment".to_string(),
            body: "body".to_string(),
            html_body: String::new(),
            send_at: String::new(),
            attachments,
        }
    }

    fn outbound_input(
        filename: &str,
        local_path: &str,
        size_bytes: i64,
    ) -> OutboundAttachmentInput {
        OutboundAttachmentInput {
            filename: filename.to_string(),
            mime_type: "application/octet-stream".to_string(),
            size_bytes,
            local_path: local_path.to_string(),
            content_id: String::new(),
            is_inline: false,
        }
    }

    #[test]
    fn unauthorized_draft_attachment_is_rejected_before_persistence_and_render() {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        create_test_account(&store);
        let dir = std::env::temp_dir().join(format!(
            "better-email-outbox-auth-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let secret = dir.join("passwd.txt");
        std::fs::write(&secret, b"root:x:0:0").unwrap();
        let real_size = std::fs::metadata(&secret).unwrap().len() as i64;

        // 攻击者构造的草稿：未授权路径 + size_bytes=0。保存草稿命令在持久化前
        // 会调用本校验器，因此这类草稿绝不可能落库，也不会被 render_outbound 上传。
        let input = outbound_input("passwd.txt", &secret.to_string_lossy(), 0);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("大小与授权不一致"),
            "size_bytes=0 不得跳过大小校验：{err}"
        );

        // 即使声明大小与真实一致，未授权路径也必须被校验器拒绝。
        let input = outbound_input("passwd.txt", &secret.to_string_lossy(), real_size);
        let err = validate_outbound_attachment_inputs(&store, &[input]).unwrap_err();
        assert!(
            err.to_string().contains("未经授权"),
            "未授权附件应被拒绝：{err}"
        );

        // 未授权草稿即使绕过命令层被持久化，渲染前校验也会阻断上传。
        let draft = draft_input(vec![outbound_input(
            "passwd.txt",
            &secret.to_string_lossy(),
            real_size,
        )]);
        let saved = store
            .save_draft(draft.clone())
            .expect("draft persists rows");
        let message = store.get_outbound_message(saved).expect("message loads");
        // 校验持久化后的附件必须失败 → 渲染前校验会阻断上传。
        let persisted_error = super::validate_outbound_message_attachments(&store, &message)
            .expect_err("persisted unauthorized attachment rejected");
        assert!(
            persisted_error.to_string().contains("未经授权"),
            "持久化后的未授权附件在校验/渲染前应被拒绝：{persisted_error}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn authorized_draft_attachment_can_save_and_render() {
        let store = MailStore::open_at(unique_test_database_path()).expect("store opens");
        create_test_account(&store);
        let dir = std::env::temp_dir().join(format!(
            "better-email-outbox-ok-{}",
            TEST_DATABASE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("notes.txt");
        std::fs::write(&file, b"authorized draft attachment").unwrap();

        // 先授权（与 pick_outbound_attachments 一致）。
        let input = authorize_outbound_path(&store, &file, 0).expect("authorized");
        let input = outbound_input("notes.txt", &input.local_path, input.size_bytes);
        validate_outbound_attachment_inputs(&store, std::slice::from_ref(&input))
            .expect("validated");

        // 授权附件可以正常保存并渲染。
        let draft_id = store
            .save_draft(draft_input(vec![input]))
            .expect("draft saved");
        let message = store.get_outbound_message(draft_id).expect("message loads");
        super::validate_outbound_message_attachments(&store, &message).expect("validated");
        let raw = crate::smtp::render_outbound(&message).expect("rendered");
        assert!(String::from_utf8_lossy(&raw).contains("authorized draft attachment"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn persisted_message_total_size_limit_is_enforced() {
        let message = crate::models::OutboundMessage {
            id: 1,
            account_id: 1,
            sender_name: "Me".to_string(),
            sender_email: "me@example.com".to_string(),
            reply_to: String::new(),
            recipients: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Total".to_string(),
            body: "body".to_string(),
            html_body: String::new(),
            in_reply_to_header: String::new(),
            references_header: String::new(),
            attachments: vec![
                crate::models::Attachment {
                    id: 1,
                    message_id: 1,
                    filename: "a.bin".to_string(),
                    mime_type: "application/octet-stream".to_string(),
                    size_bytes: 60 * 1024 * 1024,
                    is_downloaded: true,
                    local_path: String::new(),
                    content_id: String::new(),
                    is_inline: false,
                },
                crate::models::Attachment {
                    id: 2,
                    message_id: 1,
                    filename: "b.bin".to_string(),
                    mime_type: "application/octet-stream".to_string(),
                    size_bytes: 60 * 1024 * 1024,
                    is_downloaded: true,
                    local_path: String::new(),
                    content_id: String::new(),
                    is_inline: false,
                },
            ],
        };
        let err = validate_outbound_message_total_size(&message).unwrap_err();
        assert!(
            err.to_string().contains("总大小超过上限"),
            "持久化邮件附件总量超限应被拒绝：{err}"
        );
    }
}
