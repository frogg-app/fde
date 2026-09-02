//! `check_app_update` / `install_app_update` over `tauri-plugin-updater`.
//! Result shapes match Electron's `AppUpdateCheckResult` / `AppUpdateInstallResult`.

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// The pubkey shipped in `tauri.conf.json` until release signing is set up.
pub const PLACEHOLDER_PUBKEY: &str = "REPLACE_WITH_MINISIGN_PUBLIC_KEY";
const NOT_CONFIGURED_MESSAGE: &str = "Updates are not configured for this build.";

fn is_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let pubkey = config.get("pubkey").and_then(Value::as_str).unwrap_or_default();
    let has_endpoints = config
        .get("endpoints")
        .and_then(Value::as_array)
        .map(|endpoints| !endpoints.is_empty())
        .unwrap_or(false);
    has_endpoints && !pubkey.is_empty() && pubkey != PLACEHOLDER_PUBKEY
}

fn intent(args: &Value) -> &str {
    match args.get("intent").and_then(Value::as_str) {
        Some("manual") => "manual",
        _ => "automatic",
    }
}

fn current_version<R: Runtime>(app: &AppHandle<R>) -> String {
    app.package_info().version.to_string()
}

fn check_result(current: &str, latest: &str, body: Option<String>, date: Option<String>, has_update: bool, error: Option<String>) -> Value {
    json!({
        "hasUpdate": has_update,
        "readyToInstall": false,
        "currentVersion": current,
        "latestVersion": latest,
        "body": body,
        "date": date,
        "errorMessage": error,
    })
}

pub async fn check<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Result<Value, String> {
    let current = current_version(app);
    if !is_configured(app) {
        let error = (intent(args) == "manual").then(|| NOT_CONFIGURED_MESSAGE.to_string());
        return Ok(check_result(&current, &current, None, None, false, error));
    }

    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(check_result(
            &current,
            &update.version,
            update.body.clone(),
            update.date.map(|d| d.to_string()),
            true,
            None,
        )),
        Ok(None) => Ok(check_result(&current, &current, None, None, false, None)),
        Err(error) => Ok(check_result(&current, &current, None, None, false, Some(error.to_string()))),
    }
}

pub async fn install<R: Runtime>(app: &AppHandle<R>, _args: &Value) -> Result<Value, String> {
    if !is_configured(app) {
        return Ok(json!({
            "installed": false,
            "version": null,
            "message": NOT_CONFIGURED_MESSAGE,
        }));
    }

    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(json!({
            "installed": false,
            "version": null,
            "message": "You are already on the latest version.",
        }));
    };

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    // `restart` never returns; the page is torn down with the process.
    app.restart()
}
