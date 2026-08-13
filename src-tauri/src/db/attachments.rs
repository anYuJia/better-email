use super::migrations::path_with_suffix;
use super::*;
use sha2::{Digest, Sha256};
use std::io::Read;

pub(super) type AttachmentStorageIndex = (BTreeSet<PathBuf>, Vec<(i64, PathBuf)>);

impl MailStore {
    pub fn list_attachments(&self, message_id: i64) -> MailResult<Vec<Attachment>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
                        local_path, content_sha256, content_id, is_inline
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
                        content_id: row.get(8)?,
                        is_inline: row.get::<_, i64>(9)? != 0,
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
        // 正常下载/导入路径在调用前已经把文件原子落盘。只有真实存在、大小一致的
        // 常规文件才记录摘要；旧数据或文件已丢失的记录保留为空摘要，后续外发时
        // 会安全拒绝，而不是把未绑定内容的路径当作可发送来源。
        let content_sha256 = match fs::canonicalize(local_path) {
            Ok(canonical) => match fs::metadata(&canonical) {
                Ok(metadata)
                    if metadata.is_file()
                        && metadata.len().min(i64::MAX as u64) as i64 == size_bytes =>
                {
                    sha256_for_file(&canonical, size_bytes)?
                }
                _ => String::new(),
            },
            Err(_) => String::new(),
        };
        self.with_conn(|conn| {
            conn.execute(
                "
                UPDATE attachments
                SET is_downloaded = 1, local_path = ?2, size_bytes = ?3, content_sha256 = ?4
                WHERE id = ?1
                ",
                params![attachment_id, local_path, size_bytes, content_sha256],
            )?;
            attachment_for_conn(conn, attachment_id)
        })
    }
    pub fn attachment_dir(&self, message_id: i64) -> PathBuf {
        self.data_dir
            .join("attachments")
            .join(message_id.to_string())
    }

    /// 应用受管理的附件根目录（所有已下载附件文件的合法位置）。
    pub fn attachment_root(&self) -> PathBuf {
        self.data_dir.join("attachments")
    }

    /// 粘贴/拖入附件写入的受管临时目录。
    pub fn temp_attachment_dir(&self) -> PathBuf {
        self.data_dir.join("temp_attachments")
    }

    /// 由 Rust 后端从用户选取文件复制出的私有外发附件目录。
    ///
    /// 外发时只读取这份受管副本，避免用户路径在授权检查和实际读取之间被
    /// 同路径、同大小的恶意内容替换。
    pub fn outbound_attachment_dir(&self) -> PathBuf {
        self.data_dir.join("outbound_attachments")
    }

    /// 仍被草稿或待发送/待远端留档邮件引用的临时附件路径。
    fn referenced_temp_attachment_paths(&self) -> MailResult<BTreeSet<PathBuf>> {
        let temp_dir = canonical_or_normalized_path(&self.temp_attachment_dir());
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT a.local_path
                FROM attachments a
                JOIN messages m ON m.id = a.message_id
                JOIN folders f ON f.id = m.folder_id
                LEFT JOIN outbox_queue q ON q.message_id = m.id
                WHERE a.is_downloaded = 1
                  AND a.local_path <> ''
                  AND (
                    f.role = 'drafts'
                    OR q.status IN ('queued', 'retry', 'scheduled', 'failed', 'cancelled', 'sent_remote_pending')
                  )
                ",
            )?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            let mut referenced = BTreeSet::new();
            for path in rows {
                let path = canonical_or_normalized_path(&PathBuf::from(path));
                if is_path_within_root(&temp_dir, &path) {
                    referenced.insert(path);
                }
            }
            Ok(referenced)
        })
    }

    /// 清理不再被任何草稿/发件箱/待留档邮件引用的临时附件：
    /// 未被引用且超过安全宽限 TTL 的文件被删除；被引用的文件始终保留。
    /// 返回删除的文件数。
    pub fn prune_temp_attachments(&self, ttl: std::time::Duration) -> MailResult<usize> {
        let temp_dir = self.temp_attachment_dir();
        if !temp_dir.exists() {
            return Ok(0);
        }
        let canonical_temp_dir = canonical_or_normalized_path(&temp_dir);
        let referenced = self.referenced_temp_attachment_paths()?;
        let cutoff = std::time::SystemTime::now()
            .checked_sub(ttl)
            .unwrap_or(std::time::UNIX_EPOCH);
        let mut removed = 0_usize;
        for entry in fs::read_dir(&temp_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = canonical_or_normalized_path(&entry.path());
            if !is_path_within_root(&canonical_temp_dir, &path) {
                continue;
            }
            if referenced.contains(&path) {
                continue;
            }
            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .unwrap_or(std::time::UNIX_EPOCH);
            if modified < cutoff && fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
        prune_empty_directories(&temp_dir, true)?;
        Ok(removed)
    }

    /// 记录一次发件附件授权：路径、大小与内容摘要共同绑定。
    pub fn register_outbound_attachment_auth(
        &self,
        canonical_path: &str,
        size_bytes: i64,
        content_sha256: &str,
    ) -> MailResult<()> {
        self.with_conn(|conn| {
            conn.execute(
                "INSERT INTO outbound_attachment_auths(canonical_path, size_bytes, content_sha256, created_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(canonical_path) DO UPDATE SET
                    size_bytes = excluded.size_bytes,
                    content_sha256 = excluded.content_sha256,
                    created_at = excluded.created_at",
                params![
                    canonical_path,
                    size_bytes,
                    content_sha256,
                    Utc::now().to_rfc3339()
                ],
            )?;
            Ok(())
        })
    }

    /// 校验发件附件是否已授权且路径、大小、内容摘要都一致。
    pub fn is_outbound_attachment_authorized(
        &self,
        canonical_path: &str,
        size_bytes: i64,
        content_sha256: &str,
    ) -> MailResult<bool> {
        self.with_conn(|conn| {
            let exists: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM outbound_attachment_auths
                     WHERE canonical_path = ?1 AND size_bytes = ?2 AND content_sha256 = ?3 LIMIT 1",
                    params![canonical_path, size_bytes, content_sha256],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(exists.is_some())
        })
    }

    /// 判断某个具体文件是否是应用「实际下载」的源附件：即存在一个已下载附件
    /// 记录（is_downloaded = 1，size 匹配，所属邮件不是草稿/发件箱）且其磁盘文件
    /// 规范化后与输入路径一致。
    ///
    /// 这是转发/回填等流程引用已下载附件的唯一授权依据：按具体文件与数据库记录
    /// 绑定，绝不因文件恰好位于某个宽目录（如用户下载目录）就放行。
    pub fn is_downloaded_source_attachment(
        &self,
        canonical_path: &Path,
        size_bytes: i64,
        content_sha256: &str,
    ) -> MailResult<bool> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "
                SELECT a.local_path, a.content_sha256
                FROM attachments a
                JOIN messages m ON m.id = a.message_id
                JOIN folders f ON f.id = m.folder_id
                LEFT JOIN outbox_queue q ON q.message_id = m.id
                WHERE a.is_downloaded = 1
                  AND a.local_path <> ''
                  AND a.size_bytes = ?1
                  AND a.content_sha256 = ?2
                  AND a.content_sha256 <> ''
                  AND f.role <> 'drafts'
                  AND q.message_id IS NULL
                ",
            )?;
            let rows = stmt
                .query_map(params![size_bytes, content_sha256], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for local_path in rows {
                if let Ok(row_canonical) = fs::canonicalize(&local_path) {
                    if row_canonical == *canonical_path {
                        return Ok(true);
                    }
                }
            }
            Ok(false)
        })
    }

    /// 清理过期的发件附件授权记录（超过 max_age_days），避免无界增长。
    pub fn cleanup_outbound_attachment_auths(&self, max_age_days: i64) -> MailResult<usize> {
        self.with_conn(|conn| {
            let cutoff = (Utc::now() - chrono::Duration::days(max_age_days)).to_rfc3339();
            let removed = conn.execute(
                "DELETE FROM outbound_attachment_auths WHERE created_at < ?1",
                params![cutoff],
            )?;
            Ok(removed)
        })
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

        // 临时附件：仍被草稿/发件箱引用的计入受保护本地文件；
        // 不再被引用的计入可清理缓存。
        let referenced_temp = self.referenced_temp_attachment_paths()?;
        for (path, size_bytes) in collect_regular_files(&self.temp_attachment_dir())? {
            if referenced_temp.contains(&path) {
                local_attachment_bytes += size_bytes;
                local_attachment_file_count += 1;
            } else {
                reclaimable_cache_bytes += size_bytes;
                reclaimable_file_count += 1;
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

        // 清理不再被草稿/发件箱引用的临时附件。显式清理是用户主动行为，
        // 不受常规 TTL 宽限约束；仍被引用的文件由 prune 内部保留。
        let _ = self.prune_temp_attachments(std::time::Duration::from_secs(0))?;

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
        let attachment_root = canonical_or_normalized_path(&self.data_dir.join("attachments"));
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
                // 数据库存量路径可能是 macOS `/var/...`，而扫描结果会解析为
                // `/private/var/...`。索引侧也必须用同一规范化表示才能比较。
                let path = canonical_or_normalized_path(&PathBuf::from(local_path));
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

/// 对已经打开前确认大小的普通文件流式计算 SHA-256。读取期间的实际长度必须仍
/// 与调用方预期一致，避免把同时变化的文件登记为可信内容。
pub(super) fn sha256_for_file(path: &Path, expected_size: i64) -> MailResult<String> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut total = 0_i64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read.min(i64::MAX as usize) as i64);
        if total > expected_size {
            return Err(crate::db::MailError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "附件在读取期间发生变化。",
            )));
        }
        digest.update(&buffer[..read]);
    }
    if total != expected_size {
        return Err(crate::db::MailError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "附件在读取期间发生变化。",
        )));
    }
    let digest = digest.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    use std::fmt::Write as _;
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    Ok(encoded)
}

