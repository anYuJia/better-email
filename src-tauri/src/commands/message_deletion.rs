//! A failed/uncertain remote delete retains the local row and its attachments.
//! The row is the durable retry record; only an acknowledged result can consume it.
use super::common::is_pop3_account;
use crate::credentials::AccountSecret;
use crate::db::{MailError, MailResult, MailStore, MessageRemoteRef};
use crate::imap_probe::{self, RemoteDeleteBatchResult, RemoteDeleteCandidate};
use crate::models::{Account, RemoteActionReport, TrashActionReport};
use std::collections::{BTreeMap, BTreeSet};

fn retained(message: impl Into<String>, attempted: bool) -> RemoteActionReport {
    RemoteActionReport {
        local_applied: false,
        remote_attempted: attempted,
        remote_applied: false,
        message: message.into(),
    }
}

fn consume_local(
    store: &MailStore,
    id: i64,
    reference: &MessageRemoteRef,
    remote: bool,
    detail: &str,
) -> RemoteActionReport {
    match store.delete_trash_message_if_unchanged(id, reference) {
        Ok(true) => RemoteActionReport {
            local_applied: true,
            remote_attempted: remote,
            remote_applied: remote,
            message: detail.into(),
        },
        Ok(false) => RemoteActionReport {
            local_applied: false,
            remote_attempted: remote,
            remote_applied: remote,
            message: "邮件位置已改变，已保留当前本地邮件；请检查后重试。".into(),
        },
        Err(error) => RemoteActionReport {
            local_applied: false,
            remote_attempted: remote,
            remote_applied: remote,
            message: format!("本地邮件尚未删除，可重试：{error}"),
        },
    }
}

pub(super) fn delete_messages(
    store: &MailStore,
    ids: &[i64],
) -> MailResult<Vec<(i64, RemoteActionReport)>> {
    delete_with(store, ids, imap_probe::delete_remote_messages)
}

fn delete_with(
    store: &MailStore,
    ids: &[i64],
    mut remote_delete: impl FnMut(
        &Account,
        &AccountSecret,
        &str,
        &[RemoteDeleteCandidate],
    ) -> MailResult<RemoteDeleteBatchResult>,
) -> MailResult<Vec<(i64, RemoteActionReport)>> {
    let mut groups = BTreeMap::<(i64, String), Vec<(i64, MessageRemoteRef)>>::new();
    let mut reports = Vec::new();
    for id in ids.iter().copied().collect::<BTreeSet<_>>() {
        let message = match store.get_message(id) {
            Ok(message) => message,
            Err(error) => {
                reports.push((
                    id,
                    retained(format!("无法确认邮件当前状态，未继续删除：{error}"), false),
                ));
                continue;
            }
        };
        if message.folder_role != "trash" {
            reports.push((id, retained("邮件已离开废纸篓，未执行永久删除。", false)));
            continue;
        }
        let reference = store.get_message_remote_reference(id)?;
        let account = store.get_account_by_id(Some(reference.account_id))?;
        if is_pop3_account(&account)
            || (reference.remote_mailbox.trim().is_empty() && reference.remote_uid <= 0)
        {
            reports.push((
                id,
                consume_local(
                    store,
                    id,
                    &reference,
                    false,
                    "已永久删除本地邮件；此邮件不执行服务器删除。",
                ),
            ));
        } else if reference.remote_mailbox.trim().is_empty()
            || (reference.remote_uid <= 0 && reference.message_id_header.trim().is_empty())
        {
            reports.push((
                id,
                retained(
                    "无法定位服务器副本，已保留本地邮件。请同步账号后重试。",
                    false,
                ),
            ));
        } else if reference
            .remote_uid_validity
            .parse::<u32>()
            .ok()
            .filter(|value| *value > 0)
            .is_none()
        {
            reports.push((
                id,
                retained(
                    "邮件的服务器身份尚未确认，未执行删除。请同步后重试。",
                    false,
                ),
            ));
        } else {
            groups
                .entry((reference.account_id, reference.remote_mailbox.clone()))
                .or_default()
                .push((id, reference));
        }
    }
    for ((account_id, mailbox), entries) in groups {
        let account_lock = super::messages::account_snapshot_lock(account_id);
        let _guard = account_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut eligible = Vec::new();
        for (id, reference) in entries {
            let still_current = store
                .get_message(id)
                .is_ok_and(|message| message.folder_role == "trash")
                && store
                    .get_message_remote_reference(id)
                    .is_ok_and(|actual| actual == reference);
            if still_current {
                eligible.push((id, reference));
            } else {
                reports.push((id, retained("邮件状态已改变，未执行永久删除。", false)));
            }
        }
        let entries = eligible;
        if entries.is_empty() {
            continue;
        }
        let account = store.get_account_by_id(Some(account_id))?;
        let secret = match store.get_account_secret(&account) {
            Ok(secret) => secret,
            Err(error) => {
                reports.extend(entries.into_iter().map(|(id, _)| {
                    (
                        id,
                        retained(
                            format!("尚未删除；请修复账号登录后重试。邮件和附件仍保留：{error}"),
                            false,
                        ),
                    )
                }));
                continue;
            }
        };
        let candidates = entries
            .iter()
            .map(|(_, reference)| RemoteDeleteCandidate {
                remote_uid: reference.remote_uid,
                remote_uid_validity: reference.remote_uid_validity.clone(),
                message_id_header: reference.message_id_header.clone(),
            })
            .collect::<Vec<_>>();
        match remote_delete(&account, &secret, &mailbox, &candidates) {
            Ok(result) => {
                let deleted: BTreeSet<_> = result.deleted_indices.into_iter().collect();
                if deleted.len() + result.skipped_count.max(0) as usize != entries.len() {
                    reports.extend(entries.into_iter().map(|(id, _)| {
                        (
                            id,
                            retained("服务器返回的删除结果不完整，本地邮件仍保留，可重试。", true),
                        )
                    }));
                    continue;
                }
                for (index, (id, reference)) in entries.into_iter().enumerate() {
                    reports.push((
                        id,
                        if deleted.contains(&index) {
                            consume_local(
                                store,
                                id,
                                &reference,
                                true,
                                "已从服务器和本地永久删除邮件。",
                            )
                        } else {
                            retained(
                                "服务器副本无法唯一定位，尚未删除；本地邮件仍保留，可同步后重试。",
                                true,
                            )
                        },
                    ));
                }
            }
            Err(error) => reports.extend(entries.into_iter().map(|(id, _)| {
                (
                    id,
                    retained(
                        format!("服务器删除未确认，已保留本地邮件和附件，可重试：{error}"),
                        true,
                    ),
                )
            })),
        }
    }
    if reports.iter().any(|(_, report)| report.local_applied) {
        let _ = store.prune_temp_attachments(std::time::Duration::ZERO);
    }
    Ok(reports)
}

