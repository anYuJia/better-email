//! 应用层凭据加密。
//!
//! 项目刻意不使用系统凭据库（Keychain / Credential Manager）：打开设置页或
//! 查看邮件绝不能触发 Keychain 授权提示。作为替代，本地存储的账号密码、
//! OAuth token、AI/MCP API key 使用「每实例随机密钥」做应用层加密。
//!
//! 威胁模型：
//! - 密钥是首次写入凭据时随机生成、仅保存在应用数据目录下一个 0600 权限的
//!   `credentials.key` 文件，不是固定硬编码密钥，也不依赖系统密钥管理服务。
//! - 加密后，即便数据库文件被单独读取/复制，凭据列也是密文；攻击者同时拿到
//!   DB 文件与数据目录（含 key 文件）才可能解密。
//! - 纯文本旧值（升级前写入）带 `be1:` 前缀标识，读取时按密文尝试解密，
//!   无前缀的旧值按纯文本返回（惰性迁移：下次写入时自动加密），不破坏存量用户。
//! - 每次应用启动仍不会访问系统凭据库；本模块只在读写凭据时访问本地密钥文件。

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// 密文前缀：用于区分「本版本加密值」与「升级前遗留纯文本」。
const ENCRYPTED_MARKER: &str = "be1:";
const KEY_FILENAME: &str = "credentials.key";

fn read_existing_key(path: &Path) -> std::io::Result<[u8; 32]> {
    let raw = fs::read(path)?;
    raw.try_into().map_err(|_| {
        std::io::Error::new(
            ErrorKind::InvalidData,
            "凭据密钥损坏：已保留原文件，请恢复 credentials.key 备份。",
        )
    })
}

pub(crate) fn load_or_create_key(data_dir: &Path) -> std::io::Result<[u8; 32]> {
    let path = key_path(data_dir);
    match read_existing_key(&path) {
        Ok(key) => return Ok(key),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    fs::create_dir_all(data_dir)?;
    let temporary_path = data_dir.join(format!(".credentials-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temporary_path)?;
        let mut key = [0_u8; 32];
        getrandom::getrandom(&mut key)
            .map_err(|error| std::io::Error::other(format!("安全随机源不可用：{error}")))?;
        file.write_all(&key)?;
        file.sync_all()?;
        drop(file);
        match fs::hard_link(&temporary_path, &path) {
            Ok(()) => {
                #[cfg(unix)]
                fs::File::open(data_dir)?.sync_all()?;
                Ok(key)
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => read_existing_key(&path),
            Err(error) => Err(error),
        }
    })();
    let _ = fs::remove_file(&temporary_path);
    result
}

fn key_path(data_dir: &Path) -> PathBuf {
    data_dir.join(KEY_FILENAME)
}

/// 用每实例密钥加密纯文本，返回带标记的密文（base64）。
pub(crate) fn encrypt_secret(data_dir: &Path, plaintext: &str) -> std::io::Result<String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }
    let key = load_or_create_key(data_dir)?;
    let cipher = ChaCha20Poly1305::new((&key).into());
    let mut nonce_bytes = [0_u8; 12];
    #[allow(clippy::io_other_error)]
    getrandom::getrandom(&mut nonce_bytes).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::Other, format!("安全随机源不可用：{e}"))
    })?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| std::io::Error::other("凭据加密失败"))?;
    let mut payload = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(format!("{ENCRYPTED_MARKER}{}", BASE64.encode(payload)))
}

