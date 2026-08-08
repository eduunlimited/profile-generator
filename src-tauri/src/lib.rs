mod commands;
mod db;

use commands::{init_db, DbState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(std::sync::Mutex::new(None)))
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
