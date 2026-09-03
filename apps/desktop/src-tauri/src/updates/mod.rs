//! App updates without depending on the Tauri updater signing key. See
//! docs/desktop-shell.md "Updates".
//!
//! `strategy()` picks `tauri-signed` (a real `plugins.updater.pubkey` in
//! `tauri.conf.json`) or `github-release`. The signed path is tried first and
//! falls back to GitHub when the release has no `latest.json`. The GitHub path
//! reads the Releases API, picks the newest semver above the running version
//! for the settings' `releaseChannel`, downloads the platform asset with
//! progress events, verifies its `.sha256` sidecar and installs it
//! (`install.rs`). Checks run every 6 h while the app runs and on demand;
//! the last result is cached in the config dir (`cache.rs`).

pub mod assets;
pub mod cache;
pub mod check;
pub mod download;
pub mod github;
pub mod install;
pub mod release;
pub mod signed;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{App, AppHandle, Emitter, Manager, Runtime};

use crate::commands::settings::SettingsStore;
use assets::{AssetKind, InstallContext};
use cache::LastCheck;
use check::CheckResult;
use release::Channel;

pub const AVAILABLE_EVENT: &str = "paseo:event:app-update-available";
pub const PROGRESS_EVENT: &str = "paseo:event:app-update-progress";
const DOWNLOAD_DIRNAME: &str = "updates";
/// Automatic checks reuse a cached answer younger than this.
const AUTOMATIC_CACHE_TTL_MS: u64 = 30 * 60 * 1000;
const AUTO_CHECK_INITIAL_DELAY: Duration = Duration::from_secs(20);
const AUTO_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Time for the install result to reach the webview before the shell exits.
const EXIT_GRACE: Duration = Duration::from_millis(750);

pub type EventSink = Arc<dyn Fn(&str, Value) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategy {
    TauriSigned,
    GithubRelease,
}

impl Strategy {
    pub fn as_str(self) -> &'static str {
        match self {
            Strategy::TauriSigned => "tauri-signed",
            Strategy::GithubRelease => "github-release",
        }
    }
}

pub struct Updates {
    pub releases_url: String,
    pub current_version: String,
    pub config_dir: PathBuf,
    pub download_dir: PathBuf,
    pub strategy: Strategy,
    emit: EventSink,
    installing: AtomicBool,
}

impl Updates {
    pub fn new(
        releases_url: String,
        current_version: String,
        config_dir: PathBuf,
        download_dir: PathBuf,
        strategy: Strategy,
        emit: EventSink,
    ) -> Self {
        Self {
            releases_url,
            current_version,
            config_dir,
            download_dir,
            strategy,
            emit,
            installing: AtomicBool::new(false),
        }
    }

    pub fn emit_progress(&self, payload: Value) {
        (self.emit)(PROGRESS_EVENT, payload);
    }

    pub fn emit_available(&self, payload: Value) {
        (self.emit)(AVAILABLE_EVENT, payload);
    }

    pub fn last_check(&self) -> Option<LastCheck> {
        cache::read(&self.config_dir)
    }

    /// Persists `result`; failures only log (the check itself succeeded).
    pub fn remember(&self, result: &CheckResult) {
        let entry = LastCheck {
            checked_at: result.checked_at,
            result: result.to_json(),
        };
        if let Err(error) = cache::write(&self.config_dir, &entry) {
            log::warn!("updates: could not write {}: {error}", cache::FILENAME);
        }
    }

    /// A cached answer an automatic check may reuse: same channel, no error,
    /// younger than the TTL.
    pub fn fresh_cached(&self, channel: Channel, now: u64) -> Option<Value> {
        let cached = self.last_check()?;
        let result: CheckResult = serde_json::from_value(cached.result.clone()).ok()?;
        (result.channel == check::channel_name(channel)
            && result.error_message.is_none()
            && cached.age_ms(now) < AUTOMATIC_CACHE_TTL_MS)
            .then_some(cached.result)
    }

    /// The GitHub-release check for `channel` on this platform.
    pub async fn check_github(&self, channel: Channel, kind: Option<AssetKind>) -> CheckResult {
        check::check_github(self, channel, kind).await
    }
}

/// Which mechanism this build uses; reported as `updateStrategy` in
/// `desktop_get_runtime_info`.
pub fn strategy<R: Runtime>(app: &AppHandle<R>) -> Strategy {
    if signed::is_configured(app) {
        Strategy::TauriSigned
    } else {
        Strategy::GithubRelease
    }
}

