use super::*;
use std::io::Cursor;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
struct ScriptedImap {
    responses: Cursor<Vec<u8>>,
    commands: Arc<Mutex<Vec<u8>>>,
}

impl Read for ScriptedImap {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.responses.read(buffer)
    }
}

impl Write for ScriptedImap {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.commands.lock().unwrap().extend_from_slice(buffer);
        Ok(buffer.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn delete_session(
    server_validity: Option<u32>,
) -> (
    imap::Session<ScriptedImap>,
    Option<u32>,
    Arc<Mutex<Vec<u8>>>,
) {
    delete_session_with_capabilities(server_validity, "UIDPLUS")
}

fn delete_session_with_capabilities(
    server_validity: Option<u32>,
    capabilities: &str,
) -> (
    imap::Session<ScriptedImap>,
    Option<u32>,
    Arc<Mutex<Vec<u8>>>,
) {
    let validity_response = server_validity
        .map(|value| format!("* OK [UIDVALIDITY {value}] generation\r\n"))
        .unwrap_or_default();
    let responses = format!(
        "a1 OK authenticated\r\n* 1 EXISTS\r\n{validity_response}a2 OK [READ-WRITE] selected\r\n* CAPABILITY IMAP4rev1 {capabilities}\r\na3 OK capability\r\na4 OK stored\r\n* 1 EXPUNGE\r\na5 OK expunged\r\n"
    );
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.into_bytes()),
        commands: commands.clone(),
    })
    .login("fake-user", "fake-secret")
    .unwrap();
    let mailbox = session.select("Trash").unwrap();
    (session, mailbox.uid_validity, commands)
}

#[test]
fn missing_uidplus_never_marks_messages_deleted() {
    let (mut session, validity, commands) = delete_session_with_capabilities(Some(100), "");
    let error = delete_from_selected(&mut session, validity, &[candidate("100")]).unwrap_err();
    assert!(error.to_string().contains("不支持安全的指定邮件删除"));
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(sent.contains("CAPABILITY"));
    assert!(
        !sent.contains("STORE") && !sent.contains("EXPUNGE"),
        "{sent}"
    );
}

#[test]
fn uidplus_capability_is_case_insensitive() {
    let (mut session, validity, commands) = delete_session_with_capabilities(Some(100), "uidplus");
    delete_from_selected(&mut session, validity, &[candidate("100")]).unwrap();
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(sent.contains("UID EXPUNGE 41"));
}

fn candidate(validity: &str) -> RemoteDeleteCandidate {
    RemoteDeleteCandidate {
        remote_uid: 41,
        remote_uid_validity: validity.into(),
        message_id_header: "<cached@example.test>".into(),
    }
}

#[test]
fn changed_or_unknown_generation_never_sends_store_expunge_or_search() {
    for (server, expected) in [
        (Some(200), "100"),
        (None, "100"),
        (Some(100), ""),
        (Some(100), "0"),
    ] {
        let (mut session, validity, commands) = delete_session(server);
        let error =
            delete_from_selected(&mut session, validity, &[candidate(expected)]).unwrap_err();
        assert!(error.to_string().contains("请同步后重试"));
        let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(sent.contains("SELECT"));
        assert!(
            !sent.contains("STORE") && !sent.contains("EXPUNGE") && !sent.contains("SEARCH"),
            "{sent}"
        );
    }
}

#[test]
fn mixed_generation_batch_is_rejected_before_any_destructive_command() {
    let (mut session, validity, commands) = delete_session(Some(200));
    assert!(delete_from_selected(
        &mut session,
        validity,
        &[candidate("200"), candidate("100")]
    )
    .is_err());
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(!sent.contains("STORE") && !sent.contains("EXPUNGE"));
}

#[test]
fn matching_generation_deletes_only_the_requested_uid() {
    let (mut session, validity, commands) = delete_session(Some(100));
    let result = delete_from_selected(&mut session, validity, &[candidate("100")]).unwrap();
    assert_eq!(result.deleted_indices, vec![0]);
    assert_eq!(result.deleted_count, 1);
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(
        sent.contains("UID STORE 41 +FLAGS.SILENT (\\Deleted)"),
        "{sent}"
    );
    assert!(sent.contains("UID EXPUNGE 41"), "{sent}");
}

#[test]
fn legacy_identity_rebuild_overrides_completed_incremental_cursors() {
    let options = ImapHeaderFetchOptions {
        reset_cursor: true,
        uid_validity: "100",
        highest_uid: 999,
        lowest_uid: 1,
        history_complete: true,
        include_recent: false,
        include_history: true,
    };
    assert!(header_cursor_reset(&options, "100"));
    assert!(should_fetch_recent(
        false,
        header_cursor_reset(&options, "100"),
        0,
        0
    ));
    assert!(!header_cursor_reset(
        &ImapHeaderFetchOptions {
            reset_cursor: false,
            ..options
        },
        "100"
    ));
}

#[test]
fn changed_or_unknown_generation_rejects_body_attachment_and_flag_access() {
    for (server, expected) in [
        (Some(200), "100"),
        (None, "100"),
        (Some(100), ""),
        (Some(100), "0"),
    ] {
        let (mut session, validity, commands) = delete_session(server);
        let guarded = validate_uid_generation(validity, expected)
            .and_then(|()| ensure_uids_exist(&mut session, "41", &[41]));
        assert!(guarded.is_err());
        let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(
            !sent.contains("UID SEARCH")
                && !sent.contains("UID FETCH")
                && !sent.contains("UID STORE"),
            "{sent}"
        );
    }
    assert!(validate_uid_generation(Some(100), "100").is_ok());
}

#[test]
fn attachment_fallback_peeks_without_marking_message_read() {
    let raw = b"From: a@example.test\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=part\r\n\r\n--part\r\nContent-Type: text/plain\r\n\r\nbody\r\n--part\r\nContent-Type: text/plain; name=note.txt\r\nContent-Disposition: attachment; filename=note.txt\r\n\r\ndata\r\n--part--\r\n";
    let responses = format!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 1 FETCH (UID 41 BODY[] {{{}}}\r\n{} )\r\na3 OK fetched\r\n", raw.len(), String::from_utf8_lossy(raw));
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.into_bytes()),
        commands: commands.clone(),
    })
    .login("fake", "fake")
    .unwrap();
    session.select("INBOX").unwrap();
    let payload = fetch_attachment_payload_from_selected(&mut session, 41, "note.txt", "").unwrap();
    assert_eq!(payload.bytes, b"data");
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(sent.contains("UID FETCH 41 BODY.PEEK[]"), "{sent}");
    assert!(!sent.contains("UID FETCH 41 RFC822"), "{sent}");
}

#[test]
fn flag_write_requires_matching_generation_and_existing_uid() {
    for (server, expected, search_result, should_store) in [
        (100, "200", "41", false),
        (100, "100", "", false),
        (100, "100", "41", true),
    ] {
        let responses = format!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY {server}] generation\r\na2 OK selected\r\n* SEARCH {search_result}\r\na3 OK search\r\na4 OK stored\r\n");
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.into_bytes()),
            commands: commands.clone(),
        })
        .login("fake", "fake")
        .unwrap();
        let validity = session.select("INBOX").unwrap().uid_validity;
        let result = store_flags_from_selected(
            &mut session,
            validity,
            expected,
            &[41],
            "+FLAGS.SILENT (\\Seen)",
        );
        assert_eq!(result.is_ok(), should_store);
        let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert_eq!(sent.contains("UID STORE 41"), should_store, "{sent}");
        if expected != "100" {
            assert!(!sent.contains("UID SEARCH"), "{sent}");
        }
    }
}
