//! Installing a bundle: download the archive and its `.sha256`, verify,
//! extract into a staging directory, validate, rename into place, flip the
//! `current` marker. Progress reaches the webview as
//! `paseo:event:local-daemon-install-event`.

use std::fs;
use std::path::Path;

use serde_json::json;

use super::archive::extract_bundle;
use super::bundle::{archive_url, validate_bundle_dir, InstalledBundle};
use super::download::{fetch_text, fetch_to_file, verify_checksum};
use super::Sidecar;

const PROGRESS_STEP_BYTES: u64 = 512 * 1024;
const DOWNLOAD_DIRNAME: &str = ".download";

fn archive_file_name(url: &str, version: &str) -> String {
    let tail = url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    if tail.ends_with(".zip") || tail.ends_with(".tar.gz") || tail.ends_with(".tgz") {
        tail.to_string()
    } else {
        super::bundle::archive_name(version)
    }
}

/// Installs the bundle at `url` (checksum at `url + ".sha256"`). `version`
/// only names the download; the manifest inside the archive is authoritative.
pub async fn install_from_url(
    sidecar: &Sidecar,
    url: &str,
    version: &str,
) -> Result<InstalledBundle, String> {
    let result = run_install(sidecar, url, version).await;
    sidecar.set_progress(None);
    match &result {
        Ok(bundle) => {
            log::info!(
                "sidecar: installed bundle {} at {}",
                bundle.version,
                bundle.dir.display()
            );
            sidecar.emit_install_event(json!({ "kind": "done", "version": bundle.version }));
        }
        Err(error) => {
            log::warn!("sidecar: install failed: {error}");
            sidecar.emit_install_event(json!({ "kind": "error", "detail": error }));
        }
    }
    result
}

/// Installs the release bundle for `version` (or `FDE_DAEMON_BUNDLE_URL`).
pub async fn install_version(sidecar: &Sidecar, version: &str) -> Result<InstalledBundle, String> {
    install_from_url(sidecar, &archive_url(version), version).await
}

