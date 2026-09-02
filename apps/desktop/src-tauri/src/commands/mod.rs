//! `desktop_invoke` dispatch: one Tauri command, one match on the Electron
//! command name. Unknown names fail exactly as Electron's `paseo:invoke` did.

pub mod attachments;
pub mod daemon;
pub mod runtime;
pub mod settings;
pub mod updater;

use serde_json::Value;
use tauri::{App, AppHandle, Manager, State};

use crate::deep_link::AgentDeepLinkTarget;
use crate::launch::LaunchState;

/// Creates the per-app stores once the app paths are known.
pub fn register_state(app: &App) -> tauri::Result<()> {
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    app.manage(settings::SettingsStore::new(config_dir));
    app.manage(attachments::AttachmentStore::new(data_dir.join(attachments::DIRNAME)));
    Ok(())
}

#[tauri::command]
pub async fn desktop_invoke(
    app: AppHandle,
    command: String,
    args: Option<Value>,
) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    match command.as_str() {
        "get_desktop_settings" => app.state::<settings::SettingsStore>().get(),
        "patch_desktop_settings" => app.state::<settings::SettingsStore>().patch(&args),
        "migrate_legacy_desktop_settings" => {
            app.state::<settings::SettingsStore>().migrate_legacy_renderer_settings(&args)
        }
        "desktop_get_runtime_info" => Ok(runtime::runtime_info(&app)),
        "desktop_get_system_idle_time" => Ok(runtime::system_idle_time_ms()),
        "desktop_daemon_status" => Ok(daemon::status(&app)),
        "write_attachment_base64" => app.state::<attachments::AttachmentStore>().write_base64(&args),
        "write_attachment_bytes" => app.state::<attachments::AttachmentStore>().write_bytes(&args),
        "copy_attachment_file" => app.state::<attachments::AttachmentStore>().copy_file(&args),
        "read_file_base64" => app.state::<attachments::AttachmentStore>().read_base64(&args),
        "delete_attachment_file" => app.state::<attachments::AttachmentStore>().delete_file(&args),
        "garbage_collect_attachment_files" => {
            app.state::<attachments::AttachmentStore>().garbage_collect(&args)
        }
        "check_app_update" => updater::check(&app, &args).await,
        "install_app_update" => updater::install(&app, &args).await,
        other => Err(format!("Unknown desktop command: {other}")),
    }
}

#[tauri::command]
pub fn get_pending_open_project(state: State<'_, LaunchState>) -> Option<String> {
    state.take_pending_open_project()
}

#[tauri::command]
pub fn agent_navigation_ready(state: State<'_, LaunchState>) -> Option<AgentDeepLinkTarget> {
    state.window_ready()
}
