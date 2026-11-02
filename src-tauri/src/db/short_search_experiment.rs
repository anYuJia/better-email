//! Rejected short-substring candidate index, compiled only by `cfg(test)`.
//!
//! This module is deliberately absent from the product migration/search path:
//! measured write amplification and common-character regressions outweighed the
//! rare-term speedup. Its v4 schema exists only in disposable test databases.
//! Encoded Unicode scalar n-grams avoid tokenizer boundaries; the original
//! six-field LIKE predicate remains the final semantic check. See the explicit
//! ignored 50k benchmark and docs/quality/round2-2026-10-29/SEARCH_EXPERIMENT.md.
use super::*;
use rusqlite::functions::FunctionFlags;
use std::fmt::Write;

const SCHEMA_VERSION: i64 = 4;
const PAIR_MARKER: u64 = 1 << 42;

fn gram(first: char, second: Option<char>) -> u64 {
    let first = u64::from(first.to_ascii_lowercase() as u32);
    match second {
        Some(second) => PAIR_MARKER | (first << 21) | u64::from(second.to_ascii_lowercase() as u32),
        None => first,
    }
}

fn query_token(term: &str) -> Option<String> {
    if term.is_ascii() || term.contains('\0') {
        return None;
    }
    let mut chars = term.chars();
    let first = chars.next()?;
    let second = chars.next();
    if chars.next().is_some() {
        return None;
    }
    Some(format!("n{:x}", gram(first, second)))
}

fn document_tokens<'a>(fields: impl IntoIterator<Item = &'a str>) -> String {
    let mut grams = BTreeSet::new();
    for text in fields {
        if text.is_ascii() {
            continue;
        }
        let mut previous = None;
        for ch in text.chars() {
            if !ch.is_ascii() {
                grams.insert(gram(ch, None));
            }
            if let Some(left) = previous {
                if !ch.is_ascii() || !char::is_ascii(&left) {
                    grams.insert(gram(left, Some(ch)));
                }
            }
            previous = Some(ch);
        }
    }
    let mut output = String::new();
    for value in grams {
        write!(&mut output, "n{value:x} ").expect("writing to String cannot fail");
    }
    output
}

fn register(conn: &Connection) -> MailResult<()> {
    conn.create_scalar_function(
        "better_email_short_tokens",
        6,
        FunctionFlags::SQLITE_UTF8
            | FunctionFlags::SQLITE_DETERMINISTIC
            | FunctionFlags::SQLITE_INNOCUOUS,
        |context| {
            let mut fields = Vec::with_capacity(6);
            for index in 0..6 {
                fields.push(
                    context
                        .get_raw(index)
                        .as_str()
                        .map_err(|error| rusqlite::Error::UserFunctionError(Box::new(error)))?,
                );
            }
            Ok(document_tokens(fields))
        },
    )?;
    Ok(())
}