async fn run_install(
    sidecar: &Sidecar,
    url: &str,
    version: &str,
) -> Result<InstalledBundle, String> {
    let root = sidecar.store.root().to_path_buf();
    let download_dir = root.join(DOWNLOAD_DIRNAME);
    let archive_path = download_dir.join(archive_file_name(url, version));
    let checksum_url = format!("{url}.sha256");
    log::info!("sidecar: installing bundle {version} from {url}");

    sidecar.set_progress(Some((0, None)));
    sidecar.emit_install_event(
        json!({ "kind": "progress", "received": 0, "total": null, "detail": "checksum" }),
    );
    let checksum = fetch_text(&checksum_url)
        .await
        .map_err(|e| format!("checksum download failed ({checksum_url}): {e}"))?;

    let mut last_emitted = 0u64;
    let mut on_progress = |received: u64, total: Option<u64>| {
        sidecar.set_progress(Some((received, total)));
        if received == 0
            || received - last_emitted >= PROGRESS_STEP_BYTES
            || Some(received) == total
        {
            last_emitted = received;
            sidecar.emit_install_event(json!({ "kind": "progress", "received": received, "total": total, "detail": "download" }));
        }
    };
    fetch_to_file(url, &archive_path, &mut on_progress)
        .await
        .map_err(|e| format!("bundle download failed ({url}): {e}"))?;
    let archive_size = fs::metadata(&archive_path).map(|m| m.len()).unwrap_or(0);
    log::info!(
        "sidecar: downloaded {} ({archive_size} bytes), verifying",
        archive_path.display()
    );
    verify_checksum(&archive_path, &checksum)?;

    sidecar.emit_install_event(json!({ "kind": "progress", "received": archive_size, "total": archive_size, "detail": "extract" }));
    let staging = root.join(format!(".staging-{version}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    let installed = extract_and_activate(sidecar, &archive_path, &staging).await;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&download_dir);
    installed
}

async fn extract_and_activate(
    sidecar: &Sidecar,
    archive_path: &Path,
    staging: &Path,
) -> Result<InstalledBundle, String> {
    let archive = archive_path.to_path_buf();
    let staging_dir = staging.to_path_buf();
    tokio::task::spawn_blocking(move || extract_bundle(&archive, &staging_dir))
        .await
        .map_err(|e| e.to_string())??;
    let manifest_version = validate_bundle_dir(staging)?;
    let target = sidecar.store.version_dir(&manifest_version);
    if target.exists() {
        log::info!(
            "sidecar: replacing existing bundle directory {}",
            target.display()
        );
        fs::remove_dir_all(&target).map_err(|e| format!("remove {}: {e}", target.display()))?;
    }
    fs::rename(staging, &target)
        .map_err(|e| format!("move bundle into place ({}): {e}", target.display()))?;
    sidecar.store.set_current(&manifest_version)?;
    sidecar.store.prune_except(&manifest_version);
    Ok(InstalledBundle {
        version: manifest_version,
        dir: target,
    })
}

#[cfg(test)]
mod tests {
    use super::super::archive::tests::make_tar_gz;
    use super::super::bundle::{arch_name, platform_name};
    use super::super::download::sha256_of_file;
    use super::super::Sidecar;
    use super::*;
    use std::sync::{Arc, Mutex};

    fn fake_bundle_archive(dir: &Path, version: &str) -> String {
        let manifest =
            json!({ "version": version, "platform": platform_name(), "arch": arch_name() })
                .to_string();
        let node = if cfg!(windows) {
            "b/node/node.exe"
        } else {
            "b/node/bin/node"
        };
        let archive = dir.join(format!("fde-daemon-{version}-test.tar.gz"));
        make_tar_gz(
            &archive,
            &[
                ("b/manifest.json", manifest.as_bytes()),
                (node, b""),
                ("b/daemon/apps/cli/dist/index.js", b"//"),
            ],
        );
        let digest = sha256_of_file(&archive).unwrap();
        fs::write(
            format!("{}.sha256", archive.display()),
            format!("{digest}  x\n"),
        )
        .unwrap();
        url::Url::from_file_path(&archive).unwrap().to_string()
    }

    #[tokio::test]
    async fn installs_from_file_url_and_emits_events() {
        let dir = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let sidecar = Sidecar::new(
            dir.path().join("data"),
            Arc::new(move |event| sink.lock().unwrap().push(event)),
        );
        let url = fake_bundle_archive(dir.path(), "3.2.1");

        let installed = install_from_url(&sidecar, &url, "3.2.1").await.unwrap();
        assert_eq!(installed.version, "3.2.1");
        assert_eq!(sidecar.store.installed(), Some(installed.clone()));
        assert!(!sidecar.store.root().join(DOWNLOAD_DIRNAME).exists());
        let kinds: Vec<String> = events
            .lock()
            .unwrap()
            .iter()
            .map(|e| e["kind"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(kinds.first().map(String::as_str), Some("progress"));
        assert_eq!(kinds.last().map(String::as_str), Some("done"));
        assert!(sidecar.progress().is_none());

        // Re-installing the same version replaces the directory in place.
        install_from_url(&sidecar, &url, "3.2.1").await.unwrap();
        assert!(sidecar.store.installed().is_some());
    }

    #[tokio::test]
    async fn rejects_checksum_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let sidecar = Sidecar::new(
            dir.path().join("data"),
            Arc::new(move |event| sink.lock().unwrap().push(event)),
        );
        let url = fake_bundle_archive(dir.path(), "1.0.0");
        let sidecar_path = dir.path().join("fde-daemon-1.0.0-test.tar.gz.sha256");
        fs::write(&sidecar_path, format!("{}  x\n", "0".repeat(64))).unwrap();

        let error = install_from_url(&sidecar, &url, "1.0.0").await.unwrap_err();
        assert!(error.contains("checksum mismatch"), "{error}");
        assert!(sidecar.store.installed().is_none());
        assert_eq!(events.lock().unwrap().last().unwrap()["kind"], "error");
    }

    #[test]
    fn names_archive_from_url_or_convention() {
        assert_eq!(
            archive_file_name("http://x/y/fde-daemon-1-linux-x64.tar.gz?a=1", "1"),
            "fde-daemon-1-linux-x64.tar.gz"
        );
        assert_eq!(
            archive_file_name("http://x/latest", "1"),
            super::super::bundle::archive_name("1")
        );
    }
}
