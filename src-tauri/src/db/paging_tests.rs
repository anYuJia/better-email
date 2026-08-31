use super::messages::build_thread_summary_query;
use super::search::thread_order_clause;
use super::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

static PAGING_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[test]
fn message_pages_sort_mixed_timezones_before_pagination() {
    let data_dir = tempfile::tempdir().expect("temporary database directory");
    let store = MailStore::open_at_with_seed(data_dir.path().join(DATABASE_FILENAME), false)
        .expect("empty store opens");
    // Lexical sorting interleaves local calendar days when providers use
    // different offsets. Include equal instants and fractional seconds too.
    let timestamps = [
        "2026-08-30T01:00:00+08:00",
        "2026-08-29T23:00:00+08:00",
        "2026-08-29T18:00:00+00:00",
        "2026-08-29T16:00:00Z",
        "2026-08-24T23:00:00+08:00",
        "2026-08-24T18:00:00+00:00",
        "2026-08-29T10:00:00-07:00",
        "2026-08-30T01:00:00.500+08:00",
    ];
    store
        .with_conn(|conn| {
            for account_id in [9101, 9102] {
                conn.execute(
                    "INSERT INTO accounts(id, email, display_name, provider, created_at)
                     VALUES (?1, ?2, 'Timezone test', 'custom', '2026-08-31T00:00:00Z')",
                    params![account_id, format!("timezone-{account_id}@example.com")],
                )?;
                conn.execute(
                    "INSERT INTO folders(id, account_id, name, role)
                     VALUES (?1, ?1, 'Inbox', 'inbox')",
                    [account_id],
                )?;
            }
            for (index, timestamp) in timestamps.iter().enumerate() {
                conn.execute(
                    "INSERT INTO messages(
                        id, account_id, folder_id, sender_name, sender_email,
                        recipients, subject, snippet, body, received_at
                     ) VALUES (?1, ?2, ?2, 'Sender', 'sender@example.com',
                               'recipient@example.com', 'Subject', '', '', ?3)",
                    params![index as i64 + 1, 9101 + index as i64 % 2, timestamp],
                )?;
            }
            Ok(())
        })
        .expect("mixed timezone messages inserted");

    let newest_ids = vec![3, 8, 7, 1, 4, 2, 6, 5];
    for (account_id, folder_id) in [(None, -1), (None, 0), (Some(9101), 0), (Some(9102), 9102)] {
        for sort in ["newest", "oldest", "sender", "subject", "unknown"] {
            let mut expected = newest_ids.clone();
            expected.retain(|id| account_id.is_none_or(|account| 9101 + (id - 1) % 2 == account));
            if sort == "oldest" {
                expected.reverse();
            }
            let actual = (0..=expected.len())
                .step_by(2)
                .flat_map(|offset| {
                    store
                        .list_messages_for_scope_sorted_page(
                            account_id,
                            folder_id,
                            None,
                            None,
                            Some(sort.to_string()),
                            offset as i64,
                            2,
                        )
                        .expect("timezone message page loads")
                })
                .map(|message| message.id)
                .collect::<Vec<_>>();
            assert_eq!(
                actual, expected,
                "scope={account_id:?}/{folder_id}, sort={sort}"
            );
        }
    }
}

#[test]
fn chronological_message_pages_use_time_indexes() {
    let data_dir = tempfile::tempdir().expect("temporary database directory");
    let store = MailStore::open_at_with_seed(data_dir.path().join(DATABASE_FILENAME), false)
        .expect("empty store opens");
    // Exercise the real query, including joins and pagination, in the global,
    // single-account and single-folder scopes. Both directions use the index.
    store
        .with_conn(|conn| {
            for scope in [
                "",
                "m.account_id = 9101",
                "m.folder_id = 9101",
                "f.role = 'inbox'",
            ] {
                for sort in ["newest", "oldest"] {
                    let query = super::search::build_message_summary_query(
                        &super::search::SearchCriteria::parse(None),
                        "all",
                        scope,
                        Some(sort),
                    );
                    let mut statement = conn.prepare(&format!("EXPLAIN QUERY PLAN {query}"))?;
                    let details = statement
                        .query_map(params![40, 0], |row| row.get::<_, String>(3))?
                        .collect::<Result<Vec<_>, _>>()?;
                    assert!(
                        details
                            .iter()
                            .all(|detail| !detail.contains("TEMP B-TREE FOR ORDER BY")),
                        "chronological paging must not sort the entire scope: {details:?}"
                    );
                }
            }
            Ok(())
        })
        .expect("chronological query plans inspected");
}

