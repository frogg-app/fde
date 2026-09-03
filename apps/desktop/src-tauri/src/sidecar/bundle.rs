//! Where the daemon bundle lives on disk and how it is named. The layout
//! mirrors `deploy/install.sh`: `<app data dir>/daemon/<version>/` holds one
//! unpacked bundle (`node/`, `daemon/`, `bin/`, `manifest.json`) and
//! `<app data dir>/daemon/current` is a text file naming the active version.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const DIRNAME: &str = "daemon";
const CURRENT_MARKER: &str = "current";
pub const RELEASE_BASE: &str = "https://github.com/frogg-app/fde/releases/download";

/// nodejs.org / bundle platform name for the running OS.
pub fn platform_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

/// nodejs.org / bundle architecture name for the running CPU.
pub fn arch_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

fn is_windows() -> bool {
    cfg!(target_os = "windows")
}

/// `fde-daemon-<version>-<platform>-<arch>.tar.gz` (or `.zip` on Windows).
pub fn archive_name(version: &str) -> String {
    let extension = if is_windows() { "zip" } else { "tar.gz" };
    format!(
        "fde-daemon-{version}-{}-{}.{extension}",
        platform_name(),
        arch_name()
    )
}

/// Default download URL of a release bundle. `FDE_DAEMON_BUNDLE_URL` replaces
/// it wholesale (a `file://` or http URL of the archive; the checksum sidecar
/// is that URL plus `.sha256`).
pub fn archive_url(version: &str) -> String {
    if let Some(url) = std::env::var("FDE_DAEMON_BUNDLE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
    {
        return url;
    }
    format!("{RELEASE_BASE}/v{version}/{}", archive_name(version))
}

/// An unpacked bundle directory that passed the layout check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledBundle {
    pub version: String,
    pub dir: PathBuf,
}

impl InstalledBundle {
    /// `node/bin/node` (unix) or `node/node.exe` (Windows).
    pub fn node_binary(&self) -> PathBuf {
        node_binary_in(&self.dir)
    }

    /// The CLI entrypoint the launcher scripts run.
    pub fn cli_entry(&self) -> PathBuf {
        cli_entry_in(&self.dir)
    }

    /// `bin/fde` (or `bin/fde.cmd`): what the daemon gets as `PASEO_CLI`.
    pub fn launcher(&self) -> PathBuf {
        self.dir
            .join("bin")
            .join(if is_windows() { "fde.cmd" } else { "fde" })
    }
}

fn node_binary_in(dir: &Path) -> PathBuf {
    if is_windows() {
        dir.join("node").join("node.exe")
    } else {
        dir.join("node").join("bin").join("node")
    }
}

fn cli_entry_in(dir: &Path) -> PathBuf {
    dir.join("daemon")
        .join("apps")
        .join("cli")
        .join("dist")
        .join("index.js")
}

/// Reads `manifest.json` and checks the files the shell needs exist.
pub fn validate_bundle_dir(dir: &Path) -> Result<String, String> {
    let manifest_path = dir.join("manifest.json");
    let manifest: Value = fs::read_to_string(&manifest_path)
        .map_err(|e| {
            format!(
                "bundle manifest {} unreadable: {e}",
                manifest_path.display()
            )
        })
        .and_then(|raw| {
            serde_json::from_str(&raw).map_err(|e| format!("bundle manifest invalid: {e}"))
        })?;
    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|v| !v.trim().is_empty())
        .ok_or("bundle manifest has no version")?
        .to_string();
    let platform = manifest
        .get("platform")
        .and_then(Value::as_str)
        .unwrap_or("");
    let arch = manifest.get("arch").and_then(Value::as_str).unwrap_or("");
    if platform != platform_name() || arch != arch_name() {
        return Err(format!(
            "bundle is for {platform}-{arch}, this machine is {}-{}",
            platform_name(),
            arch_name()
        ));
    }
    for required in [node_binary_in(dir), cli_entry_in(dir)] {
        if !required.is_file() {
            return Err(format!("bundle is missing {}", required.display()));
        }
    }
    Ok(version)
}

/// Bundle store rooted at `<app data dir>/daemon`.
#[derive(Debug, Clone)]
pub struct BundleStore {
    root: PathBuf,
}

