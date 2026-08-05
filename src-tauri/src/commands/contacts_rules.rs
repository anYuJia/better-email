use super::common::MAX_VCARD_IMPORT_BYTES;
use crate::db::{MailResult, MailStore};
use crate::models::{
    Contact, ContactCreateInput, ContactExportSummary, ContactImportBatch,
    ContactImportCommitSummary, ContactImportPreview,
    ContactImportSelection, ContactImportSummary, ContactImportUndoReport, ContactInput,
    ContactMergeSuggestion, MailRule, MailRuleInput,
};
use crate::vcard;
use chrono::Utc;
use std::fs;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn pick_contact_import_file(app: AppHandle) -> MailResult<Option<String>> {
    let Some(source_path) = app
        .dialog()
        .file()
        .set_title("导入联系人 vCard 或 CSV")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source_path = source_path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析联系人导入路径：{error}")))?;
    Ok(Some(source_path.to_string_lossy().into_owned()))
}

fn read_contact_file_by_path(path: &str) -> MailResult<(String, String, usize)> {
    let source_path = std::path::PathBuf::from(path);
    let payload = fs::read(&source_path)?;
    if payload.is_empty() {
        return Err(crate::db::MailError::Imap(
            "联系人文件为空，无法导入。".to_string(),
        ));
    }
    if payload.len() > MAX_VCARD_IMPORT_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "联系人文件超过 {} MB 导入上限。",
            MAX_VCARD_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let raw = String::from_utf8(payload.clone())
        .map_err(|_| crate::db::MailError::Imap("联系人文件不是有效的 UTF-8 文本。".to_string()))?;
    let file_name = source_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    Ok((file_name, raw, payload.len()))
}

#[tauri::command]
pub async fn preview_contact_import(
    path: String,
    store: State<'_, MailStore>,
) -> MailResult<ContactImportPreview> {
    let (file_name, raw, _size_bytes) = read_contact_file_by_path(&path)?;
    let parsed = vcard::parse_contact_import(&raw, &file_name);
    let entries = store.classify_contact_import(parsed.contacts)?;
    let mut new_count = 0_i64;
    let mut merge_count = 0_i64;
    let mut duplicate_count = 0_i64;
    let mut invalid_count = 0_i64;
    for entry in &entries {
        match entry.status.as_str() {
            "new" => new_count += 1,
            "merge" => merge_count += 1,
            "duplicate" => duplicate_count += 1,
            _ => invalid_count += 1,
        }
    }
    Ok(ContactImportPreview {
        file_name,
        path,
        format: parsed.format,
        total_count: parsed.total,
        new_count,
        merge_count,
        duplicate_count,
        invalid_count: invalid_count + parsed.skipped,
        entries,
    })
}

#[tauri::command]
pub fn commit_contact_import(
    path: String,
    selections: Vec<ContactImportSelection>,
    scope: Option<String>,
    store: State<'_, MailStore>,
) -> MailResult<ContactImportCommitSummary> {
    let (file_name, raw, _size_bytes) = read_contact_file_by_path(&path)?;
    let parsed = vcard::parse_contact_import(&raw, &file_name);
    let action_by_email: std::collections::HashMap<String, String> = selections
        .into_iter()
        .map(|selection| (selection.email.trim().to_ascii_lowercase(), selection.action))
        .collect();
    let inputs: Vec<(ContactCreateInput, String)> = parsed
        .contacts
        .into_iter()
        .map(|contact| {
            let action = action_by_email
                .get(&contact.email.trim().to_ascii_lowercase())
                .cloned()
                .unwrap_or_else(|| "create".to_string());
            (contact, action)
        })
        .collect();
    store.commit_contact_import(inputs, &file_name, scope.unwrap_or_else(|| "global".to_string()).as_str())
}

#[tauri::command]
pub fn list_contact_import_batches(store: State<'_, MailStore>) -> MailResult<Vec<ContactImportBatch>> {
    store.list_contact_import_batches()
}

#[tauri::command]
pub fn undo_contact_import_batch(
    batch_id: i64,
    store: State<'_, MailStore>,
) -> MailResult<ContactImportUndoReport> {
    store.undo_contact_import_batch(batch_id)
}

#[tauri::command]
pub fn list_contacts(store: State<'_, MailStore>) -> MailResult<Vec<Contact>> {
    store.list_contacts()
}

