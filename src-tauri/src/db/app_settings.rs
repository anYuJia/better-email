use super::*;

/// 应用全局设置：不按邮箱账号区分。
/// 采用与 ai_settings 相同的单例表（id = 1）模式，字段缺失时安全回退默认值。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AppSettingsRecord {
    /// 用户显式选择的「默认附件下载位置」绝对路径。
    /// 为空字符串表示未自定义，应回退到系统 Downloads/better-email 默认目录。
    pub default_download_dir: String,
}

impl MailStore {
    pub fn save_app_settings(&self, record: &AppSettingsRecord) -> MailResult<()> {
        self.with_conn(|conn| store_app_settings_for_conn(conn, record))
    }

    pub fn load_app_settings(&self) -> MailResult<AppSettingsRecord> {
        self.with_conn(load_app_settings_for_conn)
    }

    /// 解析生效的附件下载目录：
    /// - 用户已显式配置且为绝对路径时使用该路径；
    /// - 否则使用系统 Downloads/better-email 默认目录；
    /// - 数据库记录里的配置路径与数据库/应用数据目录重叠或非法时视为无效并回退默认，
    ///   避免把附件写到数据库目录等危险位置。
    pub fn resolve_download_dir(&self) -> MailResult<PathBuf> {
        let settings = self.load_app_settings()?;
        let configured = settings.default_download_dir.trim();
        if !configured.is_empty() {
            let candidate = PathBuf::from(configured);
            if is_safe_download_dir(&candidate, &self.data_dir) {
                return Ok(candidate);
            }
            crate::logging::log_line(
                "[better-email][app_settings] configured download dir rejected, falling back to default",
            );
        }
        Ok(default_download_dir())
    }

    /// 恢复默认：清除用户自定义路径，下次解析回退到系统 Downloads/better-email。
    pub fn reset_download_dir(&self) -> MailResult<()> {
        let record = AppSettingsRecord {
            default_download_dir: String::new(),
        };
        self.save_app_settings(&record)
    }

    /// 校验并保存一个用户通过目录选择器选择的下载目录。
    /// 非绝对路径、位于应用数据目录内部或不可写时返回可操作的中文错误，且不写入数据库。
    pub fn validate_and_save_download_dir(&self, directory: &str) -> MailResult<()> {
        let trimmed = directory.trim();
        if trimmed.is_empty() {
            return Err(MailError::Imap("下载目录不能为空。".to_string()));
        }
        let candidate = PathBuf::from(trimmed);
        if !is_safe_download_dir(&candidate, &self.data_dir) {
            return Err(MailError::Imap(
                "所选位置不可用：不能选择应用数据目录或未确认的相对路径。请另选一个安全文件夹。"
                    .to_string(),
            ));
        }
        if let Err(error) = ensure_writable_directory(&candidate) {
            return Err(MailError::Imap(format!(
                "无法写入所选文件夹：{error}。请换一个可写的目录后再试，本次不会保存该位置。"
            )));
        }
        self.save_app_settings(&AppSettingsRecord {
            default_download_dir: trimmed.to_string(),
        })
    }
}

