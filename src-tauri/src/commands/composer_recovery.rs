use crate::db::{MailError, MailResult, MailStore};
use crate::models::DraftInput;
use tauri::State;

#[tauri::command]
pub fn load_composer_recovery(store: State<'_, MailStore>) -> MailResult<serde_json::Value> {
    store.load_composer_recovery()
}

#[tauri::command]
pub async fn save_composer_recovery(
    store: State<'_, MailStore>,
    payload_json: String,
    revision: i64,
) -> MailResult<bool> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if payload_json.len() > 32 * 1024 * 1024 {
            return Err(MailError::Imap(
                "恢复点超过 32 MiB，请手动保存草稿。".into(),
            ));
        }
        let value: serde_json::Value = serde_json::from_str(&payload_json)
            .map_err(|error| MailError::Io(std::io::Error::other(error)))?;
        let draft: DraftInput = serde_json::from_value(value["draft"].clone())
            .map_err(|error| MailError::Io(std::io::Error::other(error)))?;
        super::attachments::validate_outbound_attachment_inputs(&store, &draft.attachments)?;
        store.get_account_by_id(Some(draft.account_id).filter(|id| *id > 0))?;
        store.write_composer_recovery(revision, &payload_json)
    })
    .await
    .map_err(|error| MailError::Io(std::io::Error::other(error.to_string())))?
}

#[tauri::command]
pub fn clear_composer_recovery(store: State<'_, MailStore>, revision: i64) -> MailResult<bool> {
    let cleared = store.write_composer_recovery(revision, "null")?;
    if cleared {
        let _ = store.prune_temp_attachments(std::time::Duration::ZERO);
    }
    Ok(cleared)
}
