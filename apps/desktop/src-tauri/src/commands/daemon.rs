//! `desktop_daemon_status` stub. The local sidecar daemon is milestone 3; until
//! then the shell reports a stopped, non-managed daemon in Electron's shape.

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

fn paseo_home<R: Runtime>(app: &AppHandle<R>) -> String {
    if let Ok(home) = std::env::var("PASEO_HOME") {
        if !home.trim().is_empty() {
            return home;
        }
    }
    app.path()
        .home_dir()
        .map(|dir| dir.join(".paseo").to_string_lossy().to_string())
        .unwrap_or_default()
}

pub fn status<R: Runtime>(app: &AppHandle<R>) -> Value {
    json!({
        "serverId": "",
        "status": "stopped",
        "listen": null,
        "hostname": null,
        "pid": null,
        "home": paseo_home(app),
        "version": null,
        "desktopManaged": false,
        "error": null,
    })
}
