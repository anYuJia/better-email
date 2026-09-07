use super::*;
use crate::db::ai_settings::AiSettingsRecord;
use std::sync::{Arc, Barrier};

fn input(email: &str) -> AccountCreateInput {
    AccountCreateInput {
        email: email.into(),
        display_name: "Test".into(),
        provider: "custom".into(),
        imap_host: "imap.example.com:993".into(),
        smtp_host: "smtp.example.com:587".into(),
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
    }
}

fn fixture() -> (tempfile::TempDir, MailStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = MailStore::open_at_with_seed(dir.path().join("mail.sqlite3"), false).unwrap();
    (dir, store)
}

fn count(store: &MailStore, table: &str) -> i64 {
    store
        .with_conn(|conn| {
            Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?)
        })
        .unwrap()
}

fn token(value: &str) -> String {
    serde_json::json!({"provider":"gmail","access_token":value,"refresh_token":"refresh",
        "token_type":"Bearer","scope":"mail","expires_at":"2099-01-01T00:00:00Z",
        "stored_at":"2026-01-01T00:00:00Z"})
    .to_string()
}

fn oauth_account(store: &MailStore) -> Account {
    let mut draft = input("oauth@example.com");
    draft.auth_type = "oauth2".into();
    store
        .create_account_with_secret(draft, &token("first"))
        .unwrap()
}

#[test]
fn atomic_login_persists_encrypted_credentials_across_reopen() {
    let (dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("USER@example.com"), "app-password")
        .unwrap();
    let stored = store.credential_snapshot(&account).unwrap();
    assert!(stored.starts_with("be1:"));
    assert!(!stored.contains("app-password"));
    drop(store);
    let store = MailStore::open_at_with_seed(dir.path().join("mail.sqlite3"), false).unwrap();
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        "app-password"
    );
    assert!(
        store
            .check_account_secret("USER@example.com")
            .unwrap()
            .exists
    );
}

#[test]
fn failed_secret_insert_rolls_back_account_folders_and_identity() {
    let (_dir, store) = fixture();
    store.with_conn(|conn| {
        conn.execute_batch("CREATE TRIGGER reject_credentials BEFORE INSERT ON account_credentials BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;")?;
        Ok(())
    }).unwrap();
    assert!(store
        .create_account_with_secret(input("new@example.com"), "secret")
        .is_err());
    for table in [
        "accounts",
        "folders",
        "mail_identities",
        "account_credentials",
    ] {
        assert_eq!(count(&store, table), 0);
    }
}

#[test]
fn failed_readback_rolls_back_entire_login() {
    let (_dir, store) = fixture();
    store.with_conn(|conn| {
        conn.execute_batch("CREATE TRIGGER corrupt_credentials AFTER INSERT ON account_credentials BEGIN UPDATE account_credentials SET secret = 'unexpected' WHERE account_email = NEW.account_email; END;")?;
        Ok(())
    }).unwrap();
    assert!(store
        .create_account_with_secret(input("new@example.com"), "secret")
        .is_err());
    assert!(store.list_accounts().unwrap().is_empty());
    assert_eq!(count(&store, "account_credentials"), 0);
}

#[test]
fn failed_account_dependencies_roll_back_legacy_creation_too() {
    let (_dir, store) = fixture();
    store.with_conn(|conn| {
        conn.execute_batch("CREATE TRIGGER reject_folders BEFORE INSERT ON folders BEGIN SELECT RAISE(ABORT, 'simulated folder failure'); END;")?;
        Ok(())
    }).unwrap();
    assert!(store.create_account(input("new@example.com")).is_err());
    assert!(store.list_accounts().unwrap().is_empty());
}

#[test]
fn blank_or_malformed_credentials_do_not_create_an_account() {
    let (_dir, store) = fixture();
    assert!(store
        .create_account_with_secret(input("new@example.com"), "  ")
        .is_err());
    let mut draft = input("oauth@example.com");
    draft.auth_type = "oauth2".into();
    assert!(store.create_account_with_secret(draft, "not-json").is_err());
    assert!(store.list_accounts().unwrap().is_empty());
    assert!(!store.data_dir.join("credentials.key").exists());
}

#[test]
fn duplicate_login_cannot_replace_existing_credential() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    assert!(store
        .create_account_with_secret(input("SAVED@example.com"), "replacement")
        .is_err());
    assert_eq!(store.get_account_secret_raw(&account).unwrap(), "original");
}

