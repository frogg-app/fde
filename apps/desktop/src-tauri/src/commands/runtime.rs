//! `desktop_get_runtime_info` and `desktop_get_system_idle_time`.

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

pub fn runtime_info<R: Runtime>(app: &AppHandle<R>) -> Value {
    json!({
        "appVersion": app.package_info().version.to_string(),
        // Rosetta detection was dropped with the Electron shell.
        "runningUnderARM64Translation": false,
    })
}

/// Milliseconds since the last user input. Always 0 until an idle plugin exists.
pub fn system_idle_time_ms() -> Value {
    json!(0)
}
