#[test]
fn opening_store_does_not_move_legacy_secrets_to_keychain() {
    // 回归测试：旧版本保存在 SQLite account_credentials 中的明文凭据，
    // 在启动路径上必须原样保留，不得被迁移进系统凭据库（那会触发
    // Keychain 写入/授权提示）。迁移只允许在用户执行邮件操作时惰性发生。
    let db_path = test_database_path("better-email-no-startup-migration");
    let store = MailStore::open_at(db_path.clone()).expect("store opens");
    store
        .with_conn(|conn| {
            conn.execute(
                "INSERT INTO accounts(id, email, display_name, provider, created_at)
                 VALUES (900, 'legacy@example.com', 'Legacy', 'gmail', '2026-07-15')",
                [],
            )?;
            conn.execute(
                "INSERT INTO account_credentials(account_email, secret, updated_at)
                 VALUES ('legacy@example.com', 'LEGACY_PLAINTEXT_SECRET', '2026-07-15')",
                [],
            )?;
            Ok(())
        })
        .expect("legacy secret seeded");

    let reopened = MailStore::open_at(db_path).expect("store reopens");
    let remaining: i64 = reopened
        .with_conn(|conn| {
            Ok(conn.query_row(
                "SELECT COUNT(*) FROM account_credentials
                 WHERE account_email = 'legacy@example.com' AND secret = 'LEGACY_PLAINTEXT_SECRET'",
                [],
                |row| row.get::<_, i64>(0),
            )?)
        })
        .expect("legacy row still queryable");
    assert_eq!(
        remaining, 1,
        "startup must not migrate or erase SQLite secrets"
    );
}

#[test]
fn attachment_metadata_backfill_does_not_replace_cached_body() {
    let store = test_store();
    let message_id = seed_remote_message(&store, "Attachment metadata backfill", 10);
    store
        .update_message_body(
            message_id,
            &RemoteMessageBody {
                body: "cached historical body".to_string(),
                sanitized_html: String::new(),
                security_warnings: Vec::new(),
                snippet: "cached historical body".to_string(),
                has_attachments: false,
                attachments: Vec::new(),
            },
        )
        .unwrap();
    store
        .with_conn(|conn| {
            conn.execute(
                "UPDATE messages SET attachment_metadata_synced = 0 WHERE id = ?1",
                params![message_id],
            )?;
            Ok(())
        })
        .unwrap();

    let updated = store
        .update_message_attachments(
            message_id,
            &[remote_attachment(
                "history.pdf",
                "application/pdf",
                128,
                "",
                false,
            )],
        )
        .unwrap();
    assert_eq!(updated.body, "cached historical body");
    assert!(updated.has_attachments);
    assert_eq!(updated.attachment_count, 1);
    assert!(store
        .list_messages_missing_attachment_metadata(updated.account_id, "INBOX", 10)
        .unwrap()
        .is_empty());
}

#[test]
fn all_mail_contact_scan_is_explicit_idempotent_and_initial_scan_runs_once() {
    let store = test_store();
    assert!(store.should_auto_scan_recent_contacts().unwrap());

    let first = store.scan_recent_contacts(true).unwrap();
    assert!(!first.skipped);
    assert!(first.scanned_messages >= 1);
    assert!(store
        .list_contacts()
        .unwrap()
        .iter()
        .any(|contact| contact.email == "team@example.com"));
    assert!(store
        .list_contacts()
        .unwrap()
        .iter()
        .any(|contact| contact.email == "ada@example.com"));
    assert!(!store.should_auto_scan_recent_contacts().unwrap());

    let repeated_initial = store.scan_recent_contacts(true).unwrap();
    assert!(repeated_initial.skipped);
    let manual = store.scan_recent_contacts(false).unwrap();
    assert!(!manual.skipped);
}

#[test]
fn imap_headers_collect_sender_recipients_and_merge_alias_addresses() {
    let store = test_store();
    let account = store.get_account().unwrap();
    let existing = store
        .create_contact_for_account(
            account.id,
            ContactCreateInput {
                name: "Existing Person".to_string(),
                email: "person@example.com".to_string(),
                aliases: vec!["alias@example.com".to_string()],
                vip: false,
            },
        )
        .unwrap();
    let mailbox = store
        .save_imap_mailboxes(&[ImapFolderProbe {
            name: "INBOX".to_string(),
            delimiter: "/".to_string(),
            attributes: vec!["Inbox".to_string()],
        }])
        .unwrap()
        .remove(0);
    let batch = ImapHeaderBatch {
        remote_name: "INBOX".to_string(),
        uid_validity: "88".to_string(),
        highest_uid: 88,
        lowest_uid: 88,
        history_complete: false,
        history_scanned: true,
        cursor_reset: false,
        headers: vec![crate::models::RemoteMessageHeader {
            remote_uid: 88,
            message_id: "<all-participants@example.com>".to_string(),
            in_reply_to: String::new(),
            references: String::new(),
            subject: "All participants".to_string(),
            sender_name: "Sender Person".to_string(),
            sender_email: "sender@example.com".to_string(),
            recipients: "Primary Person <person@example.com>, To Person <to@example.com>"
                .to_string(),
            cc: "Alias Person <alias@example.com>".to_string(),
            bcc: "Blind Person <blind@example.com>".to_string(),
            snippet: "header".to_string(),
            received_at: "2026-08-25T10:00:00Z".to_string(),
            is_read: true,
            is_starred: false,
        }],
    };

    store.import_imap_headers(mailbox.id, &batch).unwrap();
    store.import_imap_headers(mailbox.id, &batch).unwrap();

    let contacts = store.list_contacts_for_account(Some(account.id)).unwrap();
    let sender = contacts
        .iter()
        .find(|contact| contact.email == "sender@example.com")
        .unwrap();
    assert_eq!(sender.name, "Sender Person");
    assert_eq!(sender.message_count, 1);
    let recipient = contacts
        .iter()
        .find(|contact| contact.email == "to@example.com")
        .unwrap();
    assert_eq!(recipient.name, "To Person");
    assert_eq!(recipient.message_count, 1);
    let merged = contacts
        .iter()
        .find(|contact| contact.id == existing.id)
        .unwrap();
    assert_eq!(merged.name, "Existing Person");
    assert_eq!(merged.message_count, 1);
    assert!(merged
        .aliases
        .iter()
        .any(|alias| alias == "alias@example.com"));
    assert!(!contacts
        .iter()
        .any(|contact| contact.email == "alias@example.com"));
    let blind = contacts
        .iter()
        .find(|contact| contact.email == "blind@example.com")
        .unwrap();
    assert_eq!(blind.message_count, 1);
}
