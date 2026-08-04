use super::*;
use super::migrations::path_with_suffix;

pub(super) type AttachmentStorageIndex = (BTreeSet<PathBuf>, Vec<(i64, PathBuf)>);

impl MailStore {
    pub fn list_attachments(&self, message_id: i64) -> MailResult<Vec<Attachment>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
                        local_path, content_id, is_inline
                 FROM attachments WHERE message_id = ?1 ORDER BY filename",
            )?;
            let attachments = stmt
                .query_map(params![message_id], |row| {
                    Ok(Attachment {
                        id: row.get(0)?,
                        message_id: row.get(1)?,
                        filename: row.get(2)?,
                        mime_type: row.get(3)?,
                        size_bytes: row.get(4)?,
                        is_downloaded: row.get::<_, i64>(5)? != 0,
                        local_path: row.get(6)?,
                        content_id: row.get(7)?,
                        is_inline: row.get::<_, i64>(8)? != 0,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(attachments)
        })
    }
    pub fn get_attachment(&self, attachment_id: i64) -> MailResult<Attachment> {
        self.with_conn(|conn| attachment_for_conn(conn, attachment_id))
    }
    pub fn mark_attachment_downloaded(
        &self,
        attachment_id: i64,
        local_path: &str,
        size_bytes: i64,
    ) -> MailResult<Attachment> {
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE attachments
                SET is_downloaded = 1, local_path = ?2, size_bytes = ?3
                WHERE id = ?1
                ",
                params![attachment_id, local_path, size_bytes],
            )?;
            attachment_for_conn(conn, attachment_id)
        })
    }
    pub fn attachment_dir(&self, message_id: i64) -> PathBuf {
        self.data_dir
            .join("attachments")
            .join(message_id.to_string())
    }
    pub fn storage_usage(&self) -> MailResult<StorageUsage> {
        let attachment_root = self.data_dir.join("attachments");
        let (protected_paths, reclaimable_rows) = self.attachment_storage_index()?;
        let mut reclaimable_cache_bytes = 0_i64;
        let mut reclaimable_file_count = 0_i64;
        let mut local_attachment_bytes = 0_i64;
        let mut local_attachment_file_count = 0_i64;
        let mut partial_download_bytes = 0_i64;
        let mut partial_download_count = 0_i64;

        for (path, size_bytes) in collect_regular_files(&attachment_root)? {
            if protected_paths.contains(&path) {
                local_attachment_bytes += size_bytes;
                local_attachment_file_count += 1;
                continue;
            }
            reclaimable_cache_bytes += size_bytes;
            reclaimable_file_count += 1;
            if is_partial_attachment_path(&path) {
                partial_download_bytes += size_bytes;
                partial_download_count += 1;
            }
        }

        let database_bytes = database_storage_bytes(&self.database_path);
        Ok(StorageUsage {
            database_bytes,
            reclaimable_cache_bytes,
            reclaimable_file_count,
            cached_attachment_count: reclaimable_rows.len().min(i64::MAX as usize) as i64,
            local_attachment_bytes,
            local_attachment_file_count,
            partial_download_bytes,
            partial_download_count,
            total_managed_bytes: database_bytes
                .saturating_add(reclaimable_cache_bytes)
                .saturating_add(local_attachment_bytes),
        })
    }
    pub fn clear_reclaimable_attachment_cache(&self) -> MailResult<CacheClearResult> {
        let attachment_root = self.data_dir.join("attachments");
        let usage_before = self.storage_usage()?;
        let (protected_paths, reclaimable_rows) = self.attachment_storage_index()?;

        for (path, _) in collect_regular_files(&attachment_root)? {
            if !protected_paths.contains(&path) {
                fs::remove_file(path)?;
            }
        }

        if !reclaimable_rows.is_empty() {
            self.with_conn(|conn| {
                let transaction = conn.unchecked_transaction()?;
                for (attachment_id, _) in &reclaimable_rows {
                    transaction.execute(
                        "UPDATE attachments SET is_downloaded = 0, local_path = '' WHERE id = ?1",
                        params![attachment_id],
                    )?;
                }
                transaction.commit()?;
                Ok(())
            })?;
        }

        prune_empty_directories(&attachment_root, true)?;
        let storage = self.storage_usage()?;
        Ok(CacheClearResult {
            removed_file_count: usage_before.reclaimable_file_count,
            reset_attachment_count: reclaimable_rows.len().min(i64::MAX as usize) as i64,
            released_bytes: usage_before
                .reclaimable_cache_bytes
                .saturating_sub(storage.reclaimable_cache_bytes),
            storage,
        })
    }
    fn attachment_storage_index(&self) -> MailResult<AttachmentStorageIndex> {
        let attachment_root = self.data_dir.join("attachments");
        self.with_conn(|conn| {
            let mut statement = conn.prepare(
                "
                SELECT a.id, a.local_path, m.remote_mailbox, m.remote_uid
                FROM attachments a
                JOIN messages m ON m.id = a.message_id
                WHERE a.is_downloaded = 1 AND a.local_path <> ''
                ",
            )?;
            let rows = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            let mut protected_paths = BTreeSet::new();
            let mut reclaimable_rows = Vec::new();
            for (attachment_id, local_path, remote_mailbox, remote_uid) in rows {
                let path = PathBuf::from(local_path);
                if !is_managed_attachment_path(&attachment_root, &path) {
                    continue;
                }
                if remote_uid > 0 && !remote_mailbox.trim().is_empty() {
                    reclaimable_rows.push((attachment_id, path));
                } else {
                    protected_paths.insert(path);
                }
            }
            Ok((protected_paths, reclaimable_rows))
        })
    }
}

