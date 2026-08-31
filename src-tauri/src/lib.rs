mod browser;
mod commands;
mod db;
mod geocodio;
mod imap;
mod license;

use commands::{init_db, DbState};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::webview::PageLoadPayload;
use tauri::{AppHandle, Manager, RunEvent, Url, Webview, WebviewWindow, WindowEvent};

const WEBVIEW_RECOVER_COOLDOWN: Duration = Duration::from_secs(3);
const WEBVIEW_WATCH_INTERVAL: Duration = Duration::from_secs(2);

fn is_renderer_crash_url(url: &Url) -> bool {
    let scheme = url.scheme();
    let host = url.host_str().unwrap_or("");
    scheme.eq_ignore_ascii_case("chrome-error")
        || scheme.eq_ignore_ascii_case("chromewebdata")
        || host.eq_ignore_ascii_case("chromewebdata")
        || host.eq_ignore_ascii_case("chrome-error")
}

fn frontend_url(manager: &impl Manager<tauri::Wry>) -> Option<Url> {
    #[cfg(debug_assertions)]
    {
        manager.config().build.dev_url.clone()
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = manager;
        Url::parse("https://tauri.localhost/").ok()
    }
}

fn remember_good_url(url: &Url) {
    if is_renderer_crash_url(url) || url.scheme().eq_ignore_ascii_case("about") {
        return;
    }
    if let Ok(mut last_good) = LAST_GOOD_URL.lock() {
        *last_good = Some(url.clone());
    }
}

fn begin_recover() -> bool {
    let Ok(mut last_recover) = LAST_RECOVER.lock() else {
        return false;
    };
    if last_recover
        .map(|instant| instant.elapsed() < WEBVIEW_RECOVER_COOLDOWN)
        .unwrap_or(false)
    {
        return false;
    }
    *last_recover = Some(Instant::now());
    true
}

fn recovery_target(manager: &impl Manager<tauri::Wry>) -> Option<Url> {
    LAST_GOOD_URL
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .filter(|candidate| !is_renderer_crash_url(candidate))
        .or_else(|| frontend_url(manager))
}

fn recover_window(window: &WebviewWindow) {
    if !begin_recover() {
        return;
    }
    if let Some(target) = recovery_target(window) {
        let _ = window.navigate(target);
    }
}

fn recover_webview(webview: &Webview, payload: &PageLoadPayload<'_>) {
    let url = payload.url();
    if !is_renderer_crash_url(url) {
        remember_good_url(url);
        return;
    }
    if !begin_recover() {
        return;
    }
    if let Some(target) = recovery_target(webview) {
        let _ = webview.navigate(target);
    }
}

fn recover_if_error_page(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(url) = window.url() else {
        return;
    };
    if is_renderer_crash_url(&url) {
        recover_window(&window);
    }
}

fn attach_process_failed_recovery(window: &WebviewWindow) {
    let window = window.clone();
    let _ = window.clone().with_webview(move |webview| {
        #[cfg(windows)]
        {
            attach_windows_process_failed(window, webview);
        }
        #[cfg(not(windows))]
        {
            let _ = (window, webview);
        }
    });
}

#[cfg(windows)]
fn attach_windows_process_failed(window: WebviewWindow, webview: tauri::webview::PlatformWebview) {
    use webview2_com::ProcessFailedEventHandler;

    unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let mut token = 0_i64;
        let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
            if let Some(args) = args {
                if is_browser_process_exit(&args) {
                    return Ok(());
                }
            }
            let window = window.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let recover = window.clone();
                let _ = window.run_on_main_thread(move || {
                    recover_window(&recover);
                });
            });
            Ok(())
        }));
        let _ = core.add_ProcessFailed(&handler, &mut token);
    }
}

#[cfg(windows)]
fn is_browser_process_exit(args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ProcessFailedEventArgs) -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
    unsafe {
        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
        args.ProcessFailedKind(&mut kind)
            .map(|_| kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED)
            .unwrap_or(false)
    }
}

fn spawn_error_page_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WEBVIEW_WATCH_INTERVAL);
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            recover_if_error_page(&app);
        });
    });
}

static LAST_GOOD_URL: Mutex<Option<Url>> = Mutex::new(None);
static LAST_RECOVER: Mutex<Option<Instant>> = Mutex::new(None);

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
            if let Some(window) = app.get_webview_window("main") {
                attach_process_failed_recovery(&window);
            }
            spawn_error_page_watch(app.handle().clone());
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
            commands::fetch_imap_message,
            commands::geocodio_lookup,
            commands::activate_license,
            commands::check_license,
            commands::clear_license,
            commands::licensing_required,
        ])
        .on_page_load(|webview, payload| {
            recover_webview(webview, payload);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::WindowEvent { label, event, .. } if label == "main" => {
                    match event {
                        WindowEvent::CloseRequested { .. } => {
                            app_handle.exit(0);
                        }
                        WindowEvent::Focused(true) => {
                            recover_if_error_page(app_handle);
                        }
                        _ => {}
                    }
                }
                RunEvent::ExitRequested { .. } => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        });
}
