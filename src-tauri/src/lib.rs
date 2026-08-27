mod ai;
mod commands;
mod credentials;
mod db;
mod http;
mod imap_probe;
mod logging;
mod mime;
mod models;
mod oauth;
mod pop3_probe;
mod protocol;
mod provider_probe;
mod secret_crypto;
mod smtp;
mod vcard;

use db::MailStore;
pub use provider_probe::{list_provider_probe_accounts, run_provider_probe};
use tauri::Manager;

#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
#[cfg(desktop)]
use tauri::Emitter;
#[cfg(desktop)]
use tauri::Wry;

#[cfg(desktop)]
pub struct TrayState {
    pub tray: Mutex<Option<tauri::tray::TrayIcon>>,
    pub unread_item: Mutex<Option<MenuItem<Wry>>>,
    pub is_quitting: AtomicBool,
}

/// The main window places the next compose request here before opening the
/// native compose webview. The child consumes it during boot, or after a
/// subsequent focus-and-reuse request.
pub struct PendingComposerRequestState {
    pub request: Mutex<Option<serde_json::Value>>,
}

/// 把 Rust panic 记录到应用数据目录的 crash.log，便于用户侧可诊断。
fn install_crash_log_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info.location().map(|loc| loc.to_string());
        let payload = if let Some(message) = info.payload().downcast_ref::<&str>() {
            (*message).to_string()
        } else if let Some(message) = info.payload().downcast_ref::<String>() {
            message.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let dir = std::env::var_os("BETTER_EMAIL_CRASH_LOG_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| dirs_app_data_dir().unwrap_or_else(std::env::temp_dir));
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("crash.log"))
        {
            use std::io::Write;
            let _ = writeln!(
                file,
                "[{}] panic: {}\n    at {}",
                chrono::Utc::now().to_rfc3339(),
                payload,
                location.as_deref().unwrap_or("unknown")
            );
        }
        default_hook(info);
    }));
}

fn dirs_app_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|home| {
            std::path::PathBuf::from(home)
                .join("Library/Application Support/app.betteremail.client")
        })
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(|appdata| std::path::PathBuf::from(appdata).join("app.betteremail.client"))
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| {
                    std::path::PathBuf::from(home).join(".local/share/app.betteremail.client")
                })
            })
    }
}

#[cfg(desktop)]
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

#[cfg(not(desktop))]
#[tauri::command]
fn set_tray_unread_count(_unread_count: u64) -> Result<(), String> {
    // 移动端没有系统托盘；保留同名命令以兼容前端调用。
    Ok(())
}

/// Return the native platform to the frontend without relying on browser
/// user-agent heuristics. This is intentionally compile-time selected so the
/// Windows titlebar path cannot accidentally be rendered on macOS.
#[tauri::command]
fn get_platform() -> String {
    #[cfg(target_os = "macos")]
    {
        return "macos".to_string();
    }
    #[cfg(target_os = "windows")]
    {
        return "windows".to_string();
    }
    #[cfg(target_os = "linux")]
    {
        return "linux".to_string();
    }
    #[cfg(target_os = "android")]
    {
        return "android".to_string();
    }
    #[allow(unreachable_code)]
    "web".to_string()
}

/// Hide the native window chrome only on Windows, where the application owns
/// the titlebar controls. macOS keeps native decorations so its traffic lights
/// and native window behaviour remain intact; Linux keeps its default chrome.
/// Called once the webview is ready.
#[tauri::command]
fn window_chrome_ready(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_decorations(false)
                .map_err(|error| format!("无法隐藏系统标题栏：{error}"))?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = &app;
    Ok(())
}

#[tauri::command]
fn set_pending_composer_request(
    request: serde_json::Value,
    state: tauri::State<'_, PendingComposerRequestState>,
) -> Result<(), String> {
    *state
        .request
        .lock()
        .map_err(|_| "写信请求状态锁定失败".to_string())? = Some(request);
    Ok(())
}

