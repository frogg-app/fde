//! Local daemon commands, answered by the sidecar (`src/sidecar/`) in
//! Electron's JSON shapes. Without an installed bundle, status carries the
//! "not installed" error and start fails with it, so the UI offers Install.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::app_log::{tail_file, DAEMON_LOG_TAIL_LINES};
use crate::sidecar::{self, lifecycle, Sidecar};

fn stop_reason(args: &Value) -> &str {
    args.get("reason")
        .and_then(Value::as_str)
        .unwrap_or("manual_ipc")
}

/// `local_daemon_bundle_status`.
pub fn bundle_status<R: Runtime>(app: &AppHandle<R>) -> Value {
    app.state::<Sidecar>().bundle_status()
}

/// `install_local_daemon_bundle {version?}`: defaults to the app version.
pub async fn install_bundle<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Result<Value, String> {
    let version = args
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| app.package_info().version.to_string());
    app.state::<Sidecar>().install(&version).await
}

/// `desktop_daemon_status`.
pub async fn status<R: Runtime>(app: &AppHandle<R>) -> Value {
    let sidecar = app.state::<Sidecar>();
    lifecycle::resolve_status(
        sidecar.store.installed().as_ref(),
        &sidecar::paseo_home(app),
    )
    .await
    .to_json()
}

/// `start_desktop_daemon`.
pub async fn start<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let sidecar = app.state::<Sidecar>();
    let _guard = sidecar.lifecycle.lock().await;
    lifecycle::start(&sidecar, &sidecar::launch_config(app))
        .await
        .map(|s| s.to_json())
}

/// `restart_desktop_daemon`.
pub async fn restart<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let sidecar = app.state::<Sidecar>();
    let _guard = sidecar.lifecycle.lock().await;
    lifecycle::restart(&sidecar, &sidecar::launch_config(app))
        .await
        .map(|s| s.to_json())
}

/// `stop_desktop_daemon {reason}`.
pub async fn stop<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Result<Value, String> {
    let sidecar = app.state::<Sidecar>();
    let _guard = sidecar.lifecycle.lock().await;
    lifecycle::stop(&sidecar, &sidecar::paseo_home(app), stop_reason(args))
        .await
        .map(|s| s.to_json())
}

/// `desktop_daemon_logs`: `$PASEO_HOME/daemon.log` when a daemon has written one.
pub fn logs<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let path = sidecar::paseo_home(app).join(lifecycle::DAEMON_LOG_FILENAME);
    Ok(json!({
        "logPath": path.to_string_lossy(),
        "contents": tail_file(&path, DAEMON_LOG_TAIL_LINES).unwrap_or_default(),
    }))
}

/// `cli_daemon_status`: the text of `fde daemon status`.
pub async fn cli_status<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let sidecar = app.state::<Sidecar>();
    let bundle = sidecar.store.installed().ok_or(sidecar::NOT_INSTALLED)?;
    let home = sidecar::paseo_home(app);
    let invocation = sidecar::cli::CliInvocation::new(
        &bundle,
        &["daemon", "status"],
        sidecar::cli::CliInvocation::probe_env(&bundle, &home),
    );
    sidecar::cli::run_text(&invocation).await.map(Value::String)
}

/// `get_local_daemon_version`: `{version, error}` from the running daemon.
pub async fn local_version<R: Runtime>(app: &AppHandle<R>) -> Value {
    let sidecar = app.state::<Sidecar>();
    let status = lifecycle::resolve_status(
        sidecar.store.installed().as_ref(),
        &sidecar::paseo_home(app),
    )
    .await;
    if !status.is_running() {
        return json!({ "version": null, "error": "Daemon is not running." });
    }
    match status.version {
        Some(version) => json!({ "version": version, "error": null }),
        None => json!({ "version": null, "error": "Running daemon did not report a version." }),
    }
}

/// `run_local_daemon_update`: install the bundle matching the app version and
/// restart the daemon on it. `{exitCode, stdout, stderr}` like a CLI run.
pub async fn run_update<R: Runtime>(app: &AppHandle<R>) -> Value {
    let version = app.package_info().version.to_string();
    let sidecar = app.state::<Sidecar>();
    let result = async {
        sidecar.install(&version).await?;
        let _guard = sidecar.lifecycle.lock().await;
        lifecycle::restart(&sidecar, &sidecar::launch_config(app)).await
    }
    .await;
    match result {
        Ok(status) => json!({
            "exitCode": 0,
            "stdout": format!("Installed local daemon {version}; {}", status.summary()),
            "stderr": "",
        }),
        Err(error) => json!({ "exitCode": 1, "stdout": "", "stderr": error }),
    }
}