fn store_app_settings_for_conn(conn: &Connection, record: &AppSettingsRecord) -> MailResult<()> {
    conn.execute(
        "
        INSERT INTO app_settings(id, default_download_dir, updated_at)
        VALUES (1, ?1, ?2)
        ON CONFLICT(id) DO UPDATE SET
            default_download_dir = excluded.default_download_dir,
            updated_at = excluded.updated_at
        ",
        params![record.default_download_dir, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

fn load_app_settings_for_conn(conn: &Connection) -> MailResult<AppSettingsRecord> {
    let value = conn
        .query_row(
            "SELECT default_download_dir FROM app_settings WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(AppSettingsRecord {
        default_download_dir: value.unwrap_or_default(),
    })
}

/// 系统 Downloads 目录下命名更明确的子目录；若解析失败则逐级回退，尽量避免硬编码。
pub fn default_download_dir() -> PathBuf {
    if let Some(downloads) = dirs::download_dir() {
        return downloads.join("better-email");
    }
    if let Some(home) = dirs::home_dir() {
        return home.join("Downloads").join("better-email");
    }
    std::env::temp_dir().join("better-email")
}

/// 判定一个目录是否可作为附件下载位置。拒绝相对路径、空值、以及位于应用
/// 数据目录（含数据库/附件缓存）内部的路径，防止通过配置写入数据库目录等危险位置。
pub(crate) fn is_safe_download_dir(candidate: &Path, data_dir: &Path) -> bool {
    if !candidate.is_absolute() || candidate.as_os_str().is_empty() {
        return false;
    }
    if candidate == data_dir || candidate.starts_with(data_dir) || data_dir.starts_with(candidate) {
        return false;
    }
    // 含 .. 相对片段视为非法。
    !candidate
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
}

/// 确保目录存在并可写：递归创建目录，并以原子方式创建唯一探针文件验证写权限。
/// 使用 create_new(true) 占用一个带进程号与序号的新名称；名称冲突时重试，
/// 只删除本次调用成功创建的探针文件，绝不修改或删除目录中原有文件。
pub(crate) fn ensure_writable_directory(dir: &Path) -> std::io::Result<()> {
    use std::io::{ErrorKind, Write};
    fs::create_dir_all(dir)?;
    const MAX_ATTEMPTS: u32 = 32;
    let pid = std::process::id();
    for attempt in 0..MAX_ATTEMPTS {
        let probe = dir.join(format!(".better-email-write-probe-{pid}-{attempt}"));
        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
        {
            Ok(file) => file,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let write_result = file.write_all(b"better-email-write-probe");
        drop(file);
        // 只删除本次调用成功创建的探针文件。
        let _ = fs::remove_file(&probe);
        write_result?;
        return Ok(());
    }
    Err(std::io::Error::other(
        "目录包含过多同前缀文件，无法创建写入探针",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static APP_SETTINGS_TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_database_path(_prefix: &str) -> PathBuf {
        let unique = APP_SETTINGS_TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "better-email-app-settings-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            unique
        ));
        fs::create_dir_all(&dir).expect("test data dir created");
        dir.join("better-email.sqlite3")
    }

    fn fresh_store() -> MailStore {
        MailStore::open_at(temp_database_path("fresh")).expect("store opens")
    }

    #[test]
    fn default_download_dir_is_absolute_better_email_subdir() {
        let dir = default_download_dir();
        assert!(dir.is_absolute());
        assert_eq!(
            dir.file_name().and_then(|name| name.to_str()),
            Some("better-email")
        );
    }

    #[test]
    fn fresh_store_falls_back_to_default_download_dir() {
        let store = fresh_store();
        let resolved = store.resolve_download_dir().expect("resolve");
        // 未配置时应与系统默认一致。
        assert_eq!(resolved, default_download_dir());
        // 读取设置字段缺失时安全回退。
        let settings = store.load_app_settings().expect("load");
        assert!(settings.default_download_dir.is_empty());
    }

    #[test]
    fn saving_configured_dir_is_read_back_and_resolve_uses_it() {
        let store = fresh_store();
        let custom = std::env::temp_dir().join("better-email-downloads-test");
        store
            .save_app_settings(&AppSettingsRecord {
                default_download_dir: custom.to_string_lossy().into_owned(),
            })
            .expect("save");
        let settings = store.load_app_settings().expect("load");
        assert_eq!(PathBuf::from(settings.default_download_dir), custom);
        assert_eq!(
            store.resolve_download_dir().expect("resolve"),
            custom,
            "自定义配置应覆盖默认目录"
        );
    }

    #[test]
    fn reset_download_dir_restores_default() {
        let store = fresh_store();
        let custom = std::env::temp_dir().join("better-email-downloads-test-reset");
        store
            .validate_and_save_download_dir(&custom.to_string_lossy())
            .expect("save custom");
        assert_eq!(store.resolve_download_dir().expect("resolve"), custom);

        store.reset_download_dir().expect("reset");
        assert_eq!(
            store.resolve_download_dir().expect("resolve"),
            default_download_dir()
        );
        let settings = store.load_app_settings().expect("load");
        assert!(settings.default_download_dir.is_empty());
    }

    #[test]
    fn rejects_data_dir_and_non_absolute_paths() {
        let store = fresh_store();
        let previous = store.resolve_download_dir().expect("resolve");

        // 数据目录内部：拒绝。
        assert!(store
            .validate_and_save_download_dir(&store.data_dir.to_string_lossy())
            .is_err());
        // 数据库目录内的子目录：拒绝。
        let inner = store.data_dir.join("attachments");
        assert!(store
            .validate_and_save_download_dir(&inner.to_string_lossy())
            .is_err());
        // 相对路径：拒绝。
        assert!(store
            .validate_and_save_download_dir("foo/downloads")
            .is_err());
        // 空值：拒绝。
        assert!(store.validate_and_save_download_dir("").is_err());

        // 被拒绝的路径都不应写入数据库；解析结果保持默认。
        assert_eq!(store.resolve_download_dir().expect("resolve"), previous);
    }

    #[test]
    fn writable_directory_is_created_and_saved() {
        let store = fresh_store();
        let target = std::env::temp_dir().join(format!(
            "better-email-writable-{}",
            APP_SETTINGS_TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        store
            .validate_and_save_download_dir(&target.to_string_lossy())
            .expect("writable dir saved");
        assert!(target.is_dir(), "目标目录应被递归创建");
        assert_eq!(store.resolve_download_dir().expect("resolve"), target);
        // 清理：不影响其它测试的默认目录断言。
        let _ = fs::remove_dir_all(&target);
    }

    #[test]
    fn write_probe_never_modifies_pre_existing_files() {
        let target = std::env::temp_dir().join(format!(
            "better-email-probe-guard-{}",
            APP_SETTINGS_TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&target).expect("probe dir created");

        // 旧固定探针名 + 本次命名方案下的第一个候选名，都预置哨兵内容。
        let legacy = target.join(".better-email-write-probe");
        let first_candidate = target.join(format!(
            ".better-email-write-probe-{}-0",
            std::process::id()
        ));
        fs::write(&legacy, b"legacy-sentinel").expect("legacy sentinel written");
        fs::write(&first_candidate, b"candidate-sentinel").expect("candidate sentinel written");

        ensure_writable_directory(&target).expect("writable probe succeeds");

        assert_eq!(
            fs::read(&legacy).expect("read legacy sentinel"),
            b"legacy-sentinel",
            "固定探针名同名文件不得被截断或删除"
        );
        assert_eq!(
            fs::read(&first_candidate).expect("read candidate sentinel"),
            b"candidate-sentinel",
            "与候选探针名冲突的用户文件不得被覆盖"
        );
        // 本次调用创建的探针文件应已清理，目录中只剩两个哨兵文件。
        let remaining: Vec<_> = fs::read_dir(&target)
            .expect("list probe dir")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(
            remaining.len(),
            2,
            "不应遗留本次创建的探针文件: {remaining:?}"
        );

        let _ = fs::remove_dir_all(&target);
    }
}
