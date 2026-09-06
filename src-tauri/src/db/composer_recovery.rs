use super::*;

impl MailStore {
    pub fn load_composer_recovery(&self) -> MailResult<serde_json::Value> {
        self.with_conn(|conn| {
            let row = conn
                .query_row(
                    "SELECT revision, snapshot FROM composer_recovery WHERE id = 1",
                    [],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            match row {
                Some((revision, snapshot)) => {
                    let payload: serde_json::Value = serde_json::from_str(&snapshot)
                        .map_err(|error| MailError::Io(std::io::Error::other(error)))?;
                    Ok(serde_json::json!({ "revision": revision, "payload": payload }))
                }
                None => Ok(serde_json::json!({ "revision": 0, "payload": null })),
            }
        })
    }

    pub fn write_composer_recovery(&self, revision: i64, snapshot: &str) -> MailResult<bool> {
        if !(1..=9_007_199_254_740_991).contains(&revision) || snapshot.len() > 32 * 1024 * 1024 {
            return Err(MailError::Imap(
                "恢复点版本无效或正文超过 32 MiB；编辑内容尚未保存，请手动保存草稿。".into(),
            ));
        }
        self.with_conn(|conn| {
            let changed = conn.execute(
                "INSERT INTO composer_recovery(id, revision, snapshot, updated_at) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET revision = excluded.revision,
                     snapshot = excluded.snapshot, updated_at = excluded.updated_at
                 WHERE excluded.revision > composer_recovery.revision",
                params![revision, snapshot, Utc::now().to_rfc3339()],
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
        assert!(store.write_composer_recovery(10, snapshot).unwrap());
        assert!(!store.write_composer_recovery(9, "null").unwrap());
        drop(store);
        let store = MailStore::open_at_with_seed(path, false).unwrap();
        assert_eq!(
            store.load_composer_recovery().unwrap()["payload"]["draft"]["body"],
            "完整正文"
        );
        assert!(store.write_composer_recovery(12, "null").unwrap());
        assert!(!store.write_composer_recovery(11, snapshot).unwrap());
        assert!(!store.write_composer_recovery(12, snapshot).unwrap());
        assert!(store.load_composer_recovery().unwrap()["payload"].is_null());
        assert!(store.write_composer_recovery(13, snapshot).unwrap());
    }

    #[test]
    fn invalid_recovery_does_not_destroy_the_previous_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let store =
            MailStore::open_at_with_seed(dir.path().join("recovery.sqlite3"), false).unwrap();
        assert!(store
            .write_composer_recovery(1, r#"{"body":"previous"}"#)
            .unwrap());
        assert!(store.write_composer_recovery(2, "invalid JSON").is_err());
        assert!(store.write_composer_recovery(-1, "null").is_err());
        assert_eq!(
            store.load_composer_recovery().unwrap()["payload"]["body"],
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
        store.write_composer_recovery(1, &snapshot).unwrap();
        assert_eq!(
            store
                .prune_temp_attachments(std::time::Duration::ZERO)
                .unwrap(),
            0
        );
        assert!(attachment.exists());
        store.write_composer_recovery(2, "null").unwrap();
        assert_eq!(
            store
                .prune_temp_attachments(std::time::Duration::ZERO)
                .unwrap(),
            1
        );
    }
}
