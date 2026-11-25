use crate::db::{MailError, MailResult, MailStore};
use crate::models::DraftInput;
use tauri::State;

#[tauri::command]
pub async fn load_composer_recovery(
    store: State<'_, MailStore>,
    account_id: Option<i64>,
    draft_id: Option<i64>,
) -> MailResult<serde_json::Value> {
    let store = store.inner().clone();
    super::executor::database(move || store.load_composer_recovery(account_id, draft_id)).await
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
        let owner = value["recovery_account_id"]
            .as_i64()
            .unwrap_or(draft.account_id);
        if owner != draft.account_id {
            store.get_account_by_id(Some(owner))?;
        }
        store.write_composer_recovery(
            owner,
            draft.draft_id,
            value["recovery_id"].as_str().unwrap_or(""),
            revision,
            &payload_json,
        )
    })
    .await
    .map_err(|error| MailError::Io(std::io::Error::other(error.to_string())))?
}

#[tauri::command]
pub async fn clear_composer_recovery(
    store: State<'_, MailStore>,
    account_id: i64,
    draft_id: i64,
    recovery_id: String,
    revision: i64,
) -> MailResult<bool> {
    let store = store.inner().clone();
    super::executor::database(move || {
        let cleared =
            store.write_composer_recovery(account_id, draft_id, &recovery_id, revision, "null")?;
        if cleared {
            let _ = store.prune_temp_attachments(std::time::Duration::ZERO);
        }
        Ok(cleared)
    })
    .await
}