#[test]
fn independent_connections_create_only_one_complete_login() {
    let (dir, first) = fixture();
    let second = MailStore::open_at_with_seed(dir.path().join("mail.sqlite3"), false).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let gate = barrier.clone();
    let worker = std::thread::spawn(move || {
        gate.wait();
        second.create_account_with_secret(input("race@example.com"), "second")
    });
    barrier.wait();
    let one = first.create_account_with_secret(input("race@example.com"), "first");
    let two = worker.join().unwrap();
    assert_ne!(one.is_ok(), two.is_ok());
    let account = first.get_account().unwrap();
    assert!(first.check_account_secret(&account.email).unwrap().exists);
    assert_eq!(count(&first, "accounts"), 1);
    assert_eq!(count(&first, "account_credentials"), 1);
}

#[test]
fn local_health_distinguishes_missing_from_unreadable_and_does_not_write() {
    let (_dir, store) = fixture();
    let account = store.create_account(input("saved@example.com")).unwrap();
    assert_eq!(
        store.check_account_secret(&account.email).unwrap().status,
        "not_found"
    );
    assert!(!store.data_dir.join("credentials.key").exists());
    store
        .store_account_secret(&account.email, "original")
        .unwrap();
    let cipher = store.credential_snapshot(&account).unwrap();
    std::fs::remove_file(store.data_dir.join("credentials.key")).unwrap();
    assert_eq!(
        store.check_account_secret(&account.email).unwrap().status,
        "key_missing"
    );
    assert!(!store.data_dir.join("credentials.key").exists());
    assert_eq!(store.credential_snapshot(&account).unwrap(), cipher);
    std::fs::write(store.data_dir.join("credentials.key"), b"damaged").unwrap();
    assert_eq!(
        store.check_account_secret(&account.email).unwrap().status,
        "unreadable"
    );
    assert_eq!(
        std::fs::read(store.data_dir.join("credentials.key")).unwrap(),
        b"damaged"
    );
}

#[test]
fn new_login_and_ai_save_never_generate_a_replacement_for_missing_key() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    let cipher = store.credential_snapshot(&account).unwrap();
    let key_path = store.data_dir.join("credentials.key");
    std::fs::remove_file(&key_path).unwrap();
    assert!(store
        .create_account_with_secret(input("other@example.com"), "second")
        .is_err());
    assert!(store
        .store_account_secret(&account.email, "replacement")
        .is_err());
    let record = AiSettingsRecord {
        enabled: true,
        service_type: "openai-compatible".into(),
        endpoint: "https://example.com".into(),
        api_key: "api-secret".into(),
        model: "test".into(),
        timeout_seconds: 30,
        privacy_acknowledged: true,
        mcp_enabled: false,
        mcp_endpoint: String::new(),
        mcp_api_key: String::new(),
    };
    assert!(store.save_ai_settings(&record).is_err());
    assert!(!key_path.exists());
    assert_eq!(count(&store, "accounts"), 1);
    assert_eq!(store.credential_snapshot(&account).unwrap(), cipher);
}

#[test]
fn ai_ciphertext_alone_also_prevents_automatic_key_recreation() {
    let (_dir, store) = fixture();
    let mut record = store.load_ai_settings().unwrap();
    record.api_key = "api-secret".into();
    store.save_ai_settings(&record).unwrap();
    std::fs::remove_file(store.data_dir.join("credentials.key")).unwrap();
    assert!(store
        .create_account_with_secret(input("new@example.com"), "secret")
        .is_err());
    assert!(!store.data_dir.join("credentials.key").exists());
}

#[test]
fn reentering_a_missing_secret_preserves_account_and_folders() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    let folders = count(&store, "folders");
    store.delete_account_secret(&account.email).unwrap();
    assert!(
        store
            .store_account_secret_bound(&account.email, "new", Some(account.id), Some("password"))
            .unwrap()
            .exists
    );
    assert_eq!(store.get_account().unwrap().id, account.id);
    assert_eq!(count(&store, "folders"), folders);
    assert_eq!(store.get_account_secret_raw(&account).unwrap(), "new");
}

#[test]
fn failed_update_keeps_previous_credential() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    store.with_conn(|conn| {
        conn.execute_batch("CREATE TRIGGER reject_update BEFORE UPDATE ON account_credentials BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;")?;
        Ok(())
    }).unwrap();
    assert!(store
        .store_account_secret(&account.email, "replacement")
        .is_err());
    assert_eq!(store.get_account_secret_raw(&account).unwrap(), "original");
}

