//! `desktop_invoke` dispatch: one Tauri command, one match on the Electron
//! command name. Unknown names fail exactly as Electron's `paseo:invoke` did.

pub mod attachments;
pub mod daemon;
pub mod integrations;
pub mod runtime;
pub mod settings;
pub mod updater;

use std::sync::Arc;

use serde_json::Value;
use tauri::{App, AppHandle, Emitter, Manager, State};

use crate::app_log;
use crate::deep_link::AgentDeepLinkTarget;
use crate::deploy::{self, DeployManager};
use crate::launch::LaunchState;
use crate::ssh_config;
use crate::transport::{EventSink, TransportManager};

const TRANSPORT_EVENT: &str = "paseo:event:local-daemon-transport-event";

/// Creates the per-app stores once the app paths are known.
pub fn register_state(app: &App) -> tauri::Result<()> {
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    app.manage(settings::SettingsStore::new(config_dir));
    app.manage(attachments::AttachmentStore::new(
        data_dir.join(attachments::DIRNAME),
    ));
    let handle = app.handle().clone();
    let emit: EventSink = Arc::new(move |payload| {
        if let Err(error) = handle.emit(TRANSPORT_EVENT, payload) {
            log::warn!("failed to emit transport event: {error}");
        }
    });
    app.manage(TransportManager::new(emit));
    let handle = app.handle().clone();
    let emit_deploy: EventSink = Arc::new(move |payload| {
        if let Err(error) = handle.emit(deploy::DEPLOY_EVENT, payload) {
            log::warn!("failed to emit deploy event: {error}");
        }
    });
    app.manage(DeployManager::new(emit_deploy));
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
        "migrate_legacy_desktop_settings" => app
            .state::<settings::SettingsStore>()
            .migrate_legacy_renderer_settings(&args),
        "desktop_get_runtime_info" => Ok(runtime::runtime_info(&app)),
        "desktop_get_system_idle_time" => Ok(runtime::system_idle_time_ms()),
        "desktop_daemon_status" => Ok(daemon::status(&app)),
        "start_desktop_daemon" | "restart_desktop_daemon" => daemon::start_not_bundled(),
        "stop_desktop_daemon" => Ok(daemon::stop(&app, &args)),
        "desktop_daemon_logs" => daemon::logs(&app),
        "desktop_app_logs" => app_log::app_logs(&app),
        "cli_daemon_status" => Ok(daemon::cli_status()),
        "get_local_daemon_version" => Ok(daemon::local_version()),
        "run_local_daemon_update" => Ok(daemon::run_update()),
        "get_cli_install_status" => Ok(integrations::cli_install_status()),
        "install_cli" => integrations::install_cli(),
        "read_legacy_skill_selection" => integrations::read_legacy_skill_selection(&app),
        "delete_legacy_skill_selection" => integrations::delete_legacy_skill_selection(&app),
        "open_local_daemon_transport" => app.state::<TransportManager>().open(&args),
        "send_local_daemon_transport_message" => app.state::<TransportManager>().send(&args).await,
        "close_local_daemon_transport" => app.state::<TransportManager>().close(&args),
        "list_ssh_config_hosts" => ssh_config::list_ssh_config_hosts(&app),
        "ssh_deploy_probe" => app.state::<DeployManager>().probe(&args).await,
        "ssh_deploy_start" => app
            .state::<DeployManager>()
            .start(&args, &app.package_info().version.to_string()),
        "ssh_deploy_uninstall" => app.state::<DeployManager>().uninstall(&args),
        "ssh_deploy_cancel" => app.state::<DeployManager>().cancel(&args),
        "write_attachment_base64" => app
            .state::<attachments::AttachmentStore>()
            .write_base64(&args),
        "write_attachment_bytes" => app
            .state::<attachments::AttachmentStore>()
            .write_bytes(&args),
        "copy_attachment_file" => app.state::<attachments::AttachmentStore>().copy_file(&args),
        "read_file_base64" => app
            .state::<attachments::AttachmentStore>()
            .read_base64(&args),
        "delete_attachment_file" => app
            .state::<attachments::AttachmentStore>()
            .delete_file(&args),
        "garbage_collect_attachment_files" => app
            .state::<attachments::AttachmentStore>()
            .garbage_collect(&args),
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
