//! `desktop_invoke` dispatch: one Tauri command, one match on the Electron
//! command name. Unknown names fail exactly as Electron's `fde:invoke` did.

pub mod attachments;
pub mod cli_install;
pub mod daemon;
pub mod integrations;
pub mod runtime;
pub mod settings;

use std::sync::Arc;

use serde_json::Value;
use tauri::{App, AppHandle, Emitter, Manager, State};

use crate::app_log;
use crate::deep_link::AgentDeepLinkTarget;
use crate::deploy::{self, DeployManager};
use crate::launch::LaunchState;
use crate::network;
use crate::ssh_config;
use crate::transport::{ssh_auth, EventSink, TransportManager};

const TRANSPORT_EVENT: &str = "fde:event:local-daemon-transport-event";

/// Creates the per-app stores once the app paths are known.
pub fn register_state(app: &App) -> tauri::Result<()> {
    let config_dir = app.path().app_config_dir()?;
    let data_dir = app.path().app_data_dir()?;
    // The ssh askpass helper lives in the app cache dir (see `ssh_auth`).
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        ssh_auth::configure_helper_dir(cache_dir.join("ssh-askpass"));
    }
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
    crate::sidecar::register(app)?;
    Ok(())
}

/// Run a blocking store operation off the async runtime's worker threads.
///
/// Reading an attachment reads the whole file and base64-encodes it, and these commands
/// share a runtime with every daemon transport session. Enough concurrent thumbnail reads
/// -- which the agent stream can issue freely as rows scroll into view -- would otherwise
/// occupy the workers that pump daemon frames, stalling the app rather than just the
/// images.
async fn run_blocking<S, F>(store: S, args: Value, operation: F) -> Result<Value, String>
where
    S: Send + 'static,
    F: FnOnce(S, Value) -> Result<Value, String> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(move || operation(store, args)).await {
        Ok(result) => result,
        Err(error) => Err(format!("Attachment operation failed: {error}")),
    }
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
        "local_daemon_bundle_status" => Ok(daemon::bundle_status(&app)),
        "install_local_daemon_bundle" => daemon::install_bundle(&app, &args).await,
        "desktop_daemon_status" => Ok(daemon::status(&app).await),
        "start_desktop_daemon" => daemon::start(&app).await,
        "restart_desktop_daemon" => daemon::restart(&app).await,
        "stop_desktop_daemon" => daemon::stop(&app, &args).await,
        "desktop_daemon_logs" => daemon::logs(&app),
        "desktop_app_logs" => app_log::app_logs(&app),
        "cli_daemon_status" => daemon::cli_status(&app).await,
        "get_local_daemon_version" => Ok(daemon::local_version(&app).await),
        "run_local_daemon_update" => Ok(daemon::run_update(&app).await),
        "get_cli_install_status" => cli_install::status(&app),
        "install_cli" => cli_install::install(&app),
        "read_legacy_skill_selection" => integrations::read_legacy_skill_selection(&app),
        "delete_legacy_skill_selection" => integrations::delete_legacy_skill_selection(&app),
        "open_local_daemon_transport" => app.state::<TransportManager>().open(&args),
        "send_local_daemon_transport_message" => app.state::<TransportManager>().send(&args).await,
        "close_local_daemon_transport" => app.state::<TransportManager>().close(&args),
        "list_ssh_config_hosts" => ssh_config::list_ssh_config_hosts(&app),
        "network_local_addresses" => network::local_addresses(),
        "network_reverse_lookup" => network::reverse_lookup(&args).await,
        "network_probe_identity" => network::probe_identity(&args).await,
        "ssh_deploy_probe" => app.state::<DeployManager>().probe(&args).await,
        "ssh_deploy_start" => app
            .state::<DeployManager>()
            .start(&args, &app.package_info().version.to_string()),
        "ssh_deploy_uninstall" => app.state::<DeployManager>().uninstall(&args),
        "ssh_deploy_cancel" => app.state::<DeployManager>().cancel(&args),
        "write_attachment_base64" => app
            .state::<attachments::AttachmentStore>()
            .write_base64(&args),
        "write_attachment_bytes" => {
            run_blocking(app.state::<attachments::AttachmentStore>().inner().clone(), args, |store, args| {
                store.write_bytes(&args)
            })
            .await
        }
        "copy_attachment_file" => {
            run_blocking(app.state::<attachments::AttachmentStore>().inner().clone(), args, |store, args| {
                store.copy_file(&args)
            })
            .await
        }
        "read_file_base64" => {
            run_blocking(app.state::<attachments::AttachmentStore>().inner().clone(), args, |store, args| {
                store.read_base64(&args)
            })
            .await
        }
        "delete_attachment_file" => {
            run_blocking(app.state::<attachments::AttachmentStore>().inner().clone(), args, |store, args| {
                store.delete_file(&args)
            })
            .await
        }
        "garbage_collect_attachment_files" => {
            run_blocking(app.state::<attachments::AttachmentStore>().inner().clone(), args, |store, args| {
                store.garbage_collect(&args)
            })
            .await
        }
        // Pairing deep links (`fde://pair#offer=…`, see `launch.rs`): the page
        // calls this after registering its `open-pairing-offer` listener.
        "pairing_offer_ready" => Ok(serde_json::to_value(
            app.state::<LaunchState>().pairing_offer_ready(),
        )
        .map_err(|error| error.to_string())?),
        "check_app_update" => crate::updates::check(&app, &args).await,
        "install_app_update" => crate::updates::install(&app, &args).await,
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