pub(super) fn attachment_count_for_message(
    conn: &Connection,
    message_id: i64,
) -> rusqlite::Result<i64> {
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
                local_path, content_sha256, content_id, is_inline
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
                content_id: row.get(8)?,
                is_inline: row.get::<_, i64>(9)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(attachments)
}
pub(super) fn attachment_for_conn(conn: &Connection, attachment_id: i64) -> MailResult<Attachment> {
    conn.query_row(
        "
        SELECT id, message_id, filename, mime_type, size_bytes, is_downloaded,
               local_path, content_sha256, content_id, is_inline
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
                content_id: row.get(8)?,
                is_inline: row.get::<_, i64>(9)? != 0,
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
/// 将现有路径规范化为可比较的绝对路径。存在的路径使用 canonicalize 统一
/// macOS `/var` 与 `/private/var` 等别名；不存在路径则仅规范化组件，供安全
/// 判断时保守拒绝任何包含 `..` 的输入。
pub(super) fn canonical_or_normalized_path(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| normalize_absolute_path(path))
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// 基于 Path 组件而不是字符串前缀判断包含关系，防止
/// `/temp_attachments_evil` 被误认为在 `/temp_attachments` 内。
pub(super) fn is_path_within_root(root: &Path, path: &Path) -> bool {
    let root = canonical_or_normalized_path(root);
    let path = canonical_or_normalized_path(path);
    path.is_absolute()
        && path.starts_with(&root)
        && path != root
        && !path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
}

pub(super) fn is_managed_attachment_path(root: &Path, path: &Path) -> bool {
    is_path_within_root(root, path)
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
    let root = canonical_or_normalized_path(root);
    collect_regular_files_into(&root, &mut files)?;
    Ok(files)
}
pub(super) fn collect_regular_files_into(
    root: &Path,
    files: &mut Vec<(PathBuf, i64)>,
) -> MailResult<()> {
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
            let canonical = canonical_or_normalized_path(&path);
            if is_path_within_root(root, &canonical) {
                files.push((
                    canonical,
                    entry.metadata()?.len().min(i64::MAX as u64) as i64,
                ));
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DraftInput, OutboundAttachmentInput};
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_TEMP_DB_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_test_database_path() -> PathBuf {
        let unique = TEST_TEMP_DB_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "better-email-temp-attachment-test-{}-{}",
            std::process::id(),
            unique
        ));
        fs::create_dir_all(&dir).expect("test data dir created");
        dir.join("better-email.sqlite3")
    }

    fn seeded_store() -> MailStore {
        MailStore::open_at_with_seed(unique_test_database_path(), true).expect("test store opens")
    }

    fn draft_with_attachment(local_path: &str, filename: &str, size_bytes: i64) -> DraftInput {
        DraftInput {
            draft_id: 0,
            account_id: 0,
            identity_id: 0,
            to: "friend@example.com".to_string(),
            cc: String::new(),
            bcc: String::new(),
            subject: "Draft".to_string(),
            body: "body".to_string(),
            html_body: String::new(),
            send_at: String::new(),
            attachments: vec![OutboundAttachmentInput {
                filename: filename.to_string(),
                mime_type: "application/octet-stream".to_string(),
                size_bytes,
                local_path: local_path.to_string(),
                content_id: String::new(),
                is_inline: false,
            }],
        }
    }

    #[test]
    fn prune_temp_attachments_removes_orphans_but_preserves_referenced_files() {
        let store = seeded_store();
        let temp_dir = store.temp_attachment_dir();
        fs::create_dir_all(&temp_dir).unwrap();

        // 一个被草稿引用的临时附件。
        let referenced_file = temp_dir.join("referenced.txt");
        fs::write(&referenced_file, b"referenced").unwrap();
        let size = referenced_file.metadata().unwrap().len() as i64;
        let draft_id = store
            .save_draft(draft_with_attachment(
                &referenced_file.to_string_lossy(),
                "referenced.txt",
                size,
            ))
            .expect("draft saved");
        assert!(store.get_outbound_message(draft_id).is_ok());

        // 一个孤儿临时附件（从未被引用）。
        let orphan = temp_dir.join("orphan.bin");
        fs::write(&orphan, b"orphan-content").unwrap();

        // TTL=0：未被引用即删除，被引用的保留。
        let removed = store
            .prune_temp_attachments(std::time::Duration::from_secs(0))
            .expect("prune");
        assert_eq!(removed, 1, "应删除 1 个孤儿文件");
        assert!(!orphan.exists(), "孤儿文件应被删除");
        assert!(referenced_file.exists(), "被草稿引用的文件应保留");
    }

    #[test]
    fn storage_usage_and_cache_clear_include_temp_attachments() {
        let store = seeded_store();
        let temp_dir = store.temp_attachment_dir();
        fs::create_dir_all(&temp_dir).unwrap();

        let orphan = temp_dir.join("orphan.bin");
        fs::write(&orphan, b"12345").unwrap();

        // 被草稿引用的临时附件计入受保护本地附件，孤儿计入可清理缓存。
        let referenced_file = temp_dir.join("referenced.txt");
        fs::write(&referenced_file, b"referenced-content").unwrap();
        let size = referenced_file.metadata().unwrap().len() as i64;
        let draft_id = store
            .save_draft(draft_with_attachment(
                &referenced_file.to_string_lossy(),
                "referenced.txt",
                size,
            ))
            .expect("draft saved");

        let usage = store.storage_usage().expect("usage");
        assert_eq!(usage.reclaimable_file_count, 1, "孤儿临时附件可清理");
        assert!(
            usage.reclaimable_cache_bytes >= 5,
            "孤儿临时附件计入可清理缓存字节"
        );
        assert!(
            usage.local_attachment_bytes >= "referenced-content".len() as i64,
            "被引用临时附件计入受保护本地附件"
        );

        // 清理缓存会删除孤儿临时附件，但保留被引用的。
        let result = store.clear_reclaimable_attachment_cache().expect("clear");
        assert!(!orphan.exists(), "清理缓存应删除孤儿临时附件");
        assert!(referenced_file.exists(), "清理缓存应保留被引用临时附件");
        assert!(result.removed_file_count >= 1, "清理计数应包含临时附件");

        // 发送后（草稿移出 drafts）文件不再被引用，可被清理。
        let _ = store
            .get_outbound_message(draft_id)
            .expect("draft still there");
    }

    #[test]
    fn replacing_draft_attachment_releases_old_temp_file() {
        let store = seeded_store();
        let temp_dir = store.temp_attachment_dir();
        fs::create_dir_all(&temp_dir).unwrap();

        let temp_a = temp_dir.join("temp_a.bin");
        fs::write(&temp_a, b"a").unwrap();
        let size_a = temp_a.metadata().unwrap().len() as i64;
        let draft_id = store
            .save_draft(draft_with_attachment(
                &temp_a.to_string_lossy(),
                "temp_a.bin",
                size_a,
            ))
            .expect("draft saved");

        // 替换附件：草稿改为引用 temp_b。
        let temp_b = temp_dir.join("temp_b.bin");
        fs::write(&temp_b, b"bb").unwrap();
        let size_b = temp_b.metadata().unwrap().len() as i64;
        let mut updated = draft_with_attachment(&temp_b.to_string_lossy(), "temp_b.bin", size_b);
        updated.draft_id = draft_id;
        store.save_draft(updated).expect("draft updated");

        // 生命周期清理（TTL=0）：旧临时附件不再被引用立即删除，新附件保留。
        let removed = store
            .prune_temp_attachments(std::time::Duration::from_secs(0))
            .expect("prune");
        assert!(removed >= 1, "应删除被替换的旧临时附件");
        assert!(!temp_a.exists(), "替换后旧临时附件应被清理");
        assert!(temp_b.exists(), "仍被草稿引用的临时附件应保留");
    }

    #[test]
    fn deleting_draft_releases_temp_file() {
        let store = seeded_store();
        let temp_dir = store.temp_attachment_dir();
        fs::create_dir_all(&temp_dir).unwrap();

        let temp = temp_dir.join("deleted-draft.bin");
        fs::write(&temp, b"x").unwrap();
        let size = temp.metadata().unwrap().len() as i64;
        let draft_id = store
            .save_draft(draft_with_attachment(
                &temp.to_string_lossy(),
                "deleted-draft.bin",
                size,
            ))
            .expect("draft saved");
        assert!(temp.exists());

        // 删除草稿：附件记录随之删除，临时附件不再被引用。
        store
            .delete_message_permanently(draft_id)
            .expect("draft deleted");
        let _ = store
            .prune_temp_attachments(std::time::Duration::from_secs(0))
            .expect("prune");
        assert!(!temp.exists(), "删除草稿后临时附件应被清理");
    }

    #[test]
    fn temp_file_released_after_send_and_remote_archive_complete() {
        let store = seeded_store();
        let temp_dir = store.temp_attachment_dir();
        fs::create_dir_all(&temp_dir).unwrap();

        let temp = temp_dir.join("sent.bin");
        fs::write(&temp, b"x").unwrap();
        let size = temp.metadata().unwrap().len() as i64;
        let mut input = draft_with_attachment(&temp.to_string_lossy(), "sent.bin", size);
        input.account_id = store.get_account().expect("account").id;
        // 进入发件箱队列（queued）：临时附件被引用。
        let item = store.queue_outbox_message(input).expect("queued");
        let message_id = item.message_id;

        // 发送完成但等待远端留档：仍被引用，不得清理（供重试重建 MIME）。
        let message_id_header = "<better-email-sent@better-email.local>";
        store
            .mark_outbox_smtp_sent_pending_archive(message_id, message_id_header)
            .expect("sent pending archive");
        let _ = store
            .prune_temp_attachments(std::time::Duration::from_secs(0))
            .expect("prune");
        assert!(temp.exists(), "待远端归档时临时附件不得清理");

        // 远端归档完成：不再被引用，生命周期清理删除。
        store
            .mark_outbox_remote_archived(message_id, "Sent", 42)
            .expect("remote archived");
        let _ = store
            .prune_temp_attachments(std::time::Duration::from_secs(0))
            .expect("prune");
        assert!(!temp.exists(), "远端归档完成后临时附件应被清理");
    }
}
