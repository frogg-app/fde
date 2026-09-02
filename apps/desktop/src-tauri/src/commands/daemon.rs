//! Local daemon commands. The sidecar daemon is milestone 3; until it ships
//! these answer in Electron's shapes with "not bundled" values so the UI's
//! daemon section renders quietly instead of toasting.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::app_log::{tail_file, DAEMON_LOG_TAIL_LINES};

pub const NOT_BUNDLED_MESSAGE: &str =
    "Local daemon is not bundled in this build yet; add a remote host instead.";

fn paseo_home<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    if let Ok(home) = std::env::var("PASEO_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    app.path()
        .home_dir()
        .map(|dir| dir.join(".paseo"))
        .unwrap_or_default()
}

/// `desktop_daemon_status` (and what stop returns): a stopped, unmanaged daemon.
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Value {
    json!({
        "serverId": "",
        "status": "stopped",
        "listen": null,
        "hostname": null,
        "pid": null,
        "home": paseo_home(app).to_string_lossy(),
        "version": null,
        "desktopManaged": false,
        "error": null,
    })
}

/// `start_desktop_daemon` / `restart_desktop_daemon`.
pub fn start_not_bundled() -> Result<Value, String> {
    Err(NOT_BUNDLED_MESSAGE.to_string())
}

/// `stop_desktop_daemon`: Electron skips the stop when nothing runs and
/// returns the current status.
pub fn stop<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Value {
    let reason = args
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("manual_ipc");
    log::info!("desktop daemon stop skipped (reason={reason}): no bundled daemon");
    status(app)
}

/// `desktop_daemon_logs`: `$PASEO_HOME/daemon.log` when a daemon has written one.
pub fn logs<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let path = paseo_home(app).join("daemon.log");
    Ok(json!({
        "logPath": path.to_string_lossy(),
        "contents": tail_file(&path, DAEMON_LOG_TAIL_LINES).unwrap_or_default(),
    }))
}

/// `cli_daemon_status`: the text Electron got from `paseo daemon status`.
pub fn cli_status() -> Value {
    Value::String(format!(
        "{NOT_BUNDLED_MESSAGE}\nStatus: stopped (no bundled daemon)"
    ))
}

/// `get_local_daemon_version`: no version and no error, so the updates
/// section shows nothing rather than a failure for a daemon that cannot exist.
pub fn local_version() -> Value {
    json!({ "version": null, "error": null })
}

/// `run_local_daemon_update`: `{exitCode, stdout, stderr}`.
pub fn run_update() -> Value {
    json!({ "exitCode": 1, "stdout": "", "stderr": NOT_BUNDLED_MESSAGE })
}
