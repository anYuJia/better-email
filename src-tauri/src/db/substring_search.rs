use super::*;

const SUBSTRING_SEARCH_SCHEMA_VERSION: i64 = 3;

pub(super) fn migrate(conn: &Connection) -> MailResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version >= SUBSTRING_SEARCH_SCHEMA_VERSION {
        return Ok(());
    }
    // External content avoids duplicating complete bodies. The index and
    // triggers become visible together, including messages from older builds.
    let transaction = conn.unchecked_transaction()?;
    transaction.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS message_substring_search USING fts5(
            subject, sender_name, sender_email, recipients, snippet, body,
            content='messages', content_rowid='id', tokenize='trigram'
         );
         CREATE TRIGGER IF NOT EXISTS messages_substring_ai AFTER INSERT ON messages BEGIN
            INSERT INTO message_substring_search(rowid, subject, sender_name, sender_email, recipients, snippet, body)
            VALUES(new.id,new.subject,new.sender_name,new.sender_email,new.recipients,new.snippet,new.body);
         END;
         CREATE TRIGGER IF NOT EXISTS messages_substring_ad AFTER DELETE ON messages BEGIN
            INSERT INTO message_substring_search(message_substring_search,rowid,subject,sender_name,sender_email,recipients,snippet,body)
            VALUES('delete',old.id,old.subject,old.sender_name,old.sender_email,old.recipients,old.snippet,old.body);
         END;
         CREATE TRIGGER IF NOT EXISTS messages_substring_au AFTER UPDATE ON messages
         WHEN old.subject IS NOT new.subject OR old.sender_name IS NOT new.sender_name
           OR old.sender_email IS NOT new.sender_email OR old.recipients IS NOT new.recipients
           OR old.snippet IS NOT new.snippet OR old.body IS NOT new.body
         BEGIN
            INSERT INTO message_substring_search(message_substring_search,rowid,subject,sender_name,sender_email,recipients,snippet,body)
            VALUES('delete',old.id,old.subject,old.sender_name,old.sender_email,old.recipients,old.snippet,old.body);
            INSERT INTO message_substring_search(rowid,subject,sender_name,sender_email,recipients,snippet,body)
            VALUES(new.id,new.subject,new.sender_name,new.sender_email,new.recipients,new.snippet,new.body);
         END;
         INSERT INTO message_substring_search(message_substring_search) VALUES('rebuild');",
    )?;
    transaction.pragma_update(None, "user_version", SUBSTRING_SEARCH_SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::search::{build_message_summary_query, SearchCriteria};
    use super::*;

    fn setup() -> (tempfile::TempDir, MailStore, i64) {
        let directory = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(directory.path().join(DATABASE_FILENAME), true).unwrap();
        let id = store
            .with_conn(|conn| {
                let id: i64 =
                    conn.query_row("SELECT id FROM messages LIMIT 1", [], |row| row.get(0))?;
                conn.execute(
                    "UPDATE messages SET subject='Neutral',snippet='',body=?2 WHERE id=?1",
                    params![
                        id,
                        format!(
                            "{}合同发票合同编号混合ABC项目测试100%_完成",
                            "正文前缀".repeat(1000)
                        )
                    ],
                )?;
                Ok(id)
            })
            .unwrap();
        (directory, store, id)
    }

    fn matches(store: &MailStore, term: &str, id: i64) -> bool {
        let rows = store
            .list_messages_for_scope(None, 0, Some(term.to_string()), None, 200)
            .unwrap();
        assert_eq!(
            rows.len() as i64,
            store
                .count_messages_for_scope(None, 0, Some(term.to_string()), None)
                .unwrap()
        );
        rows.iter().any(|row| row.id == id)
    }

    #[test]
    fn chinese_short_long_and_mixed_queries_search_complete_bodies() {
        let (_directory, store, id) = setup();
        for term in [
            "票",
            "合同",
            "发票",
            "合同编",
            "合同编号",
            "编号混合ABC",
            "项目测试",
            "测试100%_",
            "ABC项目",
        ] {
            assert!(matches(&store, term, id), "missing body substring {term}");
        }
        for term in ["不存在", "合同其他", "测试100X_"] {
            assert!(!matches(&store, term, id), "false positive for {term}");
        }
    }

    #[test]
    fn trigram_index_tracks_body_updates_deletes_and_ignores_metadata() {
        let (_directory, store, id) = setup();
        store
            .with_conn(|conn| {
                conn.execute("UPDATE messages SET is_read=1 WHERE id=?1", [id])?;
                Ok(())
            })
            .unwrap();
        assert!(matches(&store, "合同编号", id));
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET body='替换后的新正文' WHERE id=?1",
                    [id],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(!matches(&store, "合同编号", id));
        assert!(matches(&store, "新正文", id));
        store
            .with_conn(|conn| {
                conn.execute("DELETE FROM messages WHERE id=?1", [id])?;
                Ok(())
            })
            .unwrap();
        assert!(!matches(&store, "新正文", id));
    }

    #[test]
    fn upgrading_an_existing_database_backfills_index_once() {
        let (_directory, store, id) = setup();
        store.with_conn(|conn| {
            conn.execute_batch("DROP TRIGGER messages_substring_ai; DROP TRIGGER messages_substring_ad;
                DROP TRIGGER messages_substring_au; DROP TABLE message_substring_search; PRAGMA user_version=2;")?;
            migrate(conn)?;
            let changes = conn.total_changes();
            migrate(conn)?;
            assert_eq!(changes, conn.total_changes(), "reopening must not rebuild the index");
            Ok(())
        }).unwrap();
        assert!(matches(&store, "合同编号", id));
    }

    #[test]
    fn chinese_query_uses_the_trigram_virtual_index() {
        let (_directory, store, _) = setup();
        store
            .with_conn(|conn| {
                let criteria = SearchCriteria::parse(Some("合同编号"));
                let sql = build_message_summary_query(&criteria, "all", "", None);
                let mut values: Vec<Value> =
                    criteria.params().into_iter().map(Value::Text).collect();
                values.extend([Value::Integer(40), Value::Integer(0)]);
                let plan = conn
                    .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))?
                    .query_map(params_from_iter(values), |row| row.get::<_, String>(3))?
                    .collect::<Result<Vec<_>, _>>()?;
                assert!(
                    plan.iter()
                        .any(|line| line.contains("message_substring_search VIRTUAL TABLE INDEX")),
                    "{plan:?}"
                );
                assert!(
                    plan.iter()
                        .any(|line| line.contains("SEARCH m USING INTEGER PRIMARY KEY")),
                    "{plan:?}"
                );
                Ok(())
            })
            .unwrap();
    }

    /// Reproducible, synthetic-only benchmark. The baseline searches the same
    /// six fields (including complete bodies), with identical order/hydration,
    /// rather than comparing the old incomplete five-field search to new hits.
    #[test]
    #[ignore = "50k synthetic rows; run explicitly with --ignored --nocapture"]
    fn substring_search_benchmark_50k() {
        use super::super::messages::{
            hydrate_message_summary_list_metadata, map_message_summary_row_base,
        };
        use std::time::Instant;
        let directory = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(directory.path().join(DATABASE_FILENAME), true).unwrap();
        let fixture_started = Instant::now();
        store.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            transaction.execute("DELETE FROM messages", [])?;
            let (account, folder): (i64, i64) = transaction.query_row("SELECT account_id,id FROM folders WHERE role='inbox' LIMIT 1", [], |row| Ok((row.get(0)?,row.get(1)?)))?;
            {
                let mut insert = transaction.prepare("INSERT INTO messages(account_id,folder_id,sender_name,sender_email,recipients,subject,snippet,body,received_at,sanitizer_version) VALUES (?1,?2,'Synthetic','synthetic@example.invalid','local@example.invalid',?3,'Synthetic preview',?4,'2026-10-29T08:00:00Z',1)")?;
                for id in 0..50_000 {
                    let suffix = if id % 997 == 0 { "项目合同编号ABC" } else { "普通消息内容" };
                    let body = format!("{} {id} {suffix}", "本地合成正文，仅供测量。".repeat(32));
                    insert.execute(params![account,folder,format!("Message {id}"),body])?;
                }
            }
            transaction.commit()?;
            Ok(())
        }).unwrap();
        println!(
            "fixture rows=50000 build_ms={:.3} sqlite={} mode=debug bundled_sqlite synthetic_only",
            fixture_started.elapsed().as_secs_f64() * 1000.0,
            rusqlite::version()
        );
        let baseline = |term: &str| -> MailResult<Vec<MessageSummary>> {
            store.with_read_conn(|conn| {
                let sql = build_message_summary_query(&SearchCriteria::default(), "all", "(m.subject LIKE ? OR m.sender_name LIKE ? OR m.sender_email LIKE ? OR m.recipients LIKE ? OR m.snippet LIKE ? OR m.body LIKE ?)", None);
                let mut values = vec![Value::Text(format!("%{term}%"));6];
                values.extend([Value::Integer(40),Value::Integer(0)]);
                let rows = conn.prepare(&sql)?.query_map(params_from_iter(values),map_message_summary_row_base)?.collect::<Result<Vec<_>,_>>()?;
                hydrate_message_summary_list_metadata(conn,rows)
            })
        };
        let indexed =
            |term: &str| store.list_messages_for_scope(None, 0, Some(term.into()), None, 40);
        let sample = |operation: &dyn Fn() -> MailResult<Vec<MessageSummary>>| -> (Vec<i64>, f64) {
            let start = Instant::now();
            let ids = operation().unwrap().into_iter().map(|row| row.id).collect();
            (ids, start.elapsed().as_secs_f64() * 1000.0)
        };
        for term in ["项目合同", "不存在关键词", "合同"] {
            let (before_ids, first_before) = sample(&|| baseline(term));
            let (after_ids, first_after) = sample(&|| indexed(term));
            assert_eq!(before_ids, after_ids, "same substring semantics for {term}");
            for _ in 0..5 {
                baseline(term).unwrap();
                indexed(term).unwrap();
            }
            let mut before = Vec::new();
            let mut after = Vec::new();
            for _ in 0..20 {
                // Alternate order to reduce an order-specific warm-cache bias.
                let (_, a) = sample(&|| baseline(term));
                let (_, b) = sample(&|| indexed(term));
                before.push(a);
                after.push(b);
                let (_, b) = sample(&|| indexed(term));
                let (_, a) = sample(&|| baseline(term));
                before.push(a);
                after.push(b);
            }
            before.sort_by(f64::total_cmp);
            after.sort_by(f64::total_cmp);
            let count = store
                .count_messages_for_scope(None, 0, Some(term.into()), None)
                .unwrap();
            println!("term={term} matching={count} page_rows={} first_after_fixture_ms=({first_before:.3},{first_after:.3}) warm_samples=40 before_like_p50_ms={:.3} before_like_p95_ms={:.3} after_p50_ms={:.3} after_p95_ms={:.3}",before_ids.len(),before[20],before[37],after[20],after[37]);
        }
    }
}
