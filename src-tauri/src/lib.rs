mod commands;
mod credentials;
mod db;
mod imap_probe;
mod models;
mod oauth;
mod pop3_probe;
mod protocol;
mod provider_probe;
mod smtp;
mod vcard;

use db::MailStore;
pub use provider_probe::{list_provider_probe_accounts, run_provider_probe};
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = MailStore::open(app.handle())?;
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_accounts,
            commands::get_account,
            commands::create_account,
            commands::set_default_account,
            commands::delete_account,
            commands::update_account_settings,
            commands::list_folders,
            commands::create_custom_folder,
            commands::rename_custom_folder,
            commands::delete_custom_folder,
            commands::list_labels,
            commands::create_label,
            commands::update_label,
            commands::delete_label,
            commands::list_messages,
            commands::list_provider_write_validation_messages,
            commands::list_thread_messages,
            commands::set_threads_muted,
            commands::list_muted_thread_keys,
            commands::list_attachments,
            commands::read_attachment_data_url,
            commands::save_image_data_url_as,
            commands::pick_outbound_attachments,
            commands::outbound_attachments_from_paths,
            commands::save_temp_attachment,
            commands::mark_frontend_ready,
            commands::mark_benchmark_sync_complete,
            commands::benchmark_sync_requested,
            commands::list_remote_image_trusts,
            commands::trust_remote_images,
            commands::delete_remote_image_trust,
            commands::render_message_with_remote_image_policy,
            commands::render_message_with_remote_images_once,
            commands::download_attachment,
            commands::open_attachment,
            commands::reveal_attachment_in_finder,
            commands::copy_attachment_file_to_clipboard,
            commands::save_attachment_as,
            commands::export_message_as_eml,
            commands::import_eml_file,
            commands::set_message_read,
            commands::mark_folder_read,
            commands::set_message_starred,
            commands::move_message_to_role,
            commands::restore_message_to_inbox,
            commands::delete_message_permanently,
            commands::empty_trash,
            commands::snooze_message,
            commands::unsnooze_message,
            commands::release_due_snoozed_messages,
            commands::apply_label_to_message,
            commands::remove_label_from_message,
            commands::list_identities,
            commands::upsert_identity,
            commands::delete_identity,
            commands::save_draft,
            commands::send_message,
            commands::queue_outbox_message,
            commands::cancel_outbox_item,
            commands::get_stats,
            commands::export_diagnostics,
            commands::export_local_backup,
            commands::preview_local_backup,
            commands::import_local_backup,
            commands::get_storage_usage,
            commands::clear_attachment_cache,
            commands::test_connection,
            commands::verify_account_credentials,
            commands::verify_account_credentials_with_secret,
            commands::discover_imap_folders,
            commands::list_imap_mailboxes,
            commands::map_imap_mailbox,
            commands::run_sync_dry_run,
            commands::get_sync_schedule_plan,
            commands::sync_imap_headers,
            commands::sync_imap_history,
            commands::fetch_message_body,
            commands::list_sync_runs,
            commands::parse_raw_message,
            commands::store_account_secret,
            commands::check_account_secret,
            commands::delete_account_secret,
            commands::start_oauth2_pkce,
            commands::list_oauth_sessions,
            commands::complete_oauth2_callback,
            commands::wait_for_oauth2_callback,
            commands::exchange_oauth2_token,
            commands::refresh_oauth2_token,
            commands::list_contacts,
            commands::list_contact_merge_suggestions,
            commands::create_contact,
            commands::update_contact,
            commands::delete_contact,
            commands::merge_contacts,
            commands::export_contacts_vcard,
            commands::import_contacts_vcard,
            commands::list_rules,
            commands::upsert_rule,
            commands::set_rule_enabled,
            commands::delete_rule,
            commands::list_threads,
            commands::list_outbox,
            commands::enqueue_background_task,
            commands::list_background_tasks,
            commands::next_background_task,
            commands::mark_background_task_running,
            commands::complete_background_task,
            commands::fail_background_task,
            commands::flush_outbox_dry_run,
            commands::release_due_outbox_items,
            commands::flush_outbox_smtp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Better Email");
}
