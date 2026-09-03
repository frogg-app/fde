//! Local sidecar daemon (milestone 3): an FDE daemon bundle downloaded from
//! GitHub releases into the app data dir and supervised the way Electron
//! supervised its packaged daemon. See `docs/desktop-shell.md`.

pub mod archive;
pub mod bundle;
pub mod cli;
pub mod download;
#[cfg(all(test, unix))]
mod e2e;
pub mod install;
pub mod lifecycle;
pub mod status;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{App, AppHandle, Emitter, Manager, Runtime};

use crate::commands::settings::SettingsStore;
use bundle::BundleStore;
pub use lifecycle::{LaunchConfig, NOT_INSTALLED};

pub const INSTALL_EVENT: &str = "paseo:event:local-daemon-install-event";
pub const DEFAULT_PORT: u16 = 9999;

pub type EventSink = Arc<dyn Fn(Value) + Send + Sync>;

/// Shared sidecar state: the bundle store, the install progress and a lock
/// that serialises lifecycle operations.
pub struct Sidecar {
    pub store: BundleStore,
    emit: EventSink,
    progress: Mutex<Option<(u64, Option<u64>)>>,
    installing: AtomicBool,
    pub lifecycle: tokio::sync::Mutex<()>,
}

impl Sidecar {
    pub fn new(app_data_dir: PathBuf, emit: EventSink) -> Self {
        Self {
            store: BundleStore::new(app_data_dir),
            emit,
            progress: Mutex::new(None),
            installing: AtomicBool::new(false),
            lifecycle: tokio::sync::Mutex::new(()),
        }
    }

    pub fn emit_install_event(&self, payload: Value) {
        (self.emit)(payload);
    }

    pub fn set_progress(&self, progress: Option<(u64, Option<u64>)>) {
        *self.progress.lock().unwrap() = progress;
    }

    pub fn progress(&self) -> Option<(u64, Option<u64>)> {
        *self.progress.lock().unwrap()
    }

    /// `local_daemon_bundle_status`.
    pub fn bundle_status(&self) -> Value {
        bundle::status_json(&self.store, self.progress())
    }

    /// `install_local_daemon_bundle {version?}`: one install at a time.
    pub async fn install(&self, version: &str) -> Result<Value, String> {
        if self.installing.swap(true, Ordering::SeqCst) {
            return Err("A local daemon install is already in progress.".into());
        }
        let result = install::install_version(self, version).await;
        self.installing.store(false, Ordering::SeqCst);
        result.map(|_| self.bundle_status())
    }
}

pub fn register(app: &App) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    let handle = app.handle().clone();
    let emit: EventSink = Arc::new(move |payload| {
        if let Err(error) = handle.emit(INSTALL_EVENT, payload) {
            log::warn!("failed to emit install event: {error}");
        }
    });
    let sidecar = Sidecar::new(data_dir, emit);
    match sidecar.store.installed() {
        Some(bundle) => log::info!(
            "sidecar: bundle {} installed at {}",
            bundle.version,
            bundle.dir.display()
        ),
        None => log::info!(
            "sidecar: no daemon bundle installed (store {})",
            sidecar.store.root().display()
        ),
    }
    app.manage(sidecar);
    Ok(())
}

/// `$FDE_HOME`, the legacy `$PASEO_HOME`, or `~/.fde`, as the daemon resolves it.
pub fn paseo_home<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    for key in ["FDE_HOME", "PASEO_HOME"] {
        if let Ok(home) = std::env::var(key) {
            if !home.trim().is_empty() {
                return PathBuf::from(home);
            }
        }
    }
    app.path()
        .home_dir()
        .map(|dir| dir.join(".fde"))
        .unwrap_or_default()
}

fn daemon_settings<R: Runtime>(app: &AppHandle<R>) -> Value {
    app.state::<SettingsStore>()
        .get()
        .ok()
        .and_then(|settings| settings.get("daemon").cloned())
        .unwrap_or(Value::Null)
}

/// Listen address for a managed daemon: loopback on the configured port
/// (`daemon.port` in desktop settings when present, else 9999).
pub fn launch_config<R: Runtime>(app: &AppHandle<R>) -> LaunchConfig {
    let daemon = daemon_settings(app);
    let port = daemon
        .get("port")
        .and_then(Value::as_u64)
        .filter(|p| (1..=65535).contains(p))
        .unwrap_or(DEFAULT_PORT as u64);
    LaunchConfig {
        home: paseo_home(app),
        listen: format!("127.0.0.1:{port}"),
        manage_enabled: daemon.get("manageBuiltInDaemon") == Some(&json!(true)),
    }
}

/// Hooked into Tauri's exit path from `lib.rs`.
pub fn stop_on_exit<R: Runtime>(app: &AppHandle<R>) {
    let keep_running = daemon_settings(app).get("keepRunningAfterQuit") == Some(&json!(true));
    let sidecar = app.state::<Sidecar>();
    lifecycle::stop_on_exit(&sidecar, &paseo_home(app), keep_running);
}
