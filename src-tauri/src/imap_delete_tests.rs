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
    assert!(header_cursor_reset(
        &ImapHeaderFetchOptions {
            reset_cursor: false,
            uid_validity: "",
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
    assert!(sent.contains("UID FETCH 41 (UID BODY.PEEK[])"), "{sent}");
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

#[test]
fn custom_keywords_do_not_impersonate_system_flags() {
    let responses = "a1 OK authenticated\r\n* 2 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 1 FETCH (UID 41 FLAGS (NotSeen $HasFlagged))\r\n* 2 FETCH (UID 42 FLAGS (\\seen \\FLAGGED))\r\na3 OK fetched\r\n";
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.as_bytes().to_vec()),
        commands,
    })
    .login("fake", "fake")
    .unwrap();
    let count = session.select("INBOX").unwrap().exists;
    let snapshot = fetch_recent_flag_snapshot(&mut session, count).unwrap();
    assert_eq!(snapshot.states.len(), 2);
    assert!(!snapshot.states[0].is_read && !snapshot.states[0].is_starred);
    assert!(snapshot.states[1].is_read && snapshot.states[1].is_starred);
}

#[test]
fn repeated_fetch_responses_do_not_form_a_complete_snapshot() {
    for fetched in [
        "* 1 FETCH (UID 41 FLAGS ())\r\n* 1 FETCH (UID 41 FLAGS (\\Seen))\r\n",
        "* 1 FETCH (UID 41 FLAGS ())\r\n* 2 FETCH (UID 41 FLAGS (\\Seen))\r\n",
    ] {
        let responses = format!("a1 OK authenticated\r\n* 2 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n{fetched}a3 OK fetched\r\n");
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.into_bytes()),
            commands,
        })
        .login("fake", "fake")
        .unwrap();
        let count = session.select("INBOX").unwrap().exists;
        assert!(fetch_recent_flag_snapshot(&mut session, count).is_err());
    }
}

#[test]
fn header_batch_must_include_each_requested_header_before_advancing() {
    let header_a = "Subject: First\r\n\r\n";
    let header_b = "Subject: Second\r\n\r\n";
    for complete in [false, true] {
        let second = if complete {
            format!(
                "* 2 FETCH (UID 42 FLAGS () BODY[HEADER] {{{}}}\r\n{})\r\n",
                header_b.len(),
                header_b
            )
        } else {
            "* 2 FETCH (UID 42 FLAGS (\\Seen))\r\n".to_string()
        };
        let responses = format!("a1 OK authenticated\r\n* 2 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 9 FETCH (UID 999 FLAGS (\\Seen))\r\n* 1 FETCH (UID 41 FLAGS () BODY[HEADER] {{{}}}\r\n{})\r\n{second}a3 OK fetched\r\n", header_a.len(), header_a);
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.into_bytes()),
            commands,
        })
        .login("fake", "fake")
        .unwrap();
        session.select("INBOX").unwrap();
        let result = fetch_requested_headers(&mut session, &[41, 42]);
        assert_eq!(result.is_ok(), complete);
        if let Ok(headers) = result {
            assert_eq!(
                headers.iter().map(|h| h.remote_uid).collect::<Vec<_>>(),
                vec![41, 42]
            );
        }
    }
}

#[test]
fn duplicate_attachment_names_without_identity_do_not_return_wrong_part() {
    let raw = concat!(
        "MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n",
        "--b\r\nContent-Type: text/plain; name=report.txt\r\nContent-Disposition: attachment; filename=report.txt\r\n\r\nfirst\r\n",
        "--b\r\nContent-Type: text/plain; name=report.txt\r\nContent-Disposition: attachment; filename=report.txt\r\n\r\nsecond\r\n--b--\r\n"
    );
    assert!(parse_attachment_payload_from_raw(raw.as_bytes(), "report.txt", "").is_none());
    let response = b"* 1 FETCH (BODYSTRUCTURE ((\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"BASE64\" 4 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL)(\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"BASE64\" 8 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL) \"MIXED\" NIL NIL NIL))\r\n";
    let (_, parsed) = imap_proto::parser::parse_response(response).unwrap();
    let imap_proto::types::Response::Fetch(_, attributes) = parsed else {
        panic!("expected FETCH")
    };
    let structure = attributes
        .iter()
        .find_map(|attr| match attr {
            imap_proto::types::AttributeValue::BodyStructure(value) => Some(value),
            _ => None,
        })
        .unwrap();
    assert!(attachment_part_metadata(structure, "report.txt", "").is_none());
}

