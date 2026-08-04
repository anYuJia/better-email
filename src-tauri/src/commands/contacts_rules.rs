use super::common::MAX_VCARD_IMPORT_BYTES;
use crate::db::{MailResult, MailStore};
use crate::models::{
    Contact, ContactCreateInput, ContactExportSummary, ContactImportSummary, ContactInput,
    ContactMergeSuggestion, MailRule, MailRuleInput,
};
use crate::vcard;
use chrono::Utc;
use std::fs;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
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
pub fn export_contacts_vcard(
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

#[tauri::command]
pub fn import_contacts_vcard(
    app: AppHandle,
    store: State<'_, MailStore>,
) -> MailResult<Option<ContactImportSummary>> {
    let Some(source_path) = app
        .dialog()
        .file()
        .set_title("导入联系人 vCard")
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
            "vCard 文件为空，无法导入。".to_string(),
        ));
    }
    if payload.len() > MAX_VCARD_IMPORT_BYTES {
        return Err(crate::db::MailError::Imap(format!(
            "vCard 文件超过 {} MB 导入上限。",
            MAX_VCARD_IMPORT_BYTES / 1024 / 1024
        )));
    }
    let raw = String::from_utf8(payload.clone())
        .map_err(|_| crate::db::MailError::Imap("vCard 文件不是有效的 UTF-8 文本。".to_string()))?;
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
        size_bytes: payload.len().min(i64::MAX as usize) as i64,
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
