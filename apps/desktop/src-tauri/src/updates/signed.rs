//! The signed path: `tauri-plugin-updater` against `latest.json`, used only
//! when `tauri.conf.json` carries a real minisign public key. Any failure
//! (no key, no `latest.json` on the release, bad signature) makes the caller
//! fall back to the GitHub-release path.

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_updater::UpdaterExt;

use super::check::CheckResult;
use super::release::Channel;
use super::{Strategy, Updates};

/// The pubkey shipped in `tauri.conf.json` until release signing is set up.
pub const PLACEHOLDER_PUBKEY: &str = "REPLACE_WITH_MINISIGN_PUBLIC_KEY";

pub fn is_configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let pubkey = config
        .get("pubkey")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let has_endpoints = config
        .get("endpoints")
        .and_then(Value::as_array)
        .map(|endpoints| !endpoints.is_empty())
        .unwrap_or(false);
    has_endpoints && !pubkey.is_empty() && pubkey != PLACEHOLDER_PUBKEY
}

/// `Ok(result)` when the manifest answered (with or without an update);
/// `Err` when it could not be fetched or verified.
pub async fn check<R: Runtime>(
    app: &AppHandle<R>,
    updates: &Updates,
    channel: Channel,
) -> Result<CheckResult, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let mut result = CheckResult::up_to_date(updates, channel, Strategy::TauriSigned);
            result.has_update = true;
            result.ready_to_install = true;
            result.latest_version = update.version.clone();
            result.body = update.body.clone();
            result.notes = update.body.clone();
            result.date = update.date.map(|d| d.to_string());
            Ok(result)
        }
        None => Ok(CheckResult::up_to_date(
            updates,
            channel,
            Strategy::TauriSigned,
        )),
    }
}

/// Downloads, verifies and installs through the plugin, then restarts.
/// `Ok(None)` means the manifest had nothing newer.
pub async fn install<R: Runtime>(
    app: &AppHandle<R>,
    updates: &Updates,
) -> Result<Option<Value>, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let version = update.version.clone();
    log::info!("updates: installing {version} through tauri-plugin-updater");
    let received = AtomicU64::new(0);
    update
        .download_and_install(
            |chunk, total| {
                let received = received.fetch_add(chunk as u64, Ordering::SeqCst) + chunk as u64;
                updates.emit_progress(json!({
                    "phase": "download",
                    "received": received,
                    "total": total,
                }));
            },
            || {
                let received = received.load(Ordering::SeqCst);
                updates.emit_progress(
                    json!({ "phase": "install", "received": received, "total": received }),
                );
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    log::info!("updates: {version} installed, restarting");
    // `restart` never returns; the page is torn down with the process.
    app.restart()
}