#[test]
fn duplicate_inline_content_ids_are_not_silently_deduplicated() {
    let raw = concat!(
        "MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=b\r\n\r\n",
        "--b\r\nContent-Type: text/html\r\n\r\n<img src=cid:duplicate@example.test>\r\n",
        "--b\r\nContent-Type: image/png\r\nContent-ID: <duplicate@example.test>\r\nContent-Transfer-Encoding: base64\r\n\r\nZmlyc3Q=\r\n",
        "--b\r\nContent-Type: image/png\r\nContent-ID: <duplicate@example.test>\r\nContent-Transfer-Encoding: base64\r\n\r\nc2Vjb25k\r\n--b--\r\n"
    );
    assert!(
        parse_attachment_payload_from_raw(raw.as_bytes(), "", "duplicate@example.test").is_none()
    );
}

#[test]
fn ambiguous_bodystructure_never_falls_back_to_first_full_message_match() {
    let responses = concat!(
        "a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n",
        "* 1 FETCH (UID 41 BODYSTRUCTURE ((\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"BASE64\" 4 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL)(\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"BASE64\" 8 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL) \"MIXED\" NIL NIL NIL))\r\na3 OK fetched\r\n"
    );
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.as_bytes().to_vec()),
        commands: commands.clone(),
    })
    .login("fake", "fake")
    .unwrap();
    session.select("INBOX").unwrap();
    let options = AttachmentDownloadOptions {
        remote_name: "INBOX",
        remote_uid: 41,
        remote_uid_validity: "100",
        filename: "report.txt",
        content_id: "",
        remote_part_path: "",
        max_bytes: 1024,
        start_offset: 0,
    };
    let mut bytes = Vec::new();
    assert!(matches!(
        download_attachment_from_selected(&mut session, options, 0, &mut bytes),
        Err(MailError::AttachmentAmbiguous)
    ));
    assert!(bytes.is_empty());
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(sent.contains("BODYSTRUCTURE"));
    assert!(!sent.contains("BODY.PEEK[]"), "{sent}");
}

#[test]
fn oversized_resume_is_rejected_before_fetching_or_writing() {
    let (mut session, _validity, commands) = delete_session(Some(100));
    let mut output = Vec::new();
    let part = AttachmentPartMetadata {
        path: vec![2],
        transfer_encoding: AttachmentTransferEncoding::Identity,
        encoded_octets: 4,
    };
    let error =
        download_attachment_part_to_writer(&mut session, 41, "file.txt", 100, 5, &mut output, part)
            .err()
            .expect("oversized partial must be rejected");
    assert!(error.to_string().contains("超过服务器声明"));
    assert!(output.is_empty());
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(!sent.contains("UID FETCH"), "{sent}");
}

#[test]
fn same_name_attachments_use_verified_mime_sections_and_requested_uid() {
    let structure = "((\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"7BIT\" 5 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL)(\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"7BIT\" 6 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL) \"MIXED\" NIL NIL NIL)";
    for (section, payload) in [("1", "first"), ("2", "second")] {
        let responses = format!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 1 FETCH (UID 41 BODYSTRUCTURE {structure})\r\na3 OK fetched\r\n* 2 FETCH (UID 99 BODY[{section}]<0> {{5}}\r\nwrong)\r\n* 1 FETCH (UID 41 BODY[{section}]<0> {{{}}}\r\n{payload})\r\na4 OK fetched\r\n", payload.len());
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.into_bytes()),
            commands: commands.clone(),
        })
        .login("fake", "fake")
        .unwrap();
        session.select("INBOX").unwrap();
        let options = AttachmentDownloadOptions {
            remote_name: "INBOX",
            remote_uid: 41,
            remote_uid_validity: "100",
            filename: "report.txt",
            content_id: "",
            remote_part_path: section,
            max_bytes: 1024,
            start_offset: 0,
        };
        let mut bytes = Vec::new();
        download_attachment_from_selected(&mut session, options, 0, &mut bytes)
            .expect("verified section downloads");
        assert_eq!(bytes, payload.as_bytes());
        let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(sent.contains(&format!("BODY.PEEK[{section}]")), "{sent}");
    }
}

#[test]
fn wrong_or_malformed_mime_section_never_falls_back() {
    for section in ["3", "01", "1.0", "1\r\nEXPUNGE"] {
        let responses = concat!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n", "* 1 FETCH (UID 41 BODYSTRUCTURE ((\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"report.txt\") NIL NIL \"7BIT\" 5 NIL (\"ATTACHMENT\" (\"FILENAME\" \"report.txt\")) NIL) \"MIXED\" NIL NIL NIL))\r\na3 OK fetched\r\n");
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.as_bytes().to_vec()),
            commands: commands.clone(),
        })
        .login("fake", "fake")
        .unwrap();
        session.select("INBOX").unwrap();
        let options = AttachmentDownloadOptions {
            remote_name: "INBOX",
            remote_uid: 41,
            remote_uid_validity: "100",
            filename: "report.txt",
            content_id: "",
            remote_part_path: section,
            max_bytes: 1024,
            start_offset: 0,
        };
        let mut bytes = Vec::new();
        assert!(matches!(
            download_attachment_from_selected(&mut session, options, 0, &mut bytes),
            Err(MailError::AttachmentIdentityChanged)
        ));
        assert!(bytes.is_empty());
        let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(!sent.contains("BODY.PEEK"), "{sent}");
    }
}

