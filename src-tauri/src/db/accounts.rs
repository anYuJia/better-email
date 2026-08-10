use super::folders::create_default_folders_for_account;
use super::messages::bool_to_int;
use super::*;

impl MailStore {
    pub fn list_accounts(&self) -> MailResult<Vec<Account>> {
        self.with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, cross_account_risk_warning, block_external_mailboxes, intercept_https_links, auto_download_attachments, is_default
                 FROM accounts ORDER BY is_default DESC, id",
            )?;
            let accounts = stmt
                .query_map([], map_account)?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(accounts)
        })
    }
    pub fn get_account(&self) -> MailResult<Account> {
        self.get_account_by_id(None)
    }
    pub fn get_account_by_id(&self, account_id: Option<i64>) -> MailResult<Account> {
        self.with_conn(|conn| account_for_conn(conn, account_id))
    }
    pub fn get_account_by_id_optional(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Option<Account>> {
        self.with_conn(|conn| account_for_conn_optional(conn, account_id))
    }
    pub fn get_account_secret_raw(&self, account: &Account) -> MailResult<String> {
        // 凭据只保存在应用自己的 SQLite 数据库（app 数据目录，0600 权限），
        // 不再使用系统凭据库，避免 macOS 弹出 Keychain 授权提示。
        self.with_conn(|conn| account_secret_raw_for_conn(conn, account))
    }
    pub fn get_account_secret(
        &self,
        account: &Account,
    ) -> MailResult<crate::credentials::AccountSecret> {
        let raw = self.get_account_secret_raw(account)?;
        let secret = crate::credentials::account_secret_from_raw(&account.auth_type, &raw)
            .map_err(MailError::Imap)?;
        let crate::credentials::AccountSecret::OAuth2(bundle) = &secret else {
            return Ok(secret);
        };
        if !crate::oauth::token_needs_refresh(bundle) {
            return Ok(secret);
        }
        let refreshed = crate::oauth::refresh_token(bundle, "", "").map_err(MailError::Imap)?;
        let serialized = serde_json::to_string(&refreshed)
            .map_err(|error| MailError::Imap(format!("OAuth2 token 序列化失败：{error}")))?;
        let status = self.store_account_secret(&account.email, &serialized)?;
        if !status.exists {
            return Err(MailError::Imap(status.message));
        }
        Ok(crate::credentials::AccountSecret::OAuth2(refreshed))
    }
    pub fn store_account_secret(
        &self,
        account_email: &str,
        secret: &str,
    ) -> MailResult<CredentialStatus> {
        let email = account_email.trim().to_ascii_lowercase();
        let secret = secret.trim().to_string();
        if email.is_empty() {
            return Ok(CredentialStatus {
                account_email: email,
                exists: false,
                status: "invalid_input".to_string(),
                message: "账号邮箱不能为空。".to_string(),
            });
        }
        if secret.is_empty() {
            return Ok(CredentialStatus {
                account_email: email,
                exists: false,
                status: "invalid_input".to_string(),
                message: "授权码不能为空。".to_string(),
            });
        }
        // 凭据只写入应用自己的 SQLite 数据库，不触碰系统凭据库，
        // 保证任何路径（启动、设置页、查看邮件、同步、发送）都不会
        // 触发 macOS Keychain 访问或授权提示。
        self.with_conn(|conn| {
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "
                INSERT INTO account_credentials(account_email, secret, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(account_email) DO UPDATE
                SET secret = excluded.secret,
                    updated_at = excluded.updated_at
                ",
                params![email, secret, now],
            )?;
            Ok(())
        })?;
        Ok(CredentialStatus {
            account_email: email,
            exists: true,
            status: "exists".to_string(),
            message: "授权码已保存到本地应用数据库（仅本机，数据库权限 0600）。".to_string(),
        })
    }
    pub fn check_account_secret(&self, account_email: &str) -> MailResult<CredentialStatus> {
        let email = account_email.trim().to_ascii_lowercase();
        let exists = self.with_conn(|conn| {
            Ok(conn
                .query_row(
                    "SELECT length(secret) > 0 FROM account_credentials WHERE account_email = ?1",
                    params![email],
                    |row| row.get::<_, bool>(0),
                )
                .optional()?
                .unwrap_or(false))
        })?;
        Ok(CredentialStatus {
            account_email: email,
            exists,
            status: if exists {
                "exists".to_string()
            } else {
                "not_found".to_string()
            },
            message: if exists {
                "本地应用数据库中已保存该账号授权码。".to_string()
            } else {
                "未保存该账号授权码。".to_string()
            },
        })
    }
    pub fn delete_account_secret(&self, account_email: &str) -> MailResult<CredentialStatus> {
        let email = account_email.trim().to_ascii_lowercase();
        let rows_affected = self.with_conn(|conn| {
            Ok(conn.execute(
                "DELETE FROM account_credentials WHERE account_email = ?1",
                params![email],
            )?)
        })?;
        if rows_affected == 0 {
            Ok(CredentialStatus {
                account_email: email,
                exists: false,
                status: "not_found".to_string(),
                message: "本地凭据中未找到对应凭据。".to_string(),
            })
        } else {
            Ok(CredentialStatus {
                account_email: email,
                exists: false,
                status: "deleted".to_string(),
                message: "本地凭据已删除。".to_string(),
            })
        }
    }
    pub fn create_account(&self, input: AccountCreateInput) -> MailResult<Account> {
        self.with_conn(|conn| {
            let email = input.email.trim().to_lowercase();
            db_info(format!(
                "[better-email][db] create_account start email={} provider={} protocol={} imap_host={} smtp_host={}",
                mask_email_for_log(&email),
                input.provider.trim(),
                normalize_incoming_protocol(&input.incoming_protocol),
                input.imap_host.trim(),
                input.smtp_host.trim(),
            ));
            if email.is_empty() || !email.contains('@') {
                eprintln!("[better-email][db] create_account invalid email");
                return Err(MailError::Imap("请输入有效邮箱地址。".to_string()));
            }
            let display_name = if input.display_name.trim().is_empty() {
                email.clone()
            } else {
                input.display_name.trim().to_string()
            };
            let is_default =
                conn.query_row("SELECT COUNT(*) = 0 FROM accounts", [], |row| row.get::<_, bool>(0))?;
            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO accounts(email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, cross_account_risk_warning, block_external_mailboxes, intercept_https_links, auto_download_attachments, is_default, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    email,
                    display_name,
                    input.provider.trim(),
                    input.imap_host.trim(),
                    input.smtp_host.trim(),
                    normalize_incoming_protocol(&input.incoming_protocol),
                    normalize_auth_type(&input.auth_type),
                    normalize_sync_mode(&input.sync_mode),
                    bool_to_int(input.remote_images_allowed),
                    input.signature,
                    bool_to_int(input.cross_account_risk_warning),
                    bool_to_int(input.block_external_mailboxes),
                    bool_to_int(input.intercept_https_links),
                    bool_to_int(input.auto_download_attachments),
                    bool_to_int(is_default),
                    now
                ],
            )
            .map_err(|error| {
                if is_unique_constraint_error(&error) {
                    eprintln!(
                        "[better-email][db] create_account duplicate email={}",
                        mask_email_for_log(&email),
                    );
                    MailError::Imap("该邮箱账号已存在。".to_string())
                } else {
                    eprintln!("[better-email][db] create_account insert failed error={error}");
                    MailError::Database(error)
                }
            })?;
            let account_id = conn.last_insert_rowid();
            create_default_folders_for_account(conn, account_id)?;
            ensure_default_identity_for_account_conn(
                conn,
                account_id,
                &display_name,
                &email,
                &input.signature,
            )?;
            let account = account_for_conn(conn, Some(account_id))?;
            db_info(format!(
                "[better-email][db] create_account ok account_id={} email={} default={}",
                account.id,
                mask_email_for_log(&account.email),
                account.is_default,
            ));
            Ok(account)
        })
    }
    pub fn set_default_account(&self, account_id: i64) -> MailResult<Account> {
        self.with_conn(|conn| {
            let transaction = conn.unchecked_transaction()?;
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM accounts WHERE id = ?1",
                    params![account_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(MailError::Imap("邮箱账号不存在或已被移除。".to_string()));
            }
            transaction.execute("UPDATE accounts SET is_default = 0", [])?;
            transaction.execute(
                "UPDATE accounts SET is_default = 1 WHERE id = ?1",
                params![account_id],
            )?;
            let account = account_for_conn(&transaction, Some(account_id))?;
            transaction.commit()?;
            Ok(account)
        })
    }
    pub fn delete_account(&self, account_id: i64) -> MailResult<Option<Account>> {
        self.remove_account(account_id, true)
    }
    pub fn remove_account(
        &self,
        account_id: i64,
        delete_credentials: bool,
    ) -> MailResult<Option<Account>> {
        self.with_conn(|conn| {
            db_info(format!(
                "[better-email][db] remove_account start account_id={account_id} delete_credentials={delete_credentials}"
            ));
            let transaction = conn.unchecked_transaction()?;
            let account_email = transaction
                .query_row(
                    "SELECT email FROM accounts WHERE id = ?1",
                    params![account_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(account_email) = account_email else {
                eprintln!("[better-email][db] remove_account missing account_id={account_id}");
                return Err(MailError::Imap("邮箱账号不存在或已被移除。".to_string()));
            };

            if delete_credentials {
                transaction.execute(
                    "DELETE FROM account_credentials WHERE account_email = ?1",
                    params![account_email],
                )?;
            }
            transaction.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])?;
            ensure_default_account_for_conn(&transaction)?;
            let next_account = account_for_conn_optional(&transaction, None)?;
            transaction.commit()?;
            db_info(format!(
                "[better-email][db] remove_account ok removed_account_id={} next_account_id={} credentials_deleted={}",
                account_id,
                next_account
                    .as_ref()
                    .map(|account| account.id)
                    .unwrap_or_default(),
                delete_credentials,
            ));
            Ok(next_account)
        })
    }
    pub fn update_account_settings_for(
        &self,
        account_id: Option<i64>,
        input: AccountSettingsInput,
    ) -> MailResult<Account> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            conn.execute(
                "UPDATE accounts
                 SET display_name = ?1, provider = ?2, imap_host = ?3, smtp_host = ?4,
                     incoming_protocol = ?5, auth_type = ?6, sync_mode = ?7, remote_images_allowed = ?8, signature = ?9,
                     cross_account_risk_warning = ?11, block_external_mailboxes = ?12, intercept_https_links = ?13,
                     auto_download_attachments = ?14
                 WHERE id = ?10",
                params![
                    input.display_name.trim(),
                    input.provider.trim(),
                    input.imap_host.trim(),
                    input.smtp_host.trim(),
                    normalize_incoming_protocol(&input.incoming_protocol),
                    normalize_auth_type(&input.auth_type),
                    normalize_sync_mode(&input.sync_mode),
                    bool_to_int(input.remote_images_allowed),
                    input.signature,
                    account.id,
                    bool_to_int(input.cross_account_risk_warning),
                    bool_to_int(input.block_external_mailboxes),
                    bool_to_int(input.intercept_https_links),
                    bool_to_int(input.auto_download_attachments)
                ],
            )?;
            upsert_account_default_identity_conn(
                conn,
                account.id,
                input.display_name.trim(),
                &account.email,
                &input.signature,
            )?;
            account_for_conn(conn, Some(account.id))
        })
    }
    pub fn list_identities_for_account(
        &self,
        account_id: Option<i64>,
    ) -> MailResult<Vec<MailIdentity>> {
        self.with_conn(|conn| {
            let account = account_for_conn(conn, account_id)?;
            identities_for_account_conn(conn, account.id)
        })
    }
    pub fn upsert_identity(&self, input: MailIdentityInput) -> MailResult<MailIdentity> {
        self.with_conn(|conn| {
            let account =
                account_for_conn(conn, (input.account_id > 0).then_some(input.account_id))?;
            upsert_identity_conn(conn, &account, input)
        })
    }
    pub fn delete_identity(&self, identity_id: i64) -> MailResult<()> {
        self.with_conn(|conn| {
            let is_default: i64 = conn.query_row(
                "SELECT is_default FROM mail_identities WHERE id = ?1",
                params![identity_id],
                |row| row.get(0),
            )?;
            if is_default != 0 {
                return Err(MailError::Imap("默认发件身份不能删除。".to_string()));
            }
            conn.execute(
                "DELETE FROM mail_identities WHERE id = ?1",
                params![identity_id],
            )?;
            Ok(())
        })
    }
}