#[test]
fn message_scope_pages_cover_500_rows_without_duplicates() {
    let unique = PAGING_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    let data_dir = std::env::temp_dir().join(format!(
        "better-email-paging-{}-{}",
        std::process::id(),
        unique
    ));
    fs::create_dir_all(&data_dir).expect("paging test directory created");
    let database_path = data_dir.join(DATABASE_FILENAME);
    let store = MailStore::open_at_with_seed(database_path, true).expect("seeded store opens");
    let account = store.get_account().expect("seeded account loads");
    let inbox = store
        .list_folders_for_account(Some(account.id))
        .expect("folders load")
        .into_iter()
        .find(|folder| folder.role == "inbox")
        .expect("inbox folder exists");

    store
        .with_conn(|conn| {
            for index in 0..497 {
                conn.execute(
                    "INSERT INTO messages(
                        account_id, folder_id, sender_name, sender_email, recipients,
                        subject, snippet, body, received_at, is_read, is_starred,
                        has_attachments, thread_key
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0, 0, ?10)",
                    params![
                        account.id,
                        inbox.id,
                        format!("Paging Sender {index}"),
                        format!("paging-{index}@example.com"),
                        account.email,
                        format!("Paging message {index}"),
                        "paging",
                        "",
                        "2027-01-01T00:00:00Z",
                        format!("paging-thread-{index}"),
                    ],
                )?;
            }
            Ok(())
        })
        .expect("500 messages inserted");

    let page = |offset| {
        store
            .list_messages_for_scope_sorted_page(
                Some(account.id),
                inbox.id,
                None,
                None,
                None,
                offset,
                200,
            )
            .expect("message page loads")
    };
    let first = page(0);
    let second = page(200);
    let third = page(400);
    let empty = page(500);
    assert_eq!(
        store
            .count_messages_for_scope(Some(account.id), inbox.id, None, None)
            .expect("exact inbox count loads"),
        500
    );
    assert_eq!(
        store
            .count_messages_for_scope(
                Some(account.id),
                inbox.id,
                Some("Paging".to_string()),
                Some("unread".to_string()),
            )
            .expect("exact filtered inbox count loads"),
        497
    );
    assert_eq!(first.len(), 200);
    assert_eq!(second.len(), 200);
    assert_eq!(third.len(), 100);
    assert!(empty.is_empty());

    let all = first
        .iter()
        .chain(&second)
        .chain(&third)
        .collect::<Vec<_>>();
    let ids = all.iter().map(|message| message.id).collect::<HashSet<_>>();
    assert_eq!(all.len(), 500);
    assert_eq!(ids.len(), 500, "offset pages must not repeat rows");
    assert!(all.windows(2).all(|pair| {
        pair[0].received_at > pair[1].received_at
            || (pair[0].received_at == pair[1].received_at && pair[0].id > pair[1].id)
    }));

    drop(store);
    fs::remove_dir_all(data_dir).expect("paging test directory removed");
}

#[test]
fn thread_summary_aggregates_thousands_of_messages_without_correlated_scans() {
    let unique = PAGING_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    let data_dir = std::env::temp_dir().join(format!(
        "better-email-thread-summary-{}-{}",
        std::process::id(),
        unique
    ));
    fs::create_dir_all(&data_dir).expect("thread test directory created");
    let database_path = data_dir.join(DATABASE_FILENAME);
    let store = MailStore::open_at_with_seed(database_path, true).expect("seeded store opens");
    let account = store.get_account().expect("seeded account loads");
    let inbox = store
        .list_folders_for_account(Some(account.id))
        .expect("folders load")
        .into_iter()
        .find(|folder| folder.role == "inbox")
        .expect("inbox folder exists");

    store
        .with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            for thread_index in 0..1000 {
                for message_index in 0..4 {
                    transaction.execute(
                        "INSERT INTO messages(
                            account_id, folder_id, sender_name, sender_email, recipients,
                            subject, snippet, body, received_at, is_read, is_starred,
                            has_attachments, thread_key
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '', ?8, ?9, 0, 0, ?10)",
                        params![
                            account.id,
                            inbox.id,
                            format!("Sender {}", message_index % 2),
                            format!("sender{}@example.com", message_index % 2),
                            &account.email,
                            if message_index == 3 {
                                format!("Thread {thread_index} latest")
                            } else {
                                format!("Thread {thread_index} older")
                            },
                            if message_index == 3 {
                                format!("Thread {thread_index} latest preview")
                            } else {
                                "older preview".to_string()
                            },
                            "2027-01-01T00:00:00Z",
                            if message_index == 0 { 0 } else { 1 },
                            format!("thread-{thread_index}"),
                        ],
                    )?;
                }
            }
            transaction.execute(
                "INSERT INTO muted_threads(account_id, thread_key, created_at)
                 VALUES (?1, 'thread-1', '2027-01-01T00:00:00Z')",
                params![account.id],
            )?;
            transaction.commit()?;
            Ok(())
        })
        .expect("thousands of thread messages inserted");

    let threads = store
        .list_threads_for_scope_sorted(Some(account.id), Some(inbox.id), None, None, None, 200)
        .expect("thread summary loads");
    assert_eq!(
        threads.len(),
        200,
        "thread result remains capped per request"
    );
    let target = threads
        .iter()
        .find(|thread| thread.thread_key == "thread-1")
        .expect("target thread exists");
    assert_eq!(target.message_count, 4);
    assert_eq!(target.unread_count, 1);
    assert_eq!(target.subject, "Thread 1 latest");
    assert_eq!(target.latest_preview, "Thread 1 latest preview");
    assert!(target.participants.contains("Sender 0"));
    assert!(target.participants.contains("Sender 1"));
    assert!(target.is_muted);

    store
        .with_conn(|conn| {
            let query =
                build_thread_summary_query("m.folder_id = ?", "", thread_order_clause(None));
            assert!(query.contains("ROW_NUMBER() OVER"));
            assert!(!query.contains("SELECT latest.subject"));
            let explain = format!("EXPLAIN QUERY PLAN {query}");
            let mut statement = conn.prepare(&explain)?;
            let details = statement
                .query_map(params![inbox.id, 80], |row| row.get::<_, String>(3))?
                .collect::<Result<Vec<_>, _>>()?;
            assert!(details
                .iter()
                .all(|detail| !detail.contains("CORRELATED SCALAR SUBQUERY")));
            Ok(())
        })
        .expect("thread query plan inspected");

    drop(store);
    fs::remove_dir_all(data_dir).expect("thread test directory removed");
}
