//! FDE (Frogg Development Environment) desktop shell: a Tauri v2 window around the exported web UI.
//!
//! See `docs/desktop-shell.md` for the design. The JS bridge injected into the
//! page lives in `../bridge.js` (built from `../../src/bridge.ts`).

mod commands;
mod deep_link;
mod launch;
mod window;

use tauri::webview::PageLoadEvent;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            launch::handle_second_instance(app, &argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(launch::LaunchState::from_argv(&std::env::args().collect::<Vec<_>>()))
        .invoke_handler(tauri::generate_handler![
            commands::desktop_invoke,
            commands::get_pending_open_project,
            commands::agent_navigation_ready,
        ])
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                webview.state::<launch::LaunchState>().window_loading();
            }
        })
        .setup(|app| {
            commands::register_state(app)?;
            window::create_main_window(app)?;
            launch::register_deep_link_handler(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FDE");
}
