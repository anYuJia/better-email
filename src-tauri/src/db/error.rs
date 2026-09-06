use thiserror::Error;

#[derive(Debug, Error)]
pub enum MailError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),
    #[error("application data directory is unavailable")]
    MissingDataDir,
    #[error("database connection lock is unavailable")]
    DatabaseLockPoisoned,
    #[error("folder role not found: {0}")]
    MissingFolderRole(String),
    #[error("{0}")]
    Smtp(String),
    #[error("{0}")]
    SmtpPermanent(String),
    #[error("[SEND_OUTCOME_UNKNOWN] {0}")]
    SmtpOutcomeUnknown(String),
    #[error("{0}")]
    Imap(String),
    /// 系统对话框被用户取消（另存为/选择文件等）：不是失败，调用方应保持现状。
    #[error("操作已取消。")]
    Cancelled,
}

impl serde::Serialize for MailError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type MailResult<T> = Result<T, MailError>;