#[tauri::command]
pub fn list_contact_merge_suggestions(
    store: State<'_, MailStore>,
) -> MailResult<Vec<ContactMergeSuggestion>> {
    store.list_contact_merge_suggestions()
}

#[tauri::command]
pub fn create_contact(
    store: State<'_, MailStore>,
    input: ContactCreateInput,
) -> MailResult<Contact> {
    store.create_contact(input)
}

#[tauri::command]
pub fn update_contact(
    store: State<'_, MailStore>,
    contact_id: i64,
    input: ContactInput,
) -> MailResult<Contact> {
    store.update_contact(contact_id, input)
}

#[tauri::command]
pub fn delete_contact(store: State<'_, MailStore>, contact_id: i64) -> MailResult<()> {
    store.delete_contact(contact_id)
}

#[tauri::command]
pub fn merge_contacts(
    store: State<'_, MailStore>,
    target_contact_id: i64,
    source_contact_id: i64,
) -> MailResult<Contact> {
    store.merge_contacts(target_contact_id, source_contact_id)
}

#[tauri::command]
pub async fn export_contacts_vcard(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<ContactExportSummary>> {
    let contacts = store.list_all_contacts()?;
    let payload = vcard::render_contacts(&contacts);
    let Some(target_path) = app
        .dialog()
        .file()
        .set_title("导出联系人 vCard")
        .set_file_name(format!(
            "better-email-contacts-{}.vcf",
            Utc::now().format("%Y%m%d-%H%M%S")
        ))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let target_path = target_path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析联系人导出路径：{error}")))?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&target_path, payload.as_bytes())?;
    Ok(Some(ContactExportSummary {
        path: target_path.to_string_lossy().into_owned(),
        contacts: contacts.len().min(i64::MAX as usize) as i64,
        size_bytes: payload.len().min(i64::MAX as usize) as i64,
    }))
}

async fn read_contact_import_file(
    app: &AppHandle,
) -> MailResult<Option<(std::path::PathBuf, String, usize)>> {
    let Some(source_path) = app
        .dialog()
        .file()
        .set_title("导入联系人 vCard 或 CSV")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let source_path = source_path
        .into_path()
        .map_err(|error| crate::db::MailError::Imap(format!("无法解析联系人导入路径：{error}")))?;
    let payload = fs::read(&source_path)?;
    if payload.is_empty() {
        return Err(crate::db::MailError::Imap(
            "联系人文件为空，无法导入。".to_string(),
        ));
    }
    if payload.len() > MAX_VCARD_IMPORT_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "联系人文件超过 {} MB 导入上限。",
            MAX_VCARD_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let raw = String::from_utf8(payload.clone())
        .map_err(|_| crate::db::MailError::Imap("联系人文件不是有效的 UTF-8 文本。".to_string()))?;
    Ok(Some((source_path, raw, payload.len())))
}

#[tauri::command]
pub async fn import_contacts_vcard(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<ContactImportSummary>> {
    let Some((source_path, raw, size_bytes)) = read_contact_import_file(&app).await? else {
        return Ok(None);
    };
    let parsed = vcard::parse_contacts(&raw);
    if parsed.contacts.is_empty() {
        return Err(crate::db::MailError::Imap(
            "vCard 中没有可导入的有效邮箱联系人。".to_string(),
        ));
    }
    let (created, updated) = store.import_contacts(parsed.contacts)?;
    Ok(Some(ContactImportSummary {
        path: source_path.to_string_lossy().into_owned(),
        total_cards: parsed.total_cards,
        created,
        updated,
        skipped: parsed.skipped,
        size_bytes: size_bytes.min(i64::MAX as usize) as i64,
    }))
}

#[tauri::command]
pub fn list_rules(store: State<'_, MailStore>) -> MailResult<Vec<MailRule>> {
    store.list_rules()
}

#[tauri::command]
pub fn upsert_rule(
    store: State<'_, MailStore>,
    rule_id: Option<i64>,
    input: MailRuleInput,
) -> MailResult<MailRule> {
    store.upsert_rule(rule_id, input)
}

#[tauri::command]
pub fn set_rule_enabled(
    store: State<'_, MailStore>,
    rule_id: i64,
    enabled: bool,
) -> MailResult<MailRule> {
    store.set_rule_enabled(rule_id, enabled)
}

#[tauri::command]
pub fn delete_rule(store: State<'_, MailStore>, rule_id: i64) -> MailResult<()> {
    store.delete_rule(rule_id)
}