pub(super) fn account_secret_raw_for_conn(
    conn: &Connection,
    account: &Account,
) -> MailResult<String> {
    let raw = conn
        .query_row(
            "SELECT secret FROM account_credentials WHERE account_email = ?1",
            params![account.email.trim().to_ascii_lowercase()],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    raw.filter(|secret| !secret.trim().is_empty())
        .ok_or_else(|| MailError::Imap("未保存该账号授权码。".to_string()))
}
pub(super) fn normalize_auth_type(auth_type: &str) -> &str {
    match auth_type.trim() {
        "oauth2" => "oauth2",
        _ => "password",
    }
}
pub(super) fn normalize_incoming_protocol(incoming_protocol: &str) -> &str {
    match incoming_protocol.trim().to_ascii_lowercase().as_str() {
        "pop3" => "pop3",
        _ => "imap",
    }
}
pub(super) fn normalize_sync_mode(sync_mode: &str) -> &str {
    match sync_mode.trim() {
        "1min" => "1min",
        "5min" => "5min",
        "15min" => "15min",
        "30min" => "30min",
        "60min" => "60min",
        "push" => "5min",
        _ => "manual",
    }
}
pub(super) fn is_unique_constraint_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || code.code == rusqlite::ErrorCode::ConstraintViolation
    )
}
pub(super) fn map_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        email: row.get(1)?,
        display_name: row.get(2)?,
        provider: row.get(3)?,
        imap_host: row.get(4)?,
        smtp_host: row.get(5)?,
        incoming_protocol: row.get(6)?,
        auth_type: row.get(7)?,
        sync_mode: row.get(8)?,
        remote_images_allowed: row.get::<_, i64>(9)? != 0,
        signature: row.get(10)?,
        cross_account_risk_warning: row.get::<_, i64>(11)? != 0,
        block_external_mailboxes: row.get::<_, i64>(12)? != 0,
        intercept_https_links: row.get::<_, i64>(13)? != 0,
        auto_download_attachments: row.get::<_, i64>(14)? != 0,
        is_default: row.get::<_, i64>(15)? != 0,
    })
}
pub(super) fn normalize_identity_email(value: &str) -> MailResult<String> {
    let email = value.trim().to_ascii_lowercase();
    if email.is_empty() || !email.contains('@') || email.ends_with('@') {
        return Err(MailError::Imap("请输入有效发件身份邮箱。".to_string()));
    }
    Ok(email)
}
pub(super) fn map_mail_identity(row: &rusqlite::Row<'_>) -> rusqlite::Result<MailIdentity> {
    Ok(MailIdentity {
        id: row.get(0)?,
        account_id: row.get(1)?,
        name: row.get(2)?,
        email: row.get(3)?,
        reply_to: row.get(4)?,
        signature: row.get(5)?,
        is_default: row.get::<_, i64>(6)? != 0,
    })
}
pub(super) fn identities_for_account_conn(
    conn: &Connection,
    account_id: i64,
) -> MailResult<Vec<MailIdentity>> {
    ensure_default_identity_for_account_from_db_conn(conn, account_id)?;
    let mut stmt = conn.prepare(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE account_id = ?1
        ORDER BY is_default DESC, id ASC
        ",
    )?;
    let identities = stmt
        .query_map(params![account_id], map_mail_identity)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(identities)
}
pub(super) fn ensure_default_identities_for_conn(conn: &Connection) -> MailResult<()> {
    let mut stmt = conn.prepare("SELECT id FROM accounts ORDER BY id")?;
    let account_ids = stmt
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);
    for account_id in account_ids {
        ensure_default_identity_for_account_from_db_conn(conn, account_id)?;
    }
    Ok(())
}
pub(super) fn ensure_default_identity_for_account_from_db_conn(
    conn: &Connection,
    account_id: i64,
) -> MailResult<()> {
    let account = account_for_conn(conn, Some(account_id))?;
    ensure_default_identity_for_account_conn(
        conn,
        account.id,
        &account.display_name,
        &account.email,
        &account.signature,
    )
}
pub(super) fn ensure_default_identity_for_account_conn(
    conn: &Connection,
    account_id: i64,
    name: &str,
    email: &str,
    signature: &str,
) -> MailResult<()> {
    let email = normalize_identity_email(email)?;
    let name = if name.trim().is_empty() {
        email.clone()
    } else {
        name.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "
        INSERT OR IGNORE INTO mail_identities(account_id, name, email, reply_to, signature, is_default, created_at)
        VALUES (?1, ?2, ?3, '', ?4, 1, ?5)
        ",
        params![account_id, name, email, signature, now],
    )?;
    let default_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM mail_identities WHERE account_id = ?1 AND is_default = 1",
        params![account_id],
        |row| row.get(0),
    )?;
    if default_count == 0 {
        conn.execute(
            "
            UPDATE mail_identities
            SET is_default = 1
            WHERE id = (
                SELECT id FROM mail_identities WHERE account_id = ?1 ORDER BY id ASC LIMIT 1
            )
            ",
            params![account_id],
        )?;
    }
    Ok(())
}
pub(super) fn upsert_account_default_identity_conn(
    conn: &Connection,
    account_id: i64,
    name: &str,
    email: &str,
    signature: &str,
) -> MailResult<()> {
    let email = normalize_identity_email(email)?;
    ensure_default_identity_for_account_conn(conn, account_id, name, &email, signature)?;
    conn.execute(
        "UPDATE mail_identities SET is_default = 0 WHERE account_id = ?1",
        params![account_id],
    )?;
    conn.execute(
        "
        UPDATE mail_identities
        SET name = ?1, signature = ?2, is_default = 1
        WHERE account_id = ?3 AND email = ?4
        ",
        params![name.trim(), signature, account_id, email],
    )?;
    Ok(())
}
pub(super) fn upsert_identity_conn(
    conn: &Connection,
    account: &Account,
    input: MailIdentityInput,
) -> MailResult<MailIdentity> {
    let email = normalize_identity_email(&input.email)?;
    let name = if input.name.trim().is_empty() {
        email.clone()
    } else {
        input.name.trim().to_string()
    };
    let now = Utc::now().to_rfc3339();
    if input.is_default {
        conn.execute(
            "UPDATE mail_identities SET is_default = 0 WHERE account_id = ?1",
            params![account.id],
        )?;
    }
    if input.id > 0 {
        conn.execute(
            "
            UPDATE mail_identities
            SET name = ?1, email = ?2, reply_to = ?3, signature = ?4, is_default = ?5
            WHERE id = ?6 AND account_id = ?7
            ",
            params![
                name,
                email,
                input.reply_to.trim(),
                input.signature,
                bool_to_int(input.is_default),
                input.id,
                account.id
            ],
        )?;
        return identity_for_id_conn(conn, input.id);
    }
    conn.execute(
        "
        INSERT INTO mail_identities(account_id, name, email, reply_to, signature, is_default, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(account_id, email) DO UPDATE SET
          name = excluded.name,
          reply_to = excluded.reply_to,
          signature = excluded.signature,
          is_default = excluded.is_default
        ",
        params![
            account.id,
            name,
            email,
            input.reply_to.trim(),
            input.signature,
            bool_to_int(input.is_default),
            now
        ],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM mail_identities WHERE account_id = ?1 AND email = ?2",
        params![account.id, normalize_identity_email(&input.email)?],
        |row| row.get(0),
    )?;
    if input.is_default {
        conn.execute(
            "UPDATE mail_identities SET is_default = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE account_id = ?2",
            params![id, account.id],
        )?;
    }
    identity_for_id_conn(conn, id)
}
pub(super) fn identity_for_id_conn(conn: &Connection, id: i64) -> MailResult<MailIdentity> {
    conn.query_row(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE id = ?1
        ",
        params![id],
        map_mail_identity,
    )
    .map_err(Into::into)
}
pub(super) fn identity_for_draft_conn(
    conn: &Connection,
    account: &Account,
    identity_id: i64,
) -> MailResult<MailIdentity> {
    ensure_default_identity_for_account_from_db_conn(conn, account.id)?;
    if identity_id > 0 {
        return conn
            .query_row(
                "
                SELECT id, account_id, name, email, reply_to, signature, is_default
                FROM mail_identities
                WHERE id = ?1 AND account_id = ?2
                ",
                params![identity_id, account.id],
                map_mail_identity,
            )
            .map_err(Into::into);
    }
    conn.query_row(
        "
        SELECT id, account_id, name, email, reply_to, signature, is_default
        FROM mail_identities
        WHERE account_id = ?1
        ORDER BY is_default DESC, id ASC
        LIMIT 1
        ",
        params![account.id],
        map_mail_identity,
    )
    .map_err(Into::into)
}
pub(super) fn account_for_conn(conn: &Connection, account_id: Option<i64>) -> MailResult<Account> {
    account_for_conn_optional(conn, account_id)?
        .ok_or_else(|| MailError::Imap("没有可用邮箱账号。".to_string()))
}
pub(super) fn account_for_conn_optional(
    conn: &Connection,
    account_id: Option<i64>,
) -> MailResult<Option<Account>> {
    if let Some(account_id) = account_id {
        return conn
            .query_row(
                "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, cross_account_risk_warning, block_external_mailboxes, intercept_https_links, auto_download_attachments, is_default
                 FROM accounts WHERE id = ?1",
                params![account_id],
                map_account,
            )
            .optional()
            .map_err(Into::into);
    }

    conn.query_row(
        "SELECT id, email, display_name, provider, imap_host, smtp_host, incoming_protocol, auth_type, sync_mode, remote_images_allowed, signature, cross_account_risk_warning, block_external_mailboxes, intercept_https_links, auto_download_attachments, is_default
         FROM accounts ORDER BY is_default DESC, id LIMIT 1",
        [],
        map_account,
    )
    .optional()
    .map_err(Into::into)
}
pub(super) fn ensure_default_account_for_conn(conn: &Connection) -> MailResult<()> {
    let preferred_account_id = conn
        .query_row(
            "SELECT id FROM accounts ORDER BY is_default DESC, id LIMIT 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?;
    let Some(preferred_account_id) = preferred_account_id else {
        return Ok(());
    };
    conn.execute("UPDATE accounts SET is_default = 0", [])?;
    conn.execute(
        "UPDATE accounts SET is_default = 1 WHERE id = ?1",
        params![preferred_account_id],
    )?;
    Ok(())
}