impl BundleStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            root: app_data_dir.join(DIRNAME),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn version_dir(&self, version: &str) -> PathBuf {
        self.root.join(version)
    }

    fn current_marker(&self) -> PathBuf {
        self.root.join(CURRENT_MARKER)
    }

    /// The active bundle, if the marker names a directory that validates.
    pub fn installed(&self) -> Option<InstalledBundle> {
        let version = fs::read_to_string(self.current_marker()).ok()?;
        let version = version.trim();
        if version.is_empty() || version.contains(['/', '\\']) || version.starts_with('.') {
            return None;
        }
        let dir = self.version_dir(version);
        match validate_bundle_dir(&dir) {
            Ok(_) => Some(InstalledBundle {
                version: version.to_string(),
                dir,
            }),
            Err(error) => {
                log::warn!(
                    "sidecar: current bundle {version} at {} is unusable: {error}",
                    dir.display()
                );
                None
            }
        }
    }

    /// Atomically points `current` at `version` (write a temp file, rename).
    pub fn set_current(&self, version: &str) -> Result<(), String> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let temp = self
            .root
            .join(format!("{CURRENT_MARKER}.tmp.{}", std::process::id()));
        fs::write(&temp, format!("{version}\n")).map_err(|e| e.to_string())?;
        fs::rename(&temp, self.current_marker()).map_err(|e| e.to_string())
    }

    /// Removes installed versions other than `keep` (best effort).
    pub fn prune_except(&self, keep: &str) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if entry.path().is_dir() && name != keep && !name.starts_with('.') {
                log::info!("sidecar: pruning old bundle {}", entry.path().display());
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// `local_daemon_bundle_status` payload.
pub fn status_json(store: &BundleStore, downloading: Option<(u64, Option<u64>)>) -> Value {
    let mut status = json!({
        "installed": false,
        "platform": platform_name(),
        "arch": arch_name(),
    });
    if let Some(bundle) = store.installed() {
        status["installed"] = json!(true);
        status["version"] = json!(bundle.version);
        status["path"] = json!(bundle.dir.to_string_lossy());
    }
    if let Some((received, total)) = downloading {
        status["downloading"] = json!({ "received": received, "total": total });
    }
    status
}

#[cfg(test)]
pub(crate) fn write_fake_bundle(dir: &Path, version: &str) {
    fs::create_dir_all(dir.join("bin")).unwrap();
    fs::create_dir_all(dir.join("daemon/apps/cli/dist")).unwrap();
    fs::write(dir.join("daemon/apps/cli/dist/index.js"), "// cli").unwrap();
    let node = node_binary_in(dir);
    fs::create_dir_all(node.parent().unwrap()).unwrap();
    fs::write(&node, "").unwrap();
    fs::write(
        dir.join("manifest.json"),
        json!({ "version": version, "platform": platform_name(), "arch": arch_name() }).to_string(),
    )
    .unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_release_convention() {
        let name = archive_name("0.1.6");
        assert!(name.starts_with("fde-daemon-0.1.6-"));
        assert!(name.ends_with(".tar.gz") || name.ends_with(".zip"));
        assert!(archive_url("0.1.6")
            .starts_with("https://github.com/frogg-app/fde/releases/download/v0.1.6/"));
    }

    #[test]
    fn detects_installed_bundle_through_marker() {
        let dir = tempfile::tempdir().unwrap();
        let store = BundleStore::new(dir.path().to_path_buf());
        assert!(store.installed().is_none());
        assert_eq!(status_json(&store, None)["installed"], false);

        write_fake_bundle(&store.version_dir("1.2.3"), "1.2.3");
        assert!(store.installed().is_none(), "no marker yet");
        store.set_current("1.2.3").unwrap();
        let installed = store.installed().unwrap();
        assert_eq!(installed.version, "1.2.3");
        assert!(installed.node_binary().is_file());
        assert!(installed.cli_entry().is_file());
        let status = status_json(&store, Some((5, Some(10))));
        assert_eq!(status["installed"], true);
        assert_eq!(status["version"], "1.2.3");
        assert_eq!(status["downloading"]["received"], 5);
    }

    #[test]
    fn rejects_wrong_platform_and_traversal_markers() {
        let dir = tempfile::tempdir().unwrap();
        let store = BundleStore::new(dir.path().to_path_buf());
        write_fake_bundle(&store.version_dir("9"), "9");
        fs::write(
            store.version_dir("9").join("manifest.json"),
            json!({ "version": "9", "platform": "plan9", "arch": arch_name() }).to_string(),
        )
        .unwrap();
        store.set_current("9").unwrap();
        assert!(store.installed().is_none());
        store.set_current("../9").unwrap();
        assert!(store.installed().is_none());
    }

    #[test]
    fn prunes_other_versions() {
        let dir = tempfile::tempdir().unwrap();
        let store = BundleStore::new(dir.path().to_path_buf());
        write_fake_bundle(&store.version_dir("1"), "1");
        write_fake_bundle(&store.version_dir("2"), "2");
        store.set_current("2").unwrap();
        store.prune_except("2");
        assert!(!store.version_dir("1").exists());
        assert!(store.version_dir("2").exists());
        assert!(store.installed().is_some());
    }
}
