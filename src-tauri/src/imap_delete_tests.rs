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
    let validity_response = server_validity
        .map(|value| format!("* OK [UIDVALIDITY {value}] generation\r\n"))
        .unwrap_or_default();
    let responses = format!(
        "a1 OK authenticated\r\n* 1 EXISTS\r\n{validity_response}a2 OK [READ-WRITE] selected\r\na3 OK stored\r\n* 1 EXPUNGE\r\na4 OK expunged\r\n"
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