pub(super) fn delete_one(store: &MailStore, id: i64) -> MailResult<RemoteActionReport> {
    delete_messages(store, &[id])?
        .into_iter()
        .next()
        .map(|(_, report)| report)
        .ok_or_else(|| MailError::Imap("邮件不存在，未执行删除。".into()))
}

pub(super) fn empty_trash(
    store: &MailStore,
    account_id: Option<i64>,
) -> MailResult<TrashActionReport> {
    let ids = store.list_trash_message_ids(account_id)?;
    let reports = delete_messages(store, &ids)?;
    let local_deleted_count = reports.iter().filter(|(_, r)| r.local_applied).count() as i64;
    let remaining = reports.len() as i64 - local_deleted_count;
    Ok(TrashActionReport {
        local_deleted_count,
        remote_attempted_count: reports.iter().filter(|(_, r)| r.remote_attempted).count() as i64,
        remote_applied_count: reports.iter().filter(|(_, r)| r.remote_applied).count() as i64,
        remote_skipped_count: reports
            .iter()
            .filter(|(_, r)| !r.local_applied && !r.remote_attempted)
            .count() as i64,
        remote_failed_count: reports
            .iter()
            .filter(|(_, r)| !r.local_applied && r.remote_attempted)
            .count() as i64,
        message: if reports.is_empty() {
            "废纸篓已经为空。".into()
        } else if remaining > 0 {
            format!("已删除 {local_deleted_count} 封；{remaining} 封尚未删除，邮件和附件仍保留。请检查账号连接后重试。")
        } else {
            format!("已永久删除 {local_deleted_count} 封。仅本地及 POP3 邮件未更改服务器副本。")
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, MailStore, i64) {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at(dir.path().join("test.sqlite3")).unwrap();
        store
            .create_account(crate::models::AccountCreateInput {
                email: "delete-test@example.com".into(),
                display_name: "Test".into(),
                provider: "custom".into(),
                imap_host: "imap.example.com:993".into(),
                smtp_host: "smtp.example.com:465".into(),
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
        let message = store.import_eml_message(None, b"From: reader@example.com\r\nSubject: Delete retry\r\nContent-Type: text/plain\r\n\r\nKeep this local body").unwrap();
        store.move_message_to_role(message.id, "trash").unwrap();
        store
            .set_message_remote_ref_with_validity(message.id, "Trash", 41, "100")
            .unwrap();
        (dir, store, message.id)
    }

    fn authorize(store: &MailStore, id: i64) {
        let account = store.get_message_account(id).unwrap();
        store
            .store_account_secret(&account.email, "offline-test-secret")
            .unwrap();
    }

    fn acknowledged(indices: Vec<usize>) -> RemoteDeleteBatchResult {
        RemoteDeleteBatchResult {
            deleted_count: indices.len() as i64,
            skipped_count: 0,
            deleted_indices: indices,
        }
    }

    #[test]
    fn missing_credentials_keep_local_message_and_never_connect() {
        let (_dir, store, id) = fixture();
        let account = store.get_message_account(id).unwrap();
        store.delete_account_secret(&account.email).unwrap();
        let reports = delete_with(&store, &[id], |_, _, _, _| {
            panic!("no network without credentials")
        })
        .unwrap();
        assert!(!reports[0].1.local_applied);
        assert!(!reports[0].1.remote_attempted);
        assert!(store.get_message(id).is_ok());
        assert!(store
            .list_trash_message_ids(Some(account.id))
            .unwrap()
            .contains(&id));
    }

    #[test]
    fn uncertain_remote_result_is_retryable_after_reopening_the_database() {
        let (dir, store, id) = fixture();
        authorize(&store, id);
        let reports = delete_with(&store, &[id], |_, _, _, _| {
            Err(MailError::Imap("connection lost after expunge".into()))
        })
        .unwrap();
        assert!(!reports[0].1.local_applied);
        assert!(store.get_message(id).unwrap().body.contains("Keep this"));
        drop(store);
        let reopened = MailStore::open_at(dir.path().join("test.sqlite3")).unwrap();
        let reports = delete_with(&reopened, &[id], |_, _, _, _| {
            assert!(
                reopened.get_message(id).is_ok(),
                "local row must survive until acknowledgement"
            );
            Ok(acknowledged(vec![0]))
        })
        .unwrap();
        assert!(reports[0].1.local_applied && reports[0].1.remote_applied);
        assert!(reopened.get_message(id).is_err());
    }

    #[test]
    fn concurrent_restore_is_not_deleted_by_late_remote_success() {
        let (_dir, store, id) = fixture();
        authorize(&store, id);
        let reports = delete_with(&store, &[id], |_, _, _, _| {
            store.restore_message_to_inbox(id).unwrap();
            Ok(acknowledged(vec![0]))
        })
        .unwrap();
        assert!(!reports[0].1.local_applied);
        assert!(reports[0].1.remote_applied);
        assert_eq!(store.get_message(id).unwrap().folder_role, "inbox");
    }

    #[test]
    fn partial_remote_batch_consumes_only_acknowledged_rows() {
        let (_dir, store, first) = fixture();
        authorize(&store, first);
        let second = store
            .import_eml_message(
                None,
                b"From: other@example.com\r\nSubject: Other\r\n\r\nStill here",
            )
            .unwrap()
            .id;
        store.move_message_to_role(second, "trash").unwrap();
        store
            .set_message_remote_ref_with_validity(second, "Trash", 42, "100")
            .unwrap();
        let reports = delete_with(&store, &[first, first, second], |_, _, _, candidates| {
            assert_eq!(candidates.len(), 2);
            Ok(RemoteDeleteBatchResult {
                deleted_count: 1,
                skipped_count: 1,
                deleted_indices: vec![0],
            })
        })
        .unwrap();
        assert_eq!(reports.len(), 2);
        assert!(store.get_message(first).is_err());
        assert!(store.get_message(second).is_ok());
        assert_eq!(reports.iter().filter(|(_, r)| r.local_applied).count(), 1);
    }

    #[test]
    fn local_only_message_is_deleted_without_requesting_credentials() {
        let (_dir, store, id) = fixture();
        store.set_message_remote_ref(id, "", 0).unwrap();
        let reports = delete_with(&store, &[id], |_, _, _, _| {
            panic!("local message has no server deletion")
        })
        .unwrap();
        assert!(reports[0].1.local_applied);
        assert!(!reports[0].1.remote_applied);
        assert!(reports[0].1.message.contains("本地"));
    }
    #[test]
    fn unknown_generation_keeps_local_message_without_connecting() {
        let (_dir, store, id) = fixture();
        authorize(&store, id);
        store.set_message_remote_ref(id, "Trash", 41).unwrap();
        let reports = delete_with(&store, &[id], |_, _, _, _| {
            panic!("unverified UID must not reach IMAP")
        })
        .unwrap();
        assert!(!reports[0].1.local_applied && !reports[0].1.remote_attempted);
        assert!(reports[0].1.message.contains("请同步后重试"));
        assert!(store.get_message(id).is_ok());
    }

    #[test]
    fn a_late_delete_acknowledgement_cannot_consume_a_rebound_generation() {
        let (_dir, store, id) = fixture();
        authorize(&store, id);
        let reports = delete_with(&store, &[id], |_, _, _, candidates| {
            assert_eq!(candidates[0].remote_uid_validity, "100");
            store
                .set_message_remote_ref_with_validity(id, "Trash", 41, "200")
                .unwrap();
            Ok(acknowledged(vec![0]))
        })
        .unwrap();
        assert!(!reports[0].1.local_applied && reports[0].1.remote_applied);
        assert!(store.get_message(id).is_ok());
    }
}
