use super::*;
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

static PAGING_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

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