#[tauri::command]
fn take_pending_composer_request(
    state: tauri::State<'_, PendingComposerRequestState>,
) -> Option<serde_json::Value> {
    state.request.lock().ok()?.take()
}

#[cfg(desktop)]
fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let unread_item = MenuItem::with_id(
        app,
        "tray_unread_label",
        "没有未读邮件",
        false,
        None::<&str>,
    )?;
    let show_item = MenuItem::with_id(app, "tray_show", "打开 Better Email", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "tray_hide", "隐藏窗口", true, None::<&str>)?;
    let compose_item = MenuItem::with_id(app, "tray_compose", "写邮件", true, None::<&str>)?;
    let sync_item = MenuItem::with_id(app, "tray_sync", "获取新邮件", true, None::<&str>)?;
    let unread_goto_item = MenuItem::with_id(app, "tray_unread", "打开未读", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "tray_settings", "设置", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray_quit", "退出 Better Email", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
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
        ],
    )?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/v4/tray-icon.png"))
        .map_err(|error| format!("failed to load tray icon: {error}"))?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(false)
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
            } = event
            {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_crash_log_hook();
    tauri::Builder::default()
        // Keep the native macOS application/Edit menu so WebKit receives the
        // standard Undo/Redo/Cut/Copy/Paste/Select All command chain and shortcuts.
        .enable_macos_default_menu(true)
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let store = MailStore::open(app.handle())?;
            app.manage(store);
            app.manage(PendingComposerRequestState {
                request: Mutex::new(None),
            });
            // Keep Better Email as a regular macOS application so it stays visible
            // in the Dock. Menu creation is controlled separately above.
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Regular)?;
            // 主窗口图标与 bundle.icon 使用同一份 v4 源资源：
            // 无边框/透明窗口在 Windows 任务栏、Alt+Tab 需要显式设置图标。
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) =
                    tauri::image::Image::from_bytes(include_bytes!("../icons/v4/icon.png"))
                {
                    let _ = window.set_icon(icon);
                }
            }
            #[cfg(desktop)]
            if let Err(e) = setup_tray(app) {
                crate::logging::log_line(format!("Failed to setup tray: {:?}", e));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if window.label() == "composer" {
                // The composer renderer installs its unsaved-draft guard before
                // revealing the window and owns close-to-hide behavior.
                return;
            }
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app_handle = window.app_handle();
                if let Some(state) = app_handle.try_state::<TrayState>() {
                    if !state.is_quitting.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            set_tray_unread_count,
            get_platform,
            window_chrome_ready,
            set_pending_composer_request,
            take_pending_composer_request,
            commands::list_accounts,
            commands::get_account,
            commands::create_account,
            commands::set_default_account,
            commands::delete_account,
            commands::remove_account,
            commands::update_account_settings,
            commands::set_account_onboarding_completed,
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
            commands::list_pending_remote_writes,
            commands::list_messages_by_ids,
            commands::list_attachments,
            commands::read_attachment_data_url,
            commands::save_image_data_url_as,
            commands::pick_outbound_attachments,
            commands::save_temp_attachment,
            commands::cleanup_temp_attachments,
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
            commands::snooze_messages,
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
            commands::get_app_settings,
            commands::set_download_dir,
            commands::reset_download_dir,
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
            commands::commit_contact_import_entries,
            commands::list_contact_import_batches,
            commands::undo_contact_import_batch,
            commands::pick_contact_import_file,
            commands::ai_chat_request,
            commands::ai_request,
            commands::test_ai_connection,
            commands::save_ai_settings,
            commands::load_ai_settings,
            commands::list_rules,
            commands::upsert_rule,
            commands::set_rule_enabled,
            commands::delete_rule,
            commands::list_threads,
            commands::list_outbox,
            commands::enqueue_background_task,
            commands::enqueue_account_background_task,
            commands::retry_background_task,
            commands::cancel_background_task,
            commands::consume_background_task_cancel,
            commands::list_background_tasks,
            commands::get_background_task,
            commands::next_background_task,
            commands::mark_background_task_running,
            commands::update_background_task_progress,
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
