use super::*;

impl MailStore {
    pub fn load_composer_recovery(
        &self,
        account_id: Option<i64>,
        draft_id: Option<i64>,
    ) -> MailResult<serde_json::Value> {
        self.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT revision, snapshot FROM composer_recovery_points
                     WHERE (?1 IS NULL OR account_id = ?1) AND (?2 IS NULL OR draft_id = ?2)
                     ORDER BY (snapshot <> 'null') DESC, revision DESC LIMIT 1",
                    params![account_id, draft_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            match row {
                Some((revision, snapshot)) => {
                    let payload: serde_json::Value = serde_json::from_str(&snapshot)
                        .map_err(|error| MailError::Io(std::io::Error::other(error)))?;
                    Ok(serde_json::json!({ "revision": revision, "payload": payload }))
                }
                None => {
                    // Once the database has a checkpoint or tombstone, a missing scope
                    // must never revive an older unscoped browser cache.
                    let revision: i64 = conn.query_row(
                        "SELECT COALESCE(MAX(revision), 0) FROM composer_recovery_points",
                        [],
                        |row| row.get(0),
                    )?;
                    Ok(serde_json::json!({ "revision": revision, "payload": null }))
                }
            }
        })
    }

    pub fn write_composer_recovery(
        &self,
        account_id: i64,
        draft_id: i64,
        recovery_id: &str,
        revision: i64,
        snapshot: &str,
    ) -> MailResult<bool> {
        if !(1..=9_007_199_254_740_991).contains(&revision)
            || recovery_id.len() > 64
            || snapshot.len() > 32 * 1024 * 1024
        {
            return Err(MailError::Imap(
                "恢复点版本无效或正文超过 32 MiB；编辑内容尚未保存，请手动保存草稿。".into(),
            ));
        }
        self.with_conn(|conn| {
            let changed = conn.execute(
                "INSERT INTO composer_recovery_points(account_id, draft_id, recovery_id, revision, snapshot, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(account_id, draft_id, recovery_id) DO UPDATE SET revision = excluded.revision,
                     snapshot = excluded.snapshot, updated_at = excluded.updated_at
                 WHERE excluded.revision > composer_recovery_points.revision",
                params![account_id, draft_id, recovery_id, revision, snapshot, Utc::now().to_rfc3339()],
            )?;
            Ok(changed == 1)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_survives_reopen_and_rejects_stale_writes_and_resurrection() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("recovery.sqlite3");
        let store = MailStore::open_at_with_seed(path.clone(), false).unwrap();
        let snapshot = r#"{"draft":{"subject":"完整主题","body":"完整正文"}}"#;
        assert!(store
            .write_composer_recovery(1, 0, "", 10, snapshot)
            .unwrap());
        assert!(!store.write_composer_recovery(1, 0, "", 9, "null").unwrap());
        drop(store);
        let store = MailStore::open_at_with_seed(path, false).unwrap();
        assert_eq!(
            store.load_composer_recovery(Some(1), Some(0)).unwrap()["payload"]["draft"]["body"],
            "完整正文"
        );
        assert!(store.write_composer_recovery(1, 0, "", 12, "null").unwrap());
        assert!(!store
            .write_composer_recovery(1, 0, "", 11, snapshot)
            .unwrap());
        assert!(!store
            .write_composer_recovery(1, 0, "", 12, snapshot)
            .unwrap());
        assert!(store.load_composer_recovery(Some(1), Some(0)).unwrap()["payload"].is_null());
        assert!(store
            .write_composer_recovery(1, 0, "", 13, snapshot)
            .unwrap());
    }

    #[test]
    fn migrates_the_legacy_checkpoint_and_keeps_account_and_draft_tombstones_independent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("previous-version.sqlite3");
        let original = r#"{"draft":{"account_id":1,"draft_id":0,"body":"original"}}"#;
        {
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE composer_recovery(id INTEGER PRIMARY KEY CHECK(id = 1),
                 revision INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), updated_at TEXT NOT NULL);",
            ).unwrap();
            old.execute(
                "INSERT INTO composer_recovery VALUES (1, 100, ?1, 'earlier')",
                [original],
            )
            .unwrap();
        }
        let store = MailStore::open_at_with_seed(path.clone(), false).unwrap();
        assert_eq!(
            store.load_composer_recovery(Some(1), Some(0)).unwrap()["payload"]["draft"]["body"],
            "original"
        );
        assert!(store.load_composer_recovery(Some(2), Some(0)).unwrap()["payload"].is_null());
        assert!(store
            .write_composer_recovery(2, 0, "", 101, r#"{"draft":{"body":"second account"}}"#)
            .unwrap());
        assert!(store
            .write_composer_recovery(1, 7, "", 102, r#"{"draft":{"body":"saved draft"}}"#)
            .unwrap());
        assert!(store
            .write_composer_recovery(1, 7, "", 103, "null")
            .unwrap());
        assert!(store
            .write_composer_recovery(2, 0, "", 104, "null")
            .unwrap());
        drop(store);

        let store = MailStore::open_at_with_seed(path, false).unwrap();
        assert_eq!(
            store.load_composer_recovery(None, Some(0)).unwrap()["payload"]["draft"]["body"],
            "original"
        );
        assert_eq!(
            store.load_composer_recovery(Some(1), Some(7)).unwrap()["revision"],
            103
        );
        assert!(!store
            .write_composer_recovery(2, 0, "", 101, original)
            .unwrap());
    }

    #[test]
    fn a_legacy_global_discard_prevents_scoped_reads_from_falling_back_to_stale_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("discarded.sqlite3");
        {
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE composer_recovery(id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, updated_at TEXT NOT NULL);
                 INSERT INTO composer_recovery VALUES(1, 63, 'null', 'earlier');",
            ).unwrap();
        }
        let store = MailStore::open_at_with_seed(path, false).unwrap();
        assert_eq!(
            store.load_composer_recovery(Some(2), Some(0)).unwrap(),
            serde_json::json!({"revision":63, "payload":null})
        );
        assert!(store
            .write_composer_recovery(2, 0, "note", 64, r#"{"draft":{"body":"keep"}}"#)
            .unwrap());
        assert!(store
            .write_composer_recovery(2, 0, "reply", 65, r#"{"draft":{"body":"reply"}}"#)
            .unwrap());
        assert!(store
            .write_composer_recovery(2, 0, "reply", 66, "null")
            .unwrap());
        assert_eq!(
            store.load_composer_recovery(Some(2), Some(0)).unwrap()["payload"]["draft"]["body"],
            "keep"
        );
    }

    #[test]
    fn invalid_recovery_does_not_destroy_the_previous_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(dir.path().join("recovery.sqlite3"), false).unwrap();
        assert!(store
            .write_composer_recovery(1, 0, "", 1, r#"{"body":"previous"}"#)
            .unwrap());
        assert!(store
            .write_composer_recovery(1, 0, "", 2, "invalid JSON")
            .is_err());
        assert!(store.write_composer_recovery(1, 0, "", -1, "null").is_err());
        assert_eq!(
            store.load_composer_recovery(Some(1), Some(0)).unwrap()["payload"]["body"],
            "previous"
        );
    }

    #[test]
    fn recovery_pins_temporary_attachments_until_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(dir.path().join("recovery.sqlite3"), false).unwrap();
        fs::create_dir_all(store.temp_attachment_dir()).unwrap();
        let attachment = store.temp_attachment_dir().join("recovery.txt");
        fs::write(&attachment, "preserve this attachment").unwrap();
        let snapshot =
            serde_json::json!({"draft": {"attachments": [{"local_path": attachment}]}}).to_string();
        store
            .write_composer_recovery(1, 0, "", 1, &snapshot)
            .unwrap();
        assert_eq!(
            store
                .prune_temp_attachments(std::time::Duration::ZERO)
                .unwrap(),
            0
        );
        assert!(attachment.exists());
        store.write_composer_recovery(1, 0, "", 2, "null").unwrap();
        assert_eq!(
            store
                .prune_temp_attachments(std::time::Duration::ZERO)
                .unwrap(),
            1
        );
    }
}