#[test]
fn body_fetch_ignores_unsolicited_other_message_data() {
    for (path, section) in [(Vec::<u32>::new(), "TEXT"), (vec![1], "1")] {
        let responses = format!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 2 FETCH (UID 99 BODY[{section}] {{5}}\r\nwrong)\r\n* 1 FETCH (UID 41 BODY[{section}] {{5}}\r\nright)\r\na3 OK fetched\r\n");
        let commands = Arc::new(Mutex::new(Vec::new()));
        let mut session = imap::Client::new(ScriptedImap {
            responses: Cursor::new(responses.into_bytes()),
            commands,
        })
        .login("fake", "fake")
        .unwrap();
        session.select("INBOX").unwrap();
        assert_eq!(
            fetch_message_text_part(&mut session, 41, &path).unwrap(),
            b"right"
        );
    }
}

#[test]
fn single_part_attachment_uses_section_one() {
    let response = b"* 1 FETCH (UID 41 BODYSTRUCTURE (\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"only.bin\") NIL NIL \"7BIT\" 5 NIL (\"ATTACHMENT\" (\"FILENAME\" \"only.bin\")) NIL))\r\n";
    let (_, parsed) = imap_proto::parser::parse_response(response).unwrap();
    let imap_proto::types::Response::Fetch(_, attributes) = parsed else {
        panic!("expected FETCH")
    };
    let structure = attributes
        .iter()
        .find_map(|attr| match attr {
            imap_proto::types::AttributeValue::BodyStructure(value) => Some(value),
            _ => None,
        })
        .unwrap();
    let metadata = message_structure_metadata(structure);
    assert_eq!(metadata.attachments[0].remote_part_path, "1");
    assert_eq!(
        attachment_part_metadata(structure, "only.bin", "")
            .unwrap()
            .path,
        vec![1]
    );
}

#[test]
fn single_part_attachment_downloads_section_one() {
    let responses = concat!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n", "* 1 FETCH (UID 41 BODYSTRUCTURE (\"APPLICATION\" \"OCTET-STREAM\" (\"NAME\" \"only.bin\") NIL NIL \"7BIT\" 5 NIL (\"ATTACHMENT\" (\"FILENAME\" \"only.bin\")) NIL))\r\na3 OK fetched\r\n", "* 1 FETCH (UID 41 BODY[1]<0> {5}\r\nhello)\r\na4 OK fetched\r\n");
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.as_bytes().to_vec()),
        commands: commands.clone(),
    })
    .login("fake", "fake")
    .unwrap();
    session.select("INBOX").unwrap();
    let options = AttachmentDownloadOptions {
        remote_name: "INBOX",
        remote_uid: 41,
        remote_uid_validity: "100",
        filename: "only.bin",
        content_id: "",
        remote_part_path: "1",
        max_bytes: 1024,
        start_offset: 0,
    };
    let mut bytes = Vec::new();
    download_attachment_from_selected(&mut session, options, 0, &mut bytes)
        .expect("single part downloads");
    assert_eq!(bytes, b"hello");
    let sent = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
    assert!(sent.contains("BODY.PEEK[1]"), "{sent}");
}

#[test]
fn full_message_attachment_fallback_ignores_other_message_uid() {
    let raw_wrong = "Content-Type: text/plain; name=note.txt\r\nContent-Disposition: attachment; filename=note.txt\r\n\r\nwrong";
    let raw_right = "Content-Type: text/plain; name=note.txt\r\nContent-Disposition: attachment; filename=note.txt\r\n\r\nright";
    let responses = format!("a1 OK authenticated\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 100] generation\r\na2 OK selected\r\n* 2 FETCH (UID 99 BODY[] {{{}}}\r\n{raw_wrong})\r\n* 1 FETCH (UID 41 BODY[] {{{}}}\r\n{raw_right})\r\na3 OK fetched\r\n", raw_wrong.len(), raw_right.len());
    let commands = Arc::new(Mutex::new(Vec::new()));
    let mut session = imap::Client::new(ScriptedImap {
        responses: Cursor::new(responses.into_bytes()),
        commands,
    })
    .login("fake", "fake")
    .unwrap();
    session.select("INBOX").unwrap();
    let payload = fetch_attachment_payload_from_selected(&mut session, 41, "note.txt", "").unwrap();
    assert_eq!(payload.bytes, b"right");
}
