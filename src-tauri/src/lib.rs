mod browser;
mod commands;
mod db;
mod imap;
mod license;

use commands::{init_db, DbState};
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(all(desktop, not(debug_assertions)))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    #[cfg(all(desktop, debug_assertions))]
    {
        builder = builder.plugin(tauri_plugin_process::init());
    }

    builder
        .manage(DbState(std::sync::Mutex::new(None)))
        .manage(browser::BrowserSessionRegistry::default())
        .setup(|app| {
            let state = app.state::<DbState>();
            init_db(app.handle(), &state)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::get_profile,
            commands::save_profile,
            commands::save_profiles,
            commands::delete_profile,
            commands::replace_profiles,
            commands::list_jig_presets,
            commands::save_jig_preset,
            commands::delete_jig_preset,
            commands::list_export_templates,
            commands::save_export_template,
            commands::delete_export_template,
            commands::seed_defaults,
            commands::list_master_profiles,
            commands::save_master_profile,
            commands::delete_master_profile,
            commands::openai_chat_completion,
            commands::launch_browser_session,
            commands::list_running_browser_sessions,
            commands::check_camoufox,
            commands::bundled_runtime_info,
            commands::test_proxy,
            commands::test_imap,
            commands::fetch_imap_inbox,
            commands::activate_license,
            commands::check_license,
            commands::clear_license,
            commands::licensing_required,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        app_handle.exit(0);
                    }
                }
                RunEvent::ExitRequested { .. } => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        });
}
