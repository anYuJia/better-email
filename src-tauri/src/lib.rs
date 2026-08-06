mod commands;
mod credentials;
mod db;
mod ai;
mod imap_probe;
mod mime;
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
use tauri::Emitter;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Wry;

pub struct TrayState {
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
    pub unread_item: Mutex<Option<MenuItem<Wry>>>,
    pub is_quitting: AtomicBool,
}

#[tauri::command]
fn set_tray_unread_count(
    unread_count: u64,
    state: tauri::State<'_, TrayState>,
) -> Result<(), String> {
    if let Some(ref item) = *state.unread_item.lock().unwrap() {
        let text = if unread_count == 0 {
            "没有未读邮件".to_string()
        } else {
            format!("未读邮件：{}", unread_count)
        };
        let _ = item.set_text(text);
    }

    if let Some(ref tray) = *state.tray.lock().unwrap() {
        let tooltip = if unread_count == 0 {
            "Better Email".to_string()
        } else {
            format!("Better Email · {} 未读", unread_count)
        };
        let _ = tray.set_tooltip(Some(tooltip));

        #[cfg(target_os = "macos")]
        {
            let title = if unread_count == 0 {
                "".to_string()
            } else if unread_count > 99 {
                "99+".to_string()
            } else {
                unread_count.to_string()
            };
            let _ = tray.set_title(Some(title));
        }
    }

    Ok(())
}

/// Hide the native window chrome on platforms that do not get the macOS
/// overlay title bar from tauri.conf.json. Called once the webview is ready.
#[tauri::command]
fn window_chrome_ready(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_decorations(false)
                .map_err(|error| format!("无法隐藏系统标题栏：{error}"))?;
        }
    }
    #[cfg(target_os = "macos")]
    let _ = &app;
    Ok(())
}

fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let unread_item = MenuItem::with_id(app, "tray_unread_label", "没有未读邮件", false, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "tray_show", "打开 Better Email", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "tray_hide", "隐藏窗口", true, None::<&str>)?;
    let compose_item = MenuItem::with_id(app, "tray_compose", "写邮件", true, None::<&str>)?;
    let sync_item = MenuItem::with_id(app, "tray_sync", "获取新邮件", true, None::<&str>)?;
    let unread_goto_item = MenuItem::with_id(app, "tray_unread", "打开未读", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "tray_settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "退出 Better Email", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &unread_item,
        &tauri::menu::PredefinedMenuItem::separator(app)?,
        &show_item,
        &hide_item,
        &tauri::menu::PredefinedMenuItem::separator(app)?,
        &compose_item,
        &sync_item,
        &unread_goto_item,
        &settings_item,
        &tauri::menu::PredefinedMenuItem::separator(app)?,
        &quit_item,
    ])?;

    let icon = app.default_window_icon().cloned().ok_or("failed to get default window icon")?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Better Email")
        .on_menu_event(move |app_handle, event| {
            let id = event.id.as_ref();
            match id {
                "tray_show" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
                "tray_hide" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "tray_compose" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let _ = app_handle.emit("tray://compose", ());
                }
                "tray_sync" => {
                    let _ = app_handle.emit("tray://sync", ());
                }
                "tray_unread" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let _ = app_handle.emit("tray://open-unread", ());
                }
                "tray_settings" => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    let _ = app_handle.emit("tray://settings", ());
                }
                "tray_quit" => {
                    if let Some(state) = app_handle.try_state::<TrayState>() {
                        state.is_quitting.store(true, Ordering::SeqCst);
                    }
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    app.manage(TrayState {
        tray: Mutex::new(Some(tray)),
        unread_item: Mutex::new(Some(unread_item)),
        is_quitting: AtomicBool::new(false),
    });

    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = MailStore::open(app.handle())?;
            app.manage(store);
            if let Err(e) = setup_tray(app) {
                eprintln!("Failed to setup tray: {:?}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<TrayState>() {
                    if !state.is_quitting.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_unread_count,
            window_chrome_ready,
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
            commands::get_message_detail,
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
            commands::create_contact,
            commands::update_contact,
            commands::delete_contact,
            commands::merge_contacts,
            commands::export_contacts_vcard,
            commands::import_contacts_vcard,
            commands::preview_contact_import,
            commands::commit_contact_import,
            commands::list_contact_import_batches,
            commands::undo_contact_import_batch,
            commands::pick_contact_import_file,
            commands::ai_chat_request,
            commands::ai_request,
            commands::test_ai_connection,
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
            commands::open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Better Email");
}