#[test]
fn bound_save_rejects_stale_identity_auth_type_and_deleted_accounts() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    assert!(store
        .store_account_secret_bound(
            &account.email,
            "new",
            Some(account.id + 1),
            Some("password")
        )
        .is_err());
    assert!(store
        .store_account_secret_bound(&account.email, "new", Some(account.id), Some("oauth2"))
        .is_err());
    assert_eq!(store.get_account_secret_raw(&account).unwrap(), "original");
    store.delete_account(account.id).unwrap();
    assert!(store
        .store_account_secret_bound(&account.email, "new", Some(account.id), Some("password"))
        .is_err());
    assert!(!store.check_account_secret(&account.email).unwrap().exists);
}

#[test]
fn blank_save_does_not_clear_existing_credential() {
    let (_dir, store) = fixture();
    let account = store
        .create_account_with_secret(input("saved@example.com"), "original")
        .unwrap();
    assert!(
        !store
            .store_account_secret(&account.email, "  ")
            .unwrap()
            .exists
    );
    assert_eq!(store.get_account_secret_raw(&account).unwrap(), "original");
}

#[test]
fn malformed_oauth_health_is_not_reported_as_saved_and_exposes_no_token() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    store
        .with_conn(|conn| {
            conn.execute(
                "UPDATE account_credentials SET secret = 'sensitive-invalid-token'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let health = store.check_account_secret(&account.email).unwrap();
    assert_eq!(health.status, "invalid");
    assert!(!serde_json::to_string(&health)
        .unwrap()
        .contains("sensitive-invalid-token"));
}

#[test]
fn legacy_plaintext_can_be_read_and_is_encrypted_on_next_save() {
    let (_dir, store) = fixture();
    let account = store.create_account(input("legacy@example.com")).unwrap();
    store.with_conn(|conn| { conn.execute("INSERT INTO account_credentials(account_email, secret, updated_at) VALUES (?1, 'legacy-password', '')", params![account.email])?; Ok(()) }).unwrap();
    assert!(store.check_account_secret(&account.email).unwrap().exists);
    assert!(!store.data_dir.join("credentials.key").exists());
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        "legacy-password"
    );
    store
        .store_account_secret(&account.email, "legacy-password")
        .unwrap();
    assert!(store
        .credential_snapshot(&account)
        .unwrap()
        .starts_with("be1:"));
}

#[test]
fn refresh_compare_and_swap_accepts_only_unchanged_credentials() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let previous = store.credential_snapshot(&account).unwrap();
    assert!(store
        .replace_refreshed_secret(&account, &previous, &token("refreshed"))
        .unwrap());
    assert!(!store
        .replace_refreshed_secret(&account, &previous, &token("late"))
        .unwrap());
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        token("refreshed")
    );
}

#[test]
fn stale_refresh_does_not_overwrite_reauthentication_or_resurrect_deleted_secret() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let previous = store.credential_snapshot(&account).unwrap();
    store
        .store_account_secret(&account.email, &token("manual"))
        .unwrap();
    assert!(!store
        .replace_refreshed_secret(&account, &previous, &token("late"))
        .unwrap());
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        token("manual")
    );
    let previous = store.credential_snapshot(&account).unwrap();
    store.delete_account_secret(&account.email).unwrap();
    assert!(!store
        .replace_refreshed_secret(&account, &previous, &token("late"))
        .unwrap());
    assert_eq!(
        store.check_account_secret(&account.email).unwrap().status,
        "not_found"
    );
}

#[test]
fn deleted_or_reconfigured_account_cannot_receive_late_refresh() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let previous = store.credential_snapshot(&account).unwrap();
    store
        .with_conn(|conn| {
            conn.execute(
                "UPDATE accounts SET auth_type = 'password' WHERE id = ?1",
                params![account.id],
            )?;
            Ok(())
        })
        .unwrap();
    assert!(!store
        .replace_refreshed_secret(&account, &previous, &token("late"))
        .unwrap());
    assert!(store.get_account_secret_raw(&account).is_err());
    store.delete_account(account.id).unwrap();
    assert!(!store
        .replace_refreshed_secret(&account, &previous, &token("late"))
        .unwrap());
    assert_eq!(count(&store, "account_credentials"), 0);
}