pub(super) fn attachment_count_for_message(conn: &Connection, message_id: i64) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM attachments WHERE message_id = ?1",
        params![message_id],
        |row| row.get(0),
    )
}
pub(super) fn attachments_for_message_conn(
    conn: &Connection,
    message_id: i64,
) -> rusqlite::Result<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
                local_path, content_id, is_inline
         FROM attachments WHERE message_id = ?1 ORDER BY filename",
    )?;
    let attachments = stmt
        .query_map(params![message_id], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                message_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size_bytes: row.get(4)?,
                is_downloaded: row.get::<_, i64>(5)? != 0,
                local_path: row.get(6)?,
                content_id: row.get(7)?,
                is_inline: row.get::<_, i64>(8)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(attachments)
}
pub(super) fn attachment_for_conn(conn: &Connection, attachment_id: i64) -> MailResult<Attachment> {
    conn.query_row(
        "
        SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
               local_path, content_id, is_inline
        FROM attachments
        WHERE id = ?1
        ",
        params![attachment_id],
        |row| {
            Ok(Attachment {
                id: row.get(0)?,
                message_id: row.get(1)?,
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size_bytes: row.get(4)?,
                is_downloaded: row.get::<_, i64>(5)? != 0,
                local_path: row.get(6)?,
                content_id: row.get(7)?,
                is_inline: row.get::<_, i64>(8)? != 0,
            })
        },
    )
    .map_err(Into::into)
}
pub(super) fn database_storage_bytes(database_path: &Path) -> i64 {
    [
        database_path.to_path_buf(),
        path_with_suffix(database_path, "-wal"),
        path_with_suffix(database_path, "-shm"),
    ]
    .iter()
    .filter_map(|path| fs::metadata(path).ok())
    .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
    .fold(0_i64, i64::saturating_add)
}
pub(super) fn is_managed_attachment_path(root: &Path, path: &Path) -> bool {
    path.is_absolute()
        && path.starts_with(root)
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}
pub(super) fn is_partial_attachment_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("download" | "decoded")
    )
}
pub(super) fn collect_regular_files(root: &Path) -> MailResult<Vec<(PathBuf, i64)>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_regular_files_into(root, &mut files)?;
    Ok(files)
}
pub(super) fn collect_regular_files_into(root: &Path, files: &mut Vec<(PathBuf, i64)>) -> MailResult<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_regular_files_into(&path, files)?;
        } else if file_type.is_file() {
            files.push((path, entry.metadata()?.len().min(i64::MAX as u64) as i64));
        }
    }
    Ok(())
}
pub(super) fn prune_empty_directories(root: &Path, preserve_root: bool) -> MailResult<bool> {
    if !root.exists() {
        return Ok(true);
    }
    let mut empty = true;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || file_type.is_file() {
            empty = false;
            continue;
        }
        if file_type.is_dir() && !prune_empty_directories(&entry.path(), false)? {
            empty = false;
        }
    }
    if empty && !preserve_root {
        fs::remove_dir(root)?;
    }
    Ok(empty)
}

