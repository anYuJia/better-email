use super::*;

fn fixture() -> (tempfile::TempDir, MailStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = MailStore::open_at_with_seed(dir.path().join("outbox.sqlite3"), true).unwrap();
    (dir, store)
}

fn draft() -> DraftInput {
    DraftInput {
        draft_id: 0,
        account_id: 0,
        identity_id: 0,
        to: "recipient@example.com".into(),
        cc: String::new(),
        bcc: String::new(),
        subject: "Outbox lifecycle regression".into(),
        body: "complete body".into(),
        html_body: String::new(),
        send_at: String::new(),
        attachments: Vec::new(),
    }
}

fn status(store: &MailStore, message_id: i64) -> String {
    store
        .list_outbox()
        .unwrap()
        .into_iter()
        .find(|item| item.message_id == message_id)
        .unwrap()
        .status
}

#[test]
fn late_archive_failure_cannot_downgrade_confirmed_success() {
    let (_dir, store) = fixture();
    let id = store.prepare_outbox_send(draft()).unwrap();
    store
        .mark_outbox_smtp_sent_pending_archive(id, "<archived@example.com>")
        .unwrap();
    store.mark_outbox_remote_archived(id, "Sent", 123).unwrap();
    store
        .mark_outbox_remote_archive_failed(id, "late worker error")
        .unwrap();
    assert_eq!(status(&store, id), "sent");
    assert_eq!(store.get_message(id).unwrap().remote_uid, 123);
    assert!(!store.claim_outbox_archive(id).unwrap());
}

#[test]
fn late_archive_success_cannot_replace_confirmed_remote_identity() {
    let (_dir, store) = fixture();
    let id = store.prepare_outbox_send(draft()).unwrap();
    store
        .mark_outbox_smtp_sent_pending_archive(id, "<archived@example.com>")
        .unwrap();
    store.mark_outbox_remote_archived(id, "Sent", 123).unwrap();
    store
        .mark_outbox_remote_archived(id, "Another folder", 999)
        .unwrap();
    let message = store.get_message(id).unwrap();
    assert_eq!(message.remote_mailbox, "Sent");
    assert_eq!(message.remote_uid, 123);
}

#[test]
fn archive_callbacks_cannot_mark_unsent_messages_as_sent() {
    let (_dir, store) = fixture();
    let item = store.queue_outbox_message(draft()).unwrap();
    store
        .mark_outbox_remote_archived(item.message_id, "Sent", 123)
        .unwrap();
    store
        .mark_outbox_remote_archive_failed(item.message_id, "late")
        .unwrap();
    assert_eq!(status(&store, item.message_id), "queued");
    assert_eq!(store.get_message(item.message_id).unwrap().remote_uid, 0);
}

#[test]
fn dry_run_respects_rfc3339_offsets_not_lexicographic_order() {
    let (_dir, store) = fixture();
    let mut future = draft();
    future.send_at = (Utc::now() + Duration::hours(1))
        .with_timezone(&chrono::FixedOffset::west_opt(5 * 3600).unwrap())
        .to_rfc3339();
    let future = store.queue_outbox_message(future).unwrap();
    let mut past = draft();
    past.send_at = (Utc::now() - Duration::hours(1))
        .with_timezone(&chrono::FixedOffset::east_opt(14 * 3600).unwrap())
        .to_rfc3339();
    let past = store.queue_outbox_message(past).unwrap();
    store.flush_outbox_dry_run().unwrap();
    assert_eq!(status(&store, future.message_id), "scheduled");
    assert_eq!(status(&store, past.message_id), "sent_dry_run");
}

#[test]
fn dry_run_does_not_move_previously_processed_history_again() {
    let (_dir, store) = fixture();
    let item = store.queue_outbox_message(draft()).unwrap();
    let original_folder = store.get_message(item.message_id).unwrap().folder_id;
    store.flush_outbox_dry_run().unwrap();
    assert_ne!(
        store.get_message(item.message_id).unwrap().folder_id,
        original_folder
    );
    store
        .with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET folder_id = ?1 WHERE id = ?2",
                params![original_folder, item.message_id],
            )?;
            Ok(())
        })
        .unwrap();
    store.flush_outbox_dry_run().unwrap();
    assert_eq!(
        store.get_message(item.message_id).unwrap().folder_id,
        original_folder
    );
}

#[test]
fn dry_run_rolls_back_message_move_when_queue_write_fails() {
    let (_dir, store) = fixture();
    let item = store.queue_outbox_message(draft()).unwrap();
    let original_folder = store.get_message(item.message_id).unwrap().folder_id;
    store
        .with_conn(|conn| {
            conn.execute_batch(
                "CREATE TRIGGER reject_dry_run BEFORE UPDATE ON outbox_queue
            WHEN NEW.status = 'sent_dry_run'
            BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
            )?;
            Ok(())
        })
        .unwrap();
    assert!(store.flush_outbox_dry_run().is_err());
    assert_eq!(status(&store, item.message_id), "queued");
    assert_eq!(
        store.get_message(item.message_id).unwrap().folder_id,
        original_folder
    );
}