fn migrate(conn: &Connection) -> MailResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }
    let transaction = conn.unchecked_transaction()?;
    transaction.execute_batch("CREATE VIRTUAL TABLE IF NOT EXISTS message_short_search USING fts5(tokens,content='',contentless_delete=1,detail=none,tokenize='ascii');
    CREATE TRIGGER IF NOT EXISTS messages_short_ai AFTER INSERT ON messages BEGIN
      INSERT INTO message_short_search(rowid,tokens) VALUES(new.id,better_email_short_tokens(new.subject,new.sender_name,new.sender_email,new.recipients,new.snippet,new.body));
    END;
    CREATE TRIGGER IF NOT EXISTS messages_short_ad AFTER DELETE ON messages BEGIN
      DELETE FROM message_short_search WHERE rowid=old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS messages_short_au AFTER UPDATE ON messages
      WHEN old.subject IS NOT new.subject OR old.sender_name IS NOT new.sender_name
        OR old.sender_email IS NOT new.sender_email OR old.recipients IS NOT new.recipients
        OR old.snippet IS NOT new.snippet OR old.body IS NOT new.body
    BEGIN
      INSERT OR REPLACE INTO message_short_search(rowid,tokens) VALUES(new.id,better_email_short_tokens(new.subject,new.sender_name,new.sender_email,new.recipients,new.snippet,new.body));
    END;
    INSERT OR REPLACE INTO message_short_search(rowid,tokens)
      SELECT id,better_email_short_tokens(subject,sender_name,sender_email,recipients,snippet,body) FROM messages;")?;
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::messages::{
        hydrate_message_summary_list_metadata, map_message_summary_row_base,
    };
    use super::super::search::{build_like_query, build_message_summary_query, SearchCriteria};
    use super::*;
    use std::time::Instant;

    fn body(id: i64, diverse: bool) -> String {
        let mut content = if diverse {
            let mut seed = id as u64 + 1;
            (0..384)
                .map(|_| {
                    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                    char::from_u32(0x4e00 + ((seed >> 32) % 256) as u32).unwrap()
                })
                .collect()
        } else {
            "本地合成正文，仅供测量。".repeat(32)
        };
        if id % 997 == 0 {
            content.push_str("项目合同发票合A");
        }
        content
    }

    fn write_batch(conn: &Connection, first: i64, count: i64, diverse: bool) -> MailResult<f64> {
        let started = Instant::now();
        let transaction = conn.unchecked_transaction()?;
        let (account, folder): (i64, i64) = transaction.query_row(
            "SELECT account_id,id FROM folders WHERE role='inbox' LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        {
            let mut stmt=transaction.prepare("INSERT INTO messages(id,account_id,folder_id,sender_name,sender_email,recipients,subject,snippet,body,received_at,sanitizer_version) VALUES(?1,?2,?3,'Synthetic','sender@example.invalid','local@example.invalid','Subject','Preview',?4,'2026-10-29T08:00:00Z',1)")?;
            for id in first..first + count {
                stmt.execute(params![id, account, folder, body(id, diverse)])?;
            }
        }
        transaction.commit()?;
        Ok(started.elapsed().as_secs_f64() * 1000.0)
    }

    fn maintenance(conn: &Connection, diverse: bool) -> MailResult<(f64, f64, f64)> {
        let insert = write_batch(conn, 50_001, 1000, diverse)?;
        let start = Instant::now();
        conn.execute("DELETE FROM messages WHERE id>50000", [])?;
        let delete = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        conn.execute("UPDATE messages SET body=body||' x' WHERE id<=1000", [])?;
        Ok((insert, delete, start.elapsed().as_secs_f64() * 1000.0))
    }

    fn query(store: &MailStore, term: &str, indexed: bool) -> MailResult<Vec<MessageSummary>> {
        store.with_read_conn(|conn| {
            let residual="(m.subject LIKE ? ESCAPE '\\' OR m.sender_name LIKE ? ESCAPE '\\' OR m.sender_email LIKE ? ESCAPE '\\' OR m.recipients LIKE ? ESCAPE '\\' OR m.snippet LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\')";
            let scope=if indexed {format!("m.id IN (SELECT rowid FROM message_short_search WHERE message_short_search MATCH ?) AND {residual}")} else {residual.into()};
            let sql=build_message_summary_query(&SearchCriteria::default(),"all",&scope,None);
            let mut values=Vec::new();
            if indexed { values.push(Value::Text(query_token(term).unwrap())); }
            values.extend(vec![Value::Text(build_like_query(term));6]);
            values.extend([Value::Integer(40),Value::Integer(0)]);
            let rows=conn.prepare(&sql)?.query_map(params_from_iter(values),map_message_summary_row_base)?.collect::<Result<Vec<_>,_>>()?;
            hydrate_message_summary_list_metadata(conn,rows)
        })
    }

    fn setup() -> (tempfile::TempDir, MailStore, i64) {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join(DATABASE_FILENAME), true).unwrap();
        let id = store
            .with_conn(|conn| {
                conn.execute("DELETE FROM messages", [])?;
                write_batch(conn, 1, 1, false)?;
                register(conn)?;
                migrate(conn)?;
                Ok(1)
            })
            .unwrap();
        (dir, store, id)
    }

    fn same_hits(store: &MailStore, term: &str) -> Vec<i64> {
        let baseline: Vec<_> = query(store, term, false)
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        let indexed: Vec<_> = query(store, term, true)
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        assert_eq!(
            baseline, indexed,
            "LIKE truth must be unchanged for {term:?}"
        );
        indexed
    }

    #[test]
    fn complete_body_short_queries_keep_literal_like_semantics() {
        let (_dir, store, id) = setup();
        let text = format!(
            "{}合同发票合A A中 中% 中_ 中\\ É中 😀中",
            "完整正文前缀".repeat(2000)
        );
        store
            .with_conn(|conn| {
                conn.execute("UPDATE messages SET body=?2 WHERE id=?1", params![id, text])?;
                Ok(())
            })
            .unwrap();
        for term in [
            "合", "票", "合同", "发票", "合a", "a中", "中%", "中_", "中\\", "É中", "😀中",
        ] {
            assert_eq!(same_hits(&store, term), [id]);
        }
        for term in ["缺", "不存在", "中X", "é中", "同合"] {
            if query_token(term).is_some() {
                assert!(same_hits(&store, term).is_empty());
            }
        }
        assert!(query_token("中\0").is_none());
        assert!(query_token("abc").is_none());
        assert!(query_token("合同号").is_none());
    }

    #[test]
    fn every_search_field_is_indexed_without_cross_field_pairs() {
        let (_dir, store, id) = setup();
        for field in [
            "subject",
            "sender_name",
            "sender_email",
            "recipients",
            "snippet",
            "body",
        ] {
            store.with_conn(|conn| {
                conn.execute("UPDATE messages SET subject='',sender_name='',sender_email='',recipients='',snippet='',body='' WHERE id=?1", [id])?;
                conn.execute(&format!("UPDATE messages SET {field}='合同' WHERE id=?1"), [id])?;
                Ok(())
            }).unwrap();
            assert_eq!(same_hits(&store, "合同"), [id], "field={field}");
        }
        store
            .with_conn(|conn| {
                conn.execute(
                    "UPDATE messages SET subject='合',body='同' WHERE id=?1",
                    [id],
                )?;
                Ok(())
            })
            .unwrap();
        assert!(same_hits(&store, "合同").is_empty());
    }

    #[test]
    fn body_updates_deletes_and_rollback_keep_short_index_consistent() {
        let (_dir, store, id) = setup();
        store
            .with_conn(|conn| {
                conn.execute("UPDATE messages SET body='合同发票' WHERE id=?1", [id])?;
                let changes = conn.total_changes();
                conn.execute("UPDATE messages SET is_read=1 WHERE id=?1", [id])?;
                assert_eq!(
                    conn.total_changes() - changes,
                    1,
                    "metadata must not rewrite either text index"
                );
                Ok(())
            })
            .unwrap();
        assert_eq!(same_hits(&store, "合同"), [id]);
        store
            .with_conn(|conn| {
                let transaction = conn.unchecked_transaction()?;
                transaction.execute("UPDATE messages SET body='替换' WHERE id=?1", [id])?;
                transaction.rollback()?;
                Ok(())
            })
            .unwrap();
        assert_eq!(same_hits(&store, "合同"), [id]);
        assert!(same_hits(&store, "替换").is_empty());
        store
            .with_conn(|conn| {
                conn.execute("UPDATE messages SET body='替换' WHERE id=?1", [id])?;
                Ok(())
            })
            .unwrap();
        assert!(same_hits(&store, "合同").is_empty());
        assert_eq!(same_hits(&store, "替换"), [id]);
        store.with_conn(|conn| {
            conn.execute("DELETE FROM messages WHERE id=?1", [id])?;
            conn.execute("INSERT INTO message_short_search(message_short_search) VALUES('integrity-check')", [])?;
            Ok(())
        }).unwrap();
        assert!(same_hits(&store, "替换").is_empty());
    }

    #[test]
    fn migration_backfills_once_without_rebuilding_the_trigram_index() {
        let dir = tempfile::tempdir().unwrap();
        let store = MailStore::open_at_with_seed(dir.path().join(DATABASE_FILENAME), true).unwrap();
        store
            .with_conn(|conn| {
                let snapshot = |conn: &Connection| -> MailResult<Vec<(i64, Vec<u8>)>> {
                    Ok(conn
                        .prepare("SELECT id,block FROM message_substring_search_data ORDER BY id")?
                        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                        .collect::<Result<Vec<_>, _>>()?)
                };
                let before = snapshot(conn)?;
                register(conn)?;
                migrate(conn)?;
                assert_eq!(
                    before,
                    snapshot(conn)?,
                    "v4 must not rebuild the existing trigram index"
                );
                let changes = conn.total_changes();
                migrate(conn)?;
                assert_eq!(changes, conn.total_changes());
                assert_eq!(
                    conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))?,
                    4
                );
                Ok(())
            })
            .unwrap();
        same_hits(&store, "安全");
    }

    #[test]
    #[ignore = "explicit 50k short-substring storage/write/read benchmark"]
    fn short_search_index_benchmark_50k() {
        for diverse in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let store =
                MailStore::open_at_with_seed(dir.path().join(DATABASE_FILENAME), true).unwrap();
            store.with_conn(|conn| {
                conn.execute("DELETE FROM messages",[])?;
                let fixture=write_batch(conn,1,50_000,diverse)?;
                let before_write=maintenance(conn,diverse)?;
                let bytes_before:i64=conn.query_row("SELECT SUM(pgsize) FROM dbstat",[],|row|row.get(0))?;
                register(conn)?;
                let started=Instant::now();migrate(conn)?;
                let migration_ms=started.elapsed().as_secs_f64()*1000.0;
                let index_bytes:i64=conn.query_row("SELECT SUM(pgsize) FROM dbstat WHERE name LIKE 'message_short_search%'",[],|row|row.get(0))?;
                let after_write=maintenance(conn,diverse)?;
                println!("short_fixture diverse={diverse} rows=50000 fixture_ms={fixture:.3} db_before_bytes={bytes_before} index_bytes={index_bytes} migration_ms={migration_ms:.3} write1000_before_insert_delete_update_ms={before_write:?} write1000_after_insert_delete_update_ms={after_write:?} sqlite={} debug={}",rusqlite::version(),cfg!(debug_assertions));
                Ok(())
            }).unwrap();
            for term in ["合同", "票", "缺", "一", "合A"] {
                let before = query(&store, term, false).unwrap();
                let after = query(&store, term, true).unwrap();
                assert_eq!(
                    before.iter().map(|row| row.id).collect::<Vec<_>>(),
                    after.iter().map(|row| row.id).collect::<Vec<_>>()
                );
                let mut samples = [Vec::new(), Vec::new()];
                for iteration in 0..23 {
                    for indexed in if iteration % 2 == 0 {
                        [false, true]
                    } else {
                        [true, false]
                    } {
                        let started = Instant::now();
                        query(&store, term, indexed).unwrap();
                        if iteration >= 3 {
                            samples[indexed as usize]
                                .push(started.elapsed().as_secs_f64() * 1000.0);
                        }
                    }
                }
                for sample in &mut samples {
                    sample.sort_by(f64::total_cmp);
                }
                println!("short_query diverse={diverse} term={term} page_rows={} warm_samples=20 before_p50_ms={:.3} before_p95_ms={:.3} indexed_p50_ms={:.3} indexed_p95_ms={:.3}",before.len(),samples[0][10],samples[0][18],samples[1][10],samples[1][18]);
            }
        }
    }
}