#[test]
fn unavailable_accounts_do_not_starve_healthy_unified_sync_batches() {
    let (_dir, store) = fixture();
    for index in 0..6 {
        store
            .create_account(input(&format!("missing{index}@example.com")))
            .unwrap();
    }
    let ready = store
        .create_account_with_secret(input("healthy@example.com"), "secret")
        .unwrap();
    let plan = store.header_sync_schedule_plan(None, 2).unwrap();
    assert_eq!(plan.total_accounts, 7);
    assert_eq!(plan.batch_accounts.len(), 1);
    assert_eq!(plan.batch_accounts[0].id, ready.id);
    assert_eq!(plan.credential_issues.len(), 6);
    assert!(plan.delayed_accounts.is_empty());
}

fn session(store: &MailStore, account: &Account) -> OAuthTokenExchangeSession {
    let report = store
        .save_oauth_session_for_account(
            OAuthStartReport {
                session_id: 0,
                provider: account.provider.clone(),
                authorization_url: "https://example.com/auth".into(),
                redirect_uri: "http://127.0.0.1:17645/oauth/callback".into(),
                state: uuid::Uuid::new_v4().to_string(),
                code_challenge: "challenge".into(),
                code_verifier_hint: "hint".into(),
                scopes: vec!["mail".into()],
                message: "pending".into(),
            },
            "verifier",
            Some(account.id),
        )
        .unwrap();
    store
        .complete_oauth_callback(&report.state, "code")
        .unwrap();
    store
        .oauth_session_for_token_exchange(report.session_id)
        .unwrap()
}

#[test]
fn oauth_sessions_are_bound_to_selected_not_default_account() {
    let (_dir, store) = fixture();
    let first = store
        .create_account_with_secret(input("default@example.com"), "default-secret")
        .unwrap();
    let selected = oauth_account(&store);
    let session = session(&store, &selected);
    assert_eq!(
        store.oauth_account_for_session(session.id).unwrap().id,
        selected.id
    );
    assert!(store
        .list_oauth_sessions_for_account(Some(first.id))
        .unwrap()
        .is_empty());
    assert_eq!(
        store
            .list_oauth_sessions_for_account(Some(selected.id))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        store.get_account_secret_raw(&first).unwrap(),
        "default-secret"
    );
}

#[test]
fn oauth_exchange_commits_secret_and_session_together_and_late_failure_cannot_downgrade() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let session = session(&store, &account);
    let previous = store.credential_snapshot_optional(&account).unwrap();
    store
        .store_oauth_exchange_result(
            &account,
            &session,
            previous.as_deref(),
            &token("exchanged"),
            "2099-01-01",
        )
        .unwrap();
    store
        .mark_oauth_token_exchange_failed(session.id, "late error")
        .unwrap();
    assert_eq!(
        store.list_oauth_sessions().unwrap()[0].status,
        "token_stored"
    );
    assert!(store.oauth_session_for_token_exchange(session.id).is_err());
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        token("exchanged")
    );
    assert!(store
        .store_oauth_exchange_result(&account, &session, previous.as_deref(), &token("late"), "")
        .is_err());
}

#[test]
fn oauth_exchange_rolls_back_session_if_secret_storage_fails() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let session = session(&store, &account);
    let previous = store.credential_snapshot_optional(&account).unwrap();
    store.with_conn(|conn| { conn.execute_batch("CREATE TRIGGER reject_oauth_update BEFORE UPDATE ON account_credentials BEGIN SELECT RAISE(ABORT, 'disk failure'); END;")?; Ok(()) }).unwrap();
    assert!(store
        .store_oauth_exchange_result(&account, &session, previous.as_deref(), &token("new"), "")
        .is_err());
    assert_eq!(
        store
            .oauth_session_for_token_exchange(session.id)
            .unwrap()
            .authorization_code,
        "code"
    );
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        token("first")
    );
}

#[test]
fn oauth_exchange_does_not_overwrite_newer_manual_login() {
    let (_dir, store) = fixture();
    let account = oauth_account(&store);
    let session = session(&store, &account);
    let previous = store.credential_snapshot_optional(&account).unwrap();
    store
        .store_account_secret(&account.email, &token("manual"))
        .unwrap();
    assert!(store
        .store_oauth_exchange_result(&account, &session, previous.as_deref(), &token("late"), "")
        .is_err());
    assert_eq!(
        store.get_account_secret_raw(&account).unwrap(),
        token("manual")
    );
}
