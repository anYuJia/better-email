use super::*;

fn fixture() -> (tempfile::TempDir, MailStore, ImapMailboxState) {
    let dir = tempfile::tempdir().unwrap();
    let store = MailStore::open_at_with_seed(dir.path().join("uid.sqlite3"), true).unwrap();
    let mailbox = store
        .save_imap_mailboxes(&[ImapFolderProbe {
            name: "Trash".into(),
            delimiter: "/".into(),
            attributes: vec!["Trash".into()],
        }])
        .unwrap()
        .remove(0);
    (dir, store, mailbox)
}

fn batch(validity: &str, message_id: &str) -> ImapHeaderBatch {
    ImapHeaderBatch {
        remote_name: "Trash".into(),
        uid_validity: validity.into(),
        highest_uid: 41,
        lowest_uid: 41,
        history_complete: true,
        history_scanned: true,
        cursor_reset: false,
        headers: vec![crate::models::RemoteMessageHeader {
            remote_uid: 41,
            message_id: message_id.into(),
            in_reply_to: String::new(),
            references: String::new(),
            subject: format!("generation {validity}"),
            sender_name: "Sender".into(),
            sender_email: "sender@example.test".into(),
            recipients: "demo@better-email.local".into(),
            cc: String::new(),
            bcc: String::new(),
            snippet: "preview".into(),
            received_at: "2026-11-04T00:00:00Z".into(),
            is_read: false,
            is_starred: false,
        }],
    }
}

fn current_remote_id(store: &MailStore) -> i64 {
    store
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT id FROM messages WHERE remote_mailbox='Trash' AND remote_uid=41",
                [],
                |row| row.get(0),
            )?)
        })
        .unwrap()
}

#[test]
fn generation_reset_preserves_cached_body_and_attachment_even_when_message_id_is_empty_or_reused() {
    for message_id in ["", "<reused@example.test>"] {
        let (_dir, store, mailbox) = fixture();
        store
            .import_imap_headers_batch(mailbox.id, &batch("100", message_id))
            .unwrap();
        let old_id = current_remote_id(&store);
        store.with_conn(|conn| {
            conn.execute("UPDATE messages SET body='old cached body', remote_body_fetched=1 WHERE id=?1", [old_id])?;
            conn.execute("INSERT INTO attachments(message_id,filename,mime_type,size_bytes) VALUES(?1,'keep.pdf','application/pdf',4)", [old_id])?;
            Ok(())
        }).unwrap();
        // The empty snapshot used to delete the old row before import could
        // notice UIDVALIDITY. Exercise the production atomic sync entry point.
        let mut next = batch("200", message_id);
        next.cursor_reset = true;
        let flags = ImapFlagSnapshot {
            states: vec![],
            complete: true,
            floor_uid: 0,
        };
        let result = store
            .sync_imap_mailbox_into_db(mailbox.id, &flags, &next)
            .unwrap();
        assert_eq!(result.preserved_local_copies, 1);
        let old = store.get_message(old_id).unwrap();
        assert_eq!(old.body, "old cached body");
        assert_eq!(store.list_attachments(old_id).unwrap().len(), 1);
        let old_ref = store.get_message_remote_reference(old_id).unwrap();
        assert!(
            old_ref.remote_mailbox.is_empty()
                && old_ref.remote_uid == 0
                && old_ref.remote_uid_validity.is_empty()
        );
        let new_id = current_remote_id(&store);
        assert_ne!(old_id, new_id);
        assert_eq!(
            store
                .get_message_remote_reference(new_id)
                .unwrap()
                .remote_uid_validity,
            "200"
        );
        assert!(store.get_message(new_id).unwrap().body.is_empty());
        assert!(
            store
                .delete_trash_message_if_unchanged(old_id, &old_ref)
                .unwrap(),
            "old local-only copy remains removable without remote access"
        );
        assert!(store.get_message(new_id).is_ok());
    }
}

#[test]
fn an_unknown_legacy_uid_is_not_certified_by_the_new_mailbox_generation() {
    let (dir, store, mailbox) = fixture();
    store
        .import_imap_headers_batch(mailbox.id, &batch("100", "<same@example.test>"))
        .unwrap();
    let old_id = current_remote_id(&store);
    store.set_message_remote_ref(old_id, "Trash", 41).unwrap();
    store.with_conn(|conn| {
        conn.execute("UPDATE imap_mailboxes SET highest_uid=999,lowest_uid=1,history_complete=1 WHERE id=?1", [mailbox.id])?;
        Ok(())
    }).unwrap();
    assert!(store.mailbox_needs_identity_rebuild(mailbox.id).unwrap());
    drop(store);
    let store = MailStore::open_at_with_seed(dir.path().join("uid.sqlite3"), true).unwrap();
    assert!(store
        .get_message_remote_reference(old_id)
        .unwrap()
        .remote_uid_validity
        .is_empty());
    let mut reset = batch("200", "<same@example.test>");
    reset.cursor_reset = true;
    store.import_imap_headers_batch(mailbox.id, &reset).unwrap();
    let state = store
        .list_imap_mailboxes()
        .unwrap()
        .into_iter()
        .find(|item| item.id == mailbox.id)
        .unwrap();
    assert_eq!((state.highest_uid, state.lowest_uid), (41, 41));
    assert!(!store.mailbox_needs_identity_rebuild(mailbox.id).unwrap());
    assert_ne!(current_remote_id(&store), old_id);
    assert!(store
        .get_message_remote_reference(old_id)
        .unwrap()
        .remote_mailbox
        .is_empty());
}

#[test]
fn same_generation_refresh_keeps_the_cached_row_and_persists_identity_across_restart() {
    let (dir, store, mailbox) = fixture();
    store
        .import_imap_headers_batch(mailbox.id, &batch("100", "<same@example.test>"))
        .unwrap();
    let id = current_remote_id(&store);
    store
        .import_imap_headers_batch(mailbox.id, &batch("100", "<same@example.test>"))
        .unwrap();
    assert_eq!(current_remote_id(&store), id);
    drop(store);
    let store = MailStore::open_at_with_seed(dir.path().join("uid.sqlite3"), true).unwrap();
    assert_eq!(
        store
            .get_message_remote_reference(id)
            .unwrap()
            .remote_uid_validity,
        "100"
    );
}