fn releases_url() -> String {
    std::env::var("FDE_UPDATE_RELEASES_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| github::RELEASES_URL.to_string())
}

pub fn register(app: &App) -> tauri::Result<()> {
    let config_dir = app.path().app_config_dir()?;
    let download_dir = app.path().app_cache_dir()?.join(DOWNLOAD_DIRNAME);
    let handle = app.handle().clone();
    let emit: EventSink = Arc::new(move |event, payload| {
        if let Err(error) = handle.emit(event, payload) {
            log::warn!("failed to emit {event}: {error}");
        }
    });
    let strategy = strategy(app.handle());
    log::info!(
        "updates: strategy {} (releases {})",
        strategy.as_str(),
        releases_url()
    );
    app.manage(Updates::new(
        releases_url(),
        app.package_info().version.to_string(),
        config_dir,
        download_dir,
        strategy,
        emit,
    ));
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(auto_check_loop(handle));
    Ok(())
}

async fn auto_check_loop<R: Runtime>(app: AppHandle<R>) {
    tokio::time::sleep(AUTO_CHECK_INITIAL_DELAY).await;
    loop {
        if auto_check_enabled(&app) {
            match check(&app, &json!({ "intent": "automatic" })).await {
                Ok(result) => log::info!(
                    "updates: automatic check done (hasUpdate: {})",
                    result["hasUpdate"]
                ),
                Err(error) => log::info!("updates: automatic check skipped: {error}"),
            }
        }
        tokio::time::sleep(AUTO_CHECK_INTERVAL).await;
    }
}

fn settings<R: Runtime>(app: &AppHandle<R>) -> Value {
    app.state::<SettingsStore>().get().unwrap_or(Value::Null)
}

fn auto_check_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    settings(app)["updates"]["autoCheck"] != json!(false)
}

fn channel_for<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Channel {
    match args.get("releaseChannel").and_then(Value::as_str) {
        Some(channel) => Channel::parse(Some(channel)),
        None => Channel::parse(settings(app)["releaseChannel"].as_str()),
    }
}

async fn run_check<R: Runtime>(
    app: &AppHandle<R>,
    updates: &Updates,
    channel: Channel,
) -> CheckResult {
    if updates.strategy == Strategy::TauriSigned {
        match signed::check(app, updates, channel).await {
            Ok(result) => return result,
            Err(error) => {
                log::warn!("updates: signed check failed ({error}); using GitHub releases")
            }
        }
    }
    let kind = InstallContext::detect().asset_kind();
    updates.check_github(channel, kind).await
}

/// `check_app_update {intent?, releaseChannel?}`.
pub async fn check<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Result<Value, String> {
    let updates = app.state::<Updates>();
    let channel = channel_for(app, args);
    let automatic = args.get("intent").and_then(Value::as_str) != Some("manual");
    if automatic {
        if let Some(cached) = updates.fresh_cached(channel, cache::now_ms()) {
            if cached["hasUpdate"] == json!(true) {
                updates.emit_available(cached.clone());
            }
            return Ok(cached);
        }
    }
    let result = run_check(app, &updates, channel).await;
    updates.remember(&result);
    let payload = result.to_json();
    if result.has_update {
        updates.emit_available(payload.clone());
    }
    Ok(payload)
}

/// `install_app_update {releaseChannel?}`: `{installed, version, message,
/// restartRequired}`. Paths that replace the running binary exit the shell
/// shortly after answering.
pub async fn install<R: Runtime>(app: &AppHandle<R>, args: &Value) -> Result<Value, String> {
    let updates = app.state::<Updates>();
    if updates.installing.swap(true, Ordering::SeqCst) {
        return Err("An app update is already being installed.".into());
    }
    let result = run_install(app, &updates, channel_for(app, args)).await;
    updates.installing.store(false, Ordering::SeqCst);
    if let Err(error) = &result {
        log::warn!("updates: install failed: {error}");
        updates.emit_progress(json!({ "phase": "error", "detail": error }));
    }
    result
}

async fn run_install<R: Runtime>(
    app: &AppHandle<R>,
    updates: &Updates,
    channel: Channel,
) -> Result<Value, String> {
    if updates.strategy == Strategy::TauriSigned {
        match signed::install(app, updates).await {
            Ok(Some(result)) => return Ok(result),
            Ok(None) => return Ok(already_latest()),
            Err(error) => {
                log::warn!("updates: signed install failed ({error}); using GitHub releases")
            }
        }
    }
    let context = InstallContext::detect();
    let kind = context
        .asset_kind()
        .ok_or("Automatic updates are not available on this platform.")?;
    let result = updates.check_github(channel, Some(kind)).await;
    updates.remember(&result);
    if let Some(error) = &result.error_message {
        return Err(error.clone());
    }
    if !result.has_update {
        return Ok(already_latest());
    }
    let asset = result
        .asset
        .as_ref()
        .ok_or("No update asset is published for this platform.")?;
    let path = download::download_asset(updates, asset, result.checksum_asset.as_ref()).await?;
    updates
        .emit_progress(json!({ "phase": "install", "received": asset.size, "total": asset.size }));
    let outcome = install::install(kind, &path, &context, &updates.download_dir)?;
    log::info!(
        "updates: {} -> {} via {}: {}",
        updates.current_version,
        result.latest_version,
        kind.as_str(),
        outcome.detail
    );
    let install::InstallOutcome {
        installed,
        restart_required,
        detail,
        exit_app,
        relaunch,
    } = outcome;
    if exit_app {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(EXIT_GRACE).await;
            if let Some(target) = &relaunch {
                if let Err(error) = install::relaunch(target) {
                    log::warn!("updates: {error}");
                }
            }
            log::info!("updates: exiting for update");
            app.exit(0);
        });
    }
    Ok(json!({
        "installed": installed,
        "version": result.latest_version,
        "message": detail,
        "restartRequired": restart_required,
        "installKind": kind.as_str(),
    }))
}

fn already_latest() -> Value {
    json!({
        "installed": false,
        "version": null,
        "message": "You are already on the latest version.",
        "restartRequired": false,
    })
}
