use super::common::{command_info, mask_email};
use crate::db::{MailResult, MailStore};
use crate::models::{
    Account, AccountCreateInput, AccountSettingsInput, CredentialInput, CredentialStatus, Folder,
    Label, MailIdentity, MailIdentityInput,
};
use tauri::State;
#[tauri::command]
pub fn list_accounts(store: State<'_, MailStore>) -> MailResult<Vec<Account>> {
    store.list_accounts()
}

#[tauri::command]
pub fn get_account(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Option<Account>> {
    store.get_account_by_id_optional(account_id)
}

#[tauri::command]
pub async fn create_account(
    store: State<'_, MailStore>,
    input: AccountCreateInput,
) -> MailResult<Account> {
    command_info(format!(
        "[better-email][account] create command start email={} provider={} protocol={} imap_host={} smtp_host={}",
        mask_email(&input.email),
        input.provider.trim(),
        input.incoming_protocol.trim(),
        input.imap_host.trim(),
        input.smtp_host.trim(),
    ));
    match store.create_account(input) {
        Ok(account) => {
            command_info(format!(
                "[better-email][account] create command ok account_id={} email={} default={}",
                account.id,
                mask_email(&account.email),
                account.is_default,
            ));
            Ok(account)
        }
        Err(error) => {
            eprintln!("[better-email][account] create command failed error={error}");
            Err(error)
        }
    }
}

#[tauri::command]
pub fn set_default_account(store: State<'_, MailStore>, account_id: i64) -> MailResult<Account> {
    store.set_default_account(account_id)
}

#[tauri::command]
pub async fn delete_account(
    store: State<'_, MailStore>,
    account_id: i64,
) -> MailResult<Option<Account>> {
    command_info(format!(
        "[better-email][account] delete command start account_id={account_id}"
    ));
    match store.delete_account(account_id) {
        Ok(next_account) => {
            command_info(format!(
                "[better-email][account] delete command ok removed_account_id={} next_account_id={}",
                account_id,
                next_account.as_ref().map(|account| account.id).unwrap_or_default(),
            ));
            Ok(next_account)
        }
        Err(error) => {
            eprintln!(
                "[better-email][account] delete command failed account_id={} error={error}",
                account_id,
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn remove_account(
    store: State<'_, MailStore>,
    account_id: i64,
    delete_credentials: bool,
) -> MailResult<Option<Account>> {
    command_info(format!(
        "[better-email][account] remove command start account_id={account_id} delete_credentials={delete_credentials}"
    ));
    match store.remove_account(account_id, delete_credentials) {
        Ok(next_account) => {
            command_info(format!(
                "[better-email][account] remove command ok removed_account_id={} next_account_id={} credentials_deleted={}",
                account_id,
                next_account.as_ref().map(|account| account.id).unwrap_or_default(),
                delete_credentials,
            ));
            Ok(next_account)
        }
        Err(error) => {
            eprintln!(
                "[better-email][account] remove command failed account_id={account_id} error={error}",
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn update_account_settings(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    input: AccountSettingsInput,
) -> MailResult<Account> {
    command_info(format!(
        "[better-email][account] update settings start account_id={account_id:?} provider={} protocol={} sync_mode={}",
        input.provider.trim(),
        input.incoming_protocol.trim(),
        input.sync_mode.trim(),
    ));
    match store.update_account_settings_for(account_id, input) {
        Ok(account) => {
            command_info(format!(
                "[better-email][account] update settings ok account_id={} email={} sync_mode={}",
                account.id,
                mask_email(&account.email),
                account.sync_mode,
            ));
            Ok(account)
        }
        Err(error) => {
            eprintln!(
                "[better-email][account] update settings failed account_id={account_id:?} error={error}"
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn list_folders(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<Folder>> {
    store.list_folders_for_account(account_id)
}

#[tauri::command]
pub fn create_custom_folder(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    name: String,
) -> MailResult<Folder> {
    store.create_custom_folder(account_id, name)
}

#[tauri::command]
pub fn rename_custom_folder(
    store: State<'_, MailStore>,
    folder_id: i64,
    name: String,
) -> MailResult<Folder> {
    store.rename_custom_folder(folder_id, name)
}

#[tauri::command]
pub fn delete_custom_folder(store: State<'_, MailStore>, folder_id: i64) -> MailResult<()> {
    store.delete_custom_folder(folder_id)
}

#[tauri::command]
pub fn list_labels(store: State<'_, MailStore>) -> MailResult<Vec<Label>> {
    store.list_labels()
}

#[tauri::command]
pub fn create_label(store: State<'_, MailStore>, name: String, color: String) -> MailResult<Label> {
    store.create_label(&name, &color)
}

#[tauri::command]
pub fn update_label(
    store: State<'_, MailStore>,
    id: i64,
    name: String,
    color: String,
) -> MailResult<()> {
    store.update_label(id, &name, &color)
}

#[tauri::command]
pub fn delete_label(store: State<'_, MailStore>, id: i64) -> MailResult<()> {
    store.delete_label(id)
}

#[tauri::command]
pub fn list_identities(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
) -> MailResult<Vec<MailIdentity>> {
    store.list_identities_for_account(account_id)
}

#[tauri::command]
pub fn upsert_identity(
    store: State<'_, MailStore>,
    input: MailIdentityInput,
) -> MailResult<MailIdentity> {
    store.upsert_identity(input)
}

#[tauri::command]
pub fn delete_identity(store: State<'_, MailStore>, identity_id: i64) -> MailResult<()> {
    store.delete_identity(identity_id)
}

#[tauri::command]
pub fn store_account_secret(
    store: State<'_, MailStore>,
    input: CredentialInput,
) -> CredentialStatus {
    command_info(format!(
        "[better-email][credential] store start email={} has_secret={}",
        mask_email(&input.account_email),
        !input.secret.trim().is_empty(),
    ));
    let status = match store.store_account_secret(&input.account_email, &input.secret) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: input.account_email.trim().to_ascii_lowercase(),
            exists: false,
            status: "failed".to_string(),
            message: error.to_string(),
        },
    };
    command_info(format!(
        "[better-email][credential] store done email={} exists={} message={}",
        mask_email(&input.account_email),
        status.exists,
        status.message,
    ));
    status
}

#[tauri::command]
pub fn check_account_secret(
    store: State<'_, MailStore>,
    account_email: String,
) -> CredentialStatus {
    match store.check_account_secret(&account_email) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: account_email.trim().to_ascii_lowercase(),
            exists: false,
            status: "failed".to_string(),
            message: error.to_string(),
        },
    }
}

#[tauri::command]
pub fn delete_account_secret(
    store: State<'_, MailStore>,
    account_email: String,
) -> CredentialStatus {
    command_info(format!(
        "[better-email][credential] delete start email={}",
        mask_email(&account_email),
    ));
    let status = match store.delete_account_secret(&account_email) {
        Ok(status) => status,
        Err(error) => CredentialStatus {
            account_email: account_email.trim().to_ascii_lowercase(),
            exists: false,
            status: "failed".to_string(),
            message: error.to_string(),
        },
    };
    command_info(format!(
        "[better-email][credential] delete done email={} exists={} message={}",
        mask_email(&account_email),
        status.exists,
        status.message,
    ));
    status
}
