use super::*;

impl MailStore {
    /// Read-heavy mailbox queries must not hold the writer mutex. A WAL read
    /// transaction also keeps rows and their label/attachment hydration in the
    /// same snapshot. Connections are scoped to bounded database jobs; writers
    /// and lazy migrations continue using the existing serialized connection.
    pub(super) fn with_read_conn<T>(
        &self,
        operation: impl FnOnce(&Connection) -> MailResult<T>,
    ) -> MailResult<T> {
        // A private in-memory database cannot be reopened by path. Keep test
        // and embedded callers on their original connection in that case.
        if self.database_path == Path::new(":memory:") {
            return self.with_conn(operation);
        }
        let conn = Connection::open_with_flags(
            &self.database_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(std::time::Duration::from_secs(2))?;
        conn.pragma_update(None, "query_only", true)?;
        conn.pragma_update(None, "foreign_keys", true)?;
        let snapshot = conn.unchecked_transaction()?;
        let result = operation(&snapshot)?;
        snapshot.commit()?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn mailbox_reads_do_not_wait_for_the_writer_mutex() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(directory.path().join(DATABASE_FILENAME), true).unwrap();
        let writer = store.conn.lock().unwrap();
        let reader = store.clone();
        let (send, receive) = mpsc::channel();
        let task = std::thread::spawn(move || {
            let result = reader.list_messages_for_scope(None, 0, None, None, 40);
            send.send(result.map(|rows| rows.len())).unwrap();
        });
        let result = receive.recv_timeout(std::time::Duration::from_secs(2));
        drop(writer);
        task.join().unwrap();
        assert!(result.unwrap().unwrap() > 0);
    }

    #[test]
    fn a_slow_read_snapshot_does_not_block_message_detail_or_writes() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(directory.path().join(DATABASE_FILENAME), true).unwrap();
        let id = store
            .list_messages_for_scope(None, 0, None, None, 1)
            .unwrap()[0]
            .id;
        let reader = store.clone();
        let (ready_send, ready_receive) = mpsc::channel();
        let (release_send, release_receive) = mpsc::channel();
        let count = std::thread::spawn(move || {
            reader.with_read_conn(|conn| {
                let count: i64 =
                    conn.query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))?;
                ready_send.send(()).unwrap();
                // Deliberately retain the same snapshot as a slow COUNT query.
                release_receive
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .unwrap();
                Ok(count)
            })
        });
        ready_receive
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        let writer = store.clone();
        let (result_send, result_receive) = mpsc::channel();
        let detail = std::thread::spawn(move || {
            let result = writer.with_conn(|conn| {
                conn.execute("UPDATE messages SET is_read=1 WHERE id=?1", [id])?;
                super::super::messages::message_for_conn(conn, id)
            });
            result_send.send(result).unwrap();
        });
        let result = result_receive.recv_timeout(std::time::Duration::from_secs(2));
        release_send.send(()).unwrap();
        count.join().unwrap().unwrap();
        detail.join().unwrap();
        assert_eq!(result.unwrap().unwrap().id, id);
    }

    #[test]
    fn memory_databases_keep_their_existing_connection() {
        let directory = tempfile::tempdir().unwrap();
        let store = MailStore {
            conn: Arc::new(Mutex::new(Connection::open_in_memory().unwrap())),
            trusted_html: Arc::new(Mutex::new(
                super::super::trusted_html_cache::TrustedHtmlCache::default(),
            )),
            data_dir: directory.path().to_owned(),
            database_path: PathBuf::from(":memory:"),
        };
        store
            .with_conn(|conn| {
                conn.execute_batch(
                    "CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES (42);",
                )?;
                Ok(())
            })
            .unwrap();
        let value = store
            .with_read_conn(|conn| {
                Ok(conn.query_row("SELECT value FROM sample", [], |row| row.get::<_, i64>(0))?)
            })
            .unwrap();
        assert_eq!(value, 42);
    }

    #[test]
    fn file_read_connections_are_read_only_and_have_a_busy_timeout() {
        let directory = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(directory.path().join(DATABASE_FILENAME), false).unwrap();
        store
            .with_read_conn(|conn| {
                assert!(conn.execute("DELETE FROM messages", []).is_err());
                assert_eq!(
                    conn.query_row("PRAGMA busy_timeout", [], |row| row.get::<_, i64>(0))?,
                    2000
                );
                assert_eq!(
                    conn.query_row("PRAGMA query_only", [], |row| row.get::<_, i64>(0))?,
                    1
                );
                Ok(())
            })
            .unwrap();
    }
}
