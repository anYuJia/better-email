use super::*;

#[test]
fn loopback_imap_headers_are_committed_to_sqlite() {
    use std::io::{BufRead, BufReader};
    use std::net::{TcpListener, TcpStream};

    // The local protocol fixture intentionally bypasses TLS; production's
    // separate transport tests cover TLS policy. No real mailbox is used.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket.write_all(b"* OK local IMAP ready\r\n").unwrap();
        let mut reader = BufReader::new(socket.try_clone().unwrap());
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 {
                break;
            }
            let tag = line.split_whitespace().next().unwrap();
            let command = line.to_ascii_uppercase();
            let response = if command.contains(" LOGIN ") {
                format!("{tag} OK logged in\r\n")
            } else if command.contains(" SELECT ") {
                format!("* 1 EXISTS\r\n* OK [UIDVALIDITY 42] generation\r\n{tag} OK [READ-WRITE] selected\r\n")
            } else if command.contains(" UID SEARCH ") {
                format!("* SEARCH 7\r\n{tag} OK search\r\n")
            } else if command.contains(" UID FETCH ") {
                let header = "From: Remote <remote@example.test>\r\nTo: local@example.test\r\nSubject: Loopback integration\r\nMessage-ID: <loopback@example.test>\r\n\r\n";
                format!(
                    "* 1 FETCH (UID 7 FLAGS () BODY[HEADER] {{{}}}\r\n{})\r\n{tag} OK fetch\r\n",
                    header.len(),
                    header
                )
            } else if command.contains(" FETCH ") {
                format!("* 1 FETCH (UID 7 FLAGS ())\r\n{tag} OK flags\r\n")
            } else if command.contains(" LOGOUT") {
                socket
                    .write_all(format!("* BYE done\r\n{tag} OK logout\r\n").as_bytes())
                    .unwrap();
                break;
            } else {
                panic!("unexpected IMAP command: {line}");
            };
            socket.write_all(response.as_bytes()).unwrap();
        }
    });
    let socket = TcpStream::connect(address).unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut session = imap::Client::new(socket).login("test", "test").unwrap();
    let result = fetch_header_page_from_session(
        &mut session,
        "INBOX",
        ImapHeaderFetchOptions {
            reset_cursor: false,
            uid_validity: "",
            highest_uid: 0,
            lowest_uid: 0,
            history_complete: false,
            include_recent: true,
            include_history: true,
        },
    )
    .unwrap();
    session.logout().unwrap();
    server.join().unwrap();
    assert_eq!(result.headers.headers[0].subject, "Loopback integration");

    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("mail.sqlite3");
    let store = crate::db::MailStore::open_at(db.clone()).unwrap();
    let account: crate::models::AccountCreateInput = serde_json::from_value(serde_json::json!({
        "email": "local@example.test", "display_name": "Local", "provider": "Local",
        "imap_host": "imap.example.test:993", "smtp_host": "smtp.example.test:465",
        "incoming_protocol": "imap", "auth_type": "password", "sync_mode": "manual",
        "remote_images_allowed": false, "signature": ""
    }))
    .unwrap();
    let account = store.create_account(account).unwrap();
    let mailbox = store
        .save_imap_mailboxes_for_account(
            Some(account.id),
            &[ImapFolderProbe {
                name: "INBOX".into(),
                delimiter: "/".into(),
                attributes: vec!["Inbox".into()],
            }],
        )
        .unwrap()
        .remove(0);
    let committed = store
        .sync_imap_mailbox_into_db(mailbox.id, &result.flags, &result.headers)
        .unwrap();
    assert_eq!(committed.imported_messages, 1);
    let repeated = store
        .sync_imap_mailbox_into_db(mailbox.id, &result.flags, &result.headers)
        .unwrap();
    assert_eq!(
        repeated.imported_messages, 0,
        "replaying a page must not duplicate mail"
    );
    drop(store);
    let reopened = crate::db::MailStore::open_at(db).unwrap();
    let inbox = reopened
        .list_folders_for_account(Some(account.id))
        .unwrap()
        .into_iter()
        .find(|folder| folder.role == "inbox")
        .unwrap();
    assert_eq!(
        reopened
            .list_messages_for_scope(
                Some(account.id),
                inbox.id,
                Some("Loopback integration".into()),
                None,
                10
            )
            .unwrap()
            .len(),
        1
    );
}