/// 解密存储值：带标记的按密文解密；升级前的纯文本（无标记）原样返回。
pub(crate) fn decrypt_secret(data_dir: &Path, stored: &str) -> std::io::Result<String> {
    if stored.is_empty() {
        return Ok(String::new());
    }
    let Some(payload_b64) = stored.strip_prefix(ENCRYPTED_MARKER) else {
        // 升级前的纯文本遗留值：惰性迁移（下次写入时加密）。
        return Ok(stored.to_string());
    };
    let payload = BASE64
        .decode(payload_b64)
        .map_err(|_| std::io::Error::other("凭据密文格式无效"))?;
    if payload.len() < 28 {
        return Err(std::io::Error::other("凭据密文过短"));
    }
    let key = read_existing_key(&key_path(data_dir)).map_err(|error| {
        std::io::Error::new(
            error.kind(),
            format!("无法读取原凭据密钥，未创建或覆盖密钥；请恢复 credentials.key 备份：{error}"),
        )
    })?;
    let cipher = ChaCha20Poly1305::new((&key).into());
    let (nonce_bytes, ciphertext) = payload.split_at(12);
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| std::io::Error::other("凭据解密失败（密钥不匹配或数据损坏）"))?;
    String::from_utf8(plaintext).map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::{decrypt_secret, encrypt_secret};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn round_trip_encrypts_and_decrypts_secrets() {
        let dir = std::env::temp_dir().join(format!(
            "better-email-secret-crypto-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let ciphertext = encrypt_secret(&dir, "SUPER_SECRET_TOKEN").unwrap();
        assert!(ciphertext.starts_with("be1:"), "密文应带版本标记");
        assert!(
            !ciphertext.contains("SUPER_SECRET_TOKEN"),
            "密文不得包含明文"
        );
        assert_eq!(
            decrypt_secret(&dir, &ciphertext).unwrap(),
            "SUPER_SECRET_TOKEN"
        );
        // 同一实例密钥可多次解密。
        assert_eq!(
            decrypt_secret(&dir, &ciphertext).unwrap(),
            "SUPER_SECRET_TOKEN"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_plaintext_values_read_back_unchanged() {
        let dir = std::env::temp_dir().join(format!(
            "better-email-secret-legacy-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(
            decrypt_secret(&dir, "LEGACY_PLAINTEXT_SECRET").unwrap(),
            "LEGACY_PLAINTEXT_SECRET",
            "升级前纯文本应原样返回"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_values_stay_empty() {
        let dir = std::env::temp_dir().join(format!(
            "better-email-secret-empty-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(encrypt_secret(&dir, "").unwrap(), "");
        assert_eq!(decrypt_secret(&dir, "").unwrap(), "");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn missing_key_is_never_created_while_decrypting() {
        let original = tempfile::tempdir().unwrap();
        let ciphertext = encrypt_secret(original.path(), "original secret").unwrap();
        let recovery = tempfile::tempdir().unwrap();
        let missing_dir = recovery.path().join("missing");
        let error = decrypt_secret(&missing_dir, &ciphertext).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::NotFound);
        assert!(!missing_dir.exists());
    }

    #[test]
    fn damaged_keys_are_preserved_on_both_read_and_write() {
        for length in [0, 1, 31, 33, 64] {
            let dir = tempfile::tempdir().unwrap();
            let ciphertext = encrypt_secret(dir.path(), "secret").unwrap();
            let damaged = vec![42; length];
            fs::write(key_path(dir.path()), &damaged).unwrap();
            assert!(decrypt_secret(dir.path(), &ciphertext).is_err());
            assert!(encrypt_secret(dir.path(), "replacement").is_err());
            assert_eq!(fs::read(key_path(dir.path())).unwrap(), damaged);
        }
    }

    #[test]
    fn concurrent_initialization_publishes_one_complete_key() {
        let dir = tempfile::tempdir().unwrap();
        let barrier = Arc::new(Barrier::new(12));
        let threads: Vec<_> = (0..12)
            .map(|_| {
                let path = dir.path().to_path_buf();
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    encrypt_secret(&path, "concurrent secret").unwrap()
                })
            })
            .collect();
        for thread in threads {
            let ciphertext = thread.join().unwrap();
            assert_eq!(
                decrypt_secret(dir.path(), &ciphertext).unwrap(),
                "concurrent secret"
            );
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(fs::read(key_path(dir.path())).unwrap().len(), 32);
    }

    #[test]
    fn wrong_key_and_tampered_ciphertext_do_not_modify_key() {
        let dir = tempfile::tempdir().unwrap();
        let ciphertext = encrypt_secret(dir.path(), "secret").unwrap();
        let wrong_key = [17_u8; 32];
        fs::write(key_path(dir.path()), wrong_key).unwrap();
        assert!(decrypt_secret(dir.path(), &ciphertext).is_err());
        assert_eq!(fs::read(key_path(dir.path())).unwrap(), wrong_key);
        assert!(decrypt_secret(dir.path(), "be1:AA==").is_err());
        assert_eq!(fs::read(key_path(dir.path())).unwrap(), wrong_key);
    }

    #[test]
    fn legacy_and_empty_values_do_not_create_a_key() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(decrypt_secret(dir.path(), "legacy").unwrap(), "legacy");
        assert_eq!(decrypt_secret(dir.path(), "").unwrap(), "");
        assert_eq!(encrypt_secret(dir.path(), "").unwrap(), "");
        assert!(!key_path(dir.path()).exists());
    }

    #[cfg(unix)]
    #[test]
    fn key_is_published_with_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        encrypt_secret(dir.path(), "secret").unwrap();
        let mode = fs::metadata(key_path(dir.path()))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
