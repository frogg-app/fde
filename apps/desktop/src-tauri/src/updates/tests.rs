//! Drives the GitHub-release check and the asset download against a tiny
//! HTTP server on a loopback port: no network, no GitHub.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::assets::AssetKind;
use super::check::AssetInfo;
use super::download::download_asset;
use super::release::Channel;
use super::{Strategy, Updates};
use crate::sidecar::download::sha256_of_file;

const PAYLOAD: &[u8] = b"not really a deb, but 40 bytes of payload!!";

struct FakeGithub {
    base: String,
    releases_status: u16,
}

fn payload_digest() -> String {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p");
    std::fs::write(&path, PAYLOAD).unwrap();
    sha256_of_file(&path).unwrap()
}

fn releases_json(base: &str) -> String {
    let asset = |name: &str, size: usize| json!({ "name": name, "size": size, "browser_download_url": format!("{base}/dl/{name}") });
    json!([
        { "tag_name": "v9.9.9", "draft": false, "prerelease": true, "body": "## Notes\n\n- faster",
          "published_at": "2026-09-01T00:00:00Z", "html_url": format!("{base}/rel/9.9.9"),
          "assets": [
            asset("FDE-9.9.9-linux-x86_64.deb", PAYLOAD.len()),
            asset("FDE-9.9.9-linux-x86_64.deb.sha256", 80),
            asset("FDE-9.9.9-linux-x86_64.AppImage", PAYLOAD.len()),
            asset("FDE-9.9.9-win-x64-setup.zip", PAYLOAD.len()),
            asset("FDE-9.9.9-win-x64-portable.zip", PAYLOAD.len()),
            asset("FDE-9.9.9-mac-aarch64.dmg", PAYLOAD.len()),
            asset("FDE-9.9.9-mac-x86_64.dmg", PAYLOAD.len()),
          ] },
        { "tag_name": "v10.0.0-beta.1", "draft": false, "prerelease": true, "assets": [
            asset("FDE-10.0.0-beta.1-linux-x86_64.deb", PAYLOAD.len()) ] },
        { "tag_name": "v11.0.0", "draft": true, "prerelease": false, "assets": [] },
        { "tag_name": "v0.0.1", "draft": false, "prerelease": true, "assets": [] }
    ])
    .to_string()
}

/// Serves `/releases`, `/dl/<asset>` and `/dl/<asset>.sha256` until dropped.
fn serve(releases_status: u16, checksum: String) -> FakeGithub {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let base_for_thread = base.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read]).to_string();
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/")
                .to_string();
            let (status, content_type, body): (u16, &str, Vec<u8>) =
                if path.starts_with("/releases") {
                    let ua_ok = request
                        .lines()
                        .any(|l| l.to_ascii_lowercase().starts_with("user-agent: fde/"));
                    if !ua_ok {
                        (400, "text/plain", b"missing FDE user agent".to_vec())
                    } else if releases_status == 200 {
                        (
                            200,
                            "application/json",
                            releases_json(&base_for_thread).into_bytes(),
                        )
                    } else {
                        (releases_status, "text/plain", b"nope".to_vec())
                    }
                } else if path.ends_with(".sha256") {
                    (
                        200,
                        "text/plain",
                        format!("{checksum}  asset\n").into_bytes(),
                    )
                } else if path.starts_with("/dl/") {
                    (200, "application/octet-stream", PAYLOAD.to_vec())
                } else {
                    (404, "text/plain", b"not found".to_vec())
                };
            let reason = match status {
                200 => "OK",
                400 => "Bad Request",
                404 => "Not Found",
                _ => "Error",
            };
            let head = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    FakeGithub {
        base,
        releases_status,
    }
}

fn updates(
    server: &FakeGithub,
    dir: &std::path::Path,
    events: Arc<Mutex<Vec<(String, Value)>>>,
) -> Updates {
    let sink = events.clone();
    Updates::new(
        format!("{}/releases", server.base),
        "0.1.0".into(),
        dir.join("config"),
        dir.join("cache").join("updates"),
        Strategy::GithubRelease,
        Arc::new(move |event, payload| sink.lock().unwrap().push((event.to_string(), payload))),
    )
}

#[tokio::test]
async fn check_finds_the_newest_release_and_maps_the_platform_asset() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events);
    assert_eq!(server.releases_status, 200);

    let result = updates
        .check_github(Channel::Stable, Some(AssetKind::LinuxDeb))
        .await;
    assert_eq!(result.error_message, None);
    assert!(result.has_update && result.ready_to_install);
    assert_eq!(result.latest_version, "9.9.9");
    assert_eq!(result.current_version, "0.1.0");
    assert_eq!(result.notes.as_deref(), Some("## Notes\n\n- faster"));
    assert_eq!(result.install_kind.as_deref(), Some("linux-deb"));
    assert_eq!(result.channel, "stable");
    assert_eq!(result.strategy, "github-release");
    let asset = result.asset.clone().unwrap();
    assert_eq!(asset.name, "FDE-9.9.9-linux-x86_64.deb");
    assert_eq!(asset.size as usize, PAYLOAD.len());
    assert_eq!(
        result.checksum_asset.as_ref().map(|a| a.name.as_str()),
        Some("FDE-9.9.9-linux-x86_64.deb.sha256")
    );
    assert_eq!(result.assets.len(), 7);

    // Beta channel prefers the prerelease above 9.9.9; the draft stays hidden.
    let beta = updates
        .check_github(Channel::Beta, Some(AssetKind::LinuxDeb))
        .await;
    assert_eq!(beta.latest_version, "10.0.0-beta.1");
    assert_eq!(
        beta.asset.map(|a| a.name),
        Some("FDE-10.0.0-beta.1-linux-x86_64.deb".into())
    );

    // A platform whose asset is missing still reports the version, but not ready.
    let mac = updates
        .check_github(Channel::Beta, Some(AssetKind::MacDmg))
        .await;
    assert!(mac.has_update && !mac.ready_to_install);
    assert!(mac.error_message.unwrap().contains("FDE-10.0.0-beta.1-"));

    // Results from a previous binary cannot keep advertising an installed update.
    let mut previous = result.clone();
    previous.current_version = "0.0.9".into();
    updates.remember(&previous);
    assert!(updates
        .fresh_cached(Channel::Stable, result.checked_at)
        .is_none());

    // The cache round-trips through the JSON shape and answers automatic checks.
    updates.remember(&result);
    let cached = updates
        .fresh_cached(Channel::Stable, result.checked_at + 1000)
        .unwrap();
    assert_eq!(cached["latestVersion"], "9.9.9");
    assert!(updates
        .fresh_cached(Channel::Beta, result.checked_at)
        .is_none());
    assert!(updates
        .fresh_cached(Channel::Stable, result.checked_at + 31 * 60 * 1000)
        .is_none());
}

#[tokio::test]
async fn check_reports_server_errors_in_band() {
    let server = serve(500, String::new());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events);
    let result = updates
        .check_github(Channel::Stable, Some(AssetKind::LinuxDeb))
        .await;
    assert!(!result.has_update);
    assert_eq!(result.latest_version, "0.1.0");
    let error = result.error_message.clone().unwrap();
    assert!(error.contains("HTTP 500"), "{error}");
    updates.remember(&result);
    assert!(
        updates
            .fresh_cached(Channel::Stable, result.checked_at)
            .is_none(),
        "errors are not reused"
    );

    let unreachable = Updates::new(
        "http://127.0.0.1:1/releases".into(),
        "0.1.0".into(),
        dir.path().join("c"),
        dir.path().join("d"),
        Strategy::GithubRelease,
        Arc::new(|_, _| {}),
    );
    let result = unreachable.check_github(Channel::Stable, None).await;
    assert!(result
        .error_message
        .unwrap()
        .contains("release check failed"));
}

#[tokio::test]
async fn download_verifies_checksum_and_emits_progress() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events.clone());
    let result = updates
        .check_github(Channel::Stable, Some(AssetKind::LinuxDeb))
        .await;
    let asset = result.asset.clone().unwrap();

    let path = download_asset(&updates, &asset, result.checksum_asset.as_ref())
        .await
        .unwrap();
    assert_eq!(
        path,
        updates.download_dir.join("FDE-9.9.9-linux-x86_64.deb")
    );
    assert_eq!(std::fs::read(&path).unwrap(), PAYLOAD);
    let events = events.lock().unwrap();
    assert!(events.iter().all(|(name, _)| name == super::PROGRESS_EVENT));
    let phases: Vec<&str> = events
        .iter()
        .map(|(_, p)| p["phase"].as_str().unwrap())
        .collect();
    assert_eq!(phases.first(), Some(&"download"));
    assert_eq!(phases.last(), Some(&"verify"));
    let last_download = events
        .iter()
        .rev()
        .find(|(_, p)| p["phase"] == "download")
        .unwrap();
    assert_eq!(
        last_download.1["received"].as_u64(),
        Some(PAYLOAD.len() as u64)
    );
    assert_eq!(
        last_download.1["total"].as_u64(),
        Some(PAYLOAD.len() as u64)
    );
}

#[tokio::test]
async fn download_rejects_a_checksum_mismatch_and_a_missing_sidecar_is_tolerated() {
    let server = serve(200, "0".repeat(64));
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events);
    let asset = AssetInfo {
        name: "FDE-9.9.9-linux-x86_64.deb".into(),
        size: PAYLOAD.len() as u64,
        url: format!("{}/dl/FDE-9.9.9-linux-x86_64.deb", server.base),
    };
    let checksum = AssetInfo {
        name: "FDE-9.9.9-linux-x86_64.deb.sha256".into(),
        size: 80,
        url: format!("{}/dl/FDE-9.9.9-linux-x86_64.deb.sha256", server.base),
    };
    let error = download_asset(&updates, &asset, Some(&checksum))
        .await
        .unwrap_err();
    assert!(error.contains("checksum mismatch"), "{error}");

    let path = download_asset(&updates, &asset, None).await.unwrap();
    assert_eq!(std::fs::read(path).unwrap(), PAYLOAD);
}

#[tokio::test]
async fn automatic_cached_check_does_not_reemit_available_to_its_listener() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events.clone());

    // The background check notifies the UI after persisting an available update.
    let fresh = updates
        .check_with(
            Channel::Stable,
            true,
            updates.check_github(Channel::Stable, Some(AssetKind::LinuxDeb)),
        )
        .await;
    assert_eq!(fresh["hasUpdate"], true);
    assert_eq!(
        events.lock().unwrap().drain(..).collect::<Vec<_>>(),
        vec![(super::AVAILABLE_EVENT.to_string(), fresh.clone())]
    );

    // The UI's available-event listener asks for the cached result. Re-emitting
    // here schedules that listener again, creating an unbounded IPC/event loop.
    let cached = updates
        .check_with(Channel::Stable, true, async {
            panic!("the listener's automatic check must reuse the fresh cache")
        })
        .await;
    assert_eq!(cached, fresh);
    assert!(
        events.lock().unwrap().is_empty(),
        "reading cached availability must not notify its listener again"
    );

    // A manual check still bypasses that cache and notifies exactly once.
    let manual = updates
        .check_with(
            Channel::Stable,
            false,
            updates.check_github(Channel::Stable, Some(AssetKind::LinuxDeb)),
        )
        .await;
    assert_eq!(manual["hasUpdate"], true);
    assert_eq!(
        *events.lock().unwrap(),
        vec![(super::AVAILABLE_EVENT.to_string(), manual)]
    );
}

#[tokio::test]
async fn missing_platform_asset_returns_error_without_availability_event() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events.clone());

    // The newest beta has only a Linux asset. Neither manual nor automatic
    // checks may announce an error result that their listener cannot cache.
    for automatic in [false, true] {
        let result = updates
            .check_with(
                Channel::Beta,
                automatic,
                updates.check_github(Channel::Beta, Some(AssetKind::WindowsInstaller)),
            )
            .await;
        assert_eq!(result["hasUpdate"], true);
        assert_eq!(result["readyToInstall"], false);
        assert!(result["errorMessage"]
            .as_str()
            .unwrap()
            .contains("has no FDE-10.0.0-beta.1-win-x64-setup.zip"));
        assert!(updates
            .fresh_cached(Channel::Beta, super::cache::now_ms())
            .is_none());
        assert!(
            events.lock().unwrap().is_empty(),
            "an uncacheable error must not trigger the availability listener"
        );
    }
}

#[tokio::test]
async fn automatic_check_reuses_memory_when_persisting_cache_fails() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let updates = updates(&server, dir.path(), events.clone());
    // A file where the config directory belongs makes persistence fail on all
    // platforms, including tests run with elevated filesystem privileges.
    std::fs::write(&updates.config_dir, b"not a directory").unwrap();
    let fresh = updates
        .check_with(
            Channel::Stable,
            true,
            updates.check_github(Channel::Stable, Some(AssetKind::LinuxDeb)),
        )
        .await;
    assert_eq!(fresh["hasUpdate"], true);
    assert_eq!(fresh["errorMessage"], Value::Null);
    assert_eq!(
        events.lock().unwrap().drain(..).collect::<Vec<_>>(),
        vec![(super::AVAILABLE_EVENT.to_string(), fresh.clone())]
    );
    assert!(super::cache::read(&updates.config_dir).is_none());
    let cached = updates
        .check_with(Channel::Stable, true, async {
            panic!("failed disk persistence must not force the availability listener to refetch")
        })
        .await;
    assert_eq!(cached, fresh);
    assert!(events.lock().unwrap().is_empty());
    assert_eq!(updates.last_check().unwrap().result, fresh);
}

#[tokio::test]
async fn updates_loads_last_check_from_disk_once_at_startup() {
    let server = serve(200, payload_digest());
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let first = updates(&server, dir.path(), events.clone());
    let result = first
        .check_github(Channel::Stable, Some(AssetKind::LinuxDeb))
        .await;
    first.remember(&result);

    let restarted = updates(&server, dir.path(), events.clone());
    assert_eq!(restarted.last_check(), first.last_check());
    std::fs::remove_file(super::cache::cache_path(&restarted.config_dir)).unwrap();
    let cached = restarted
        .check_with(Channel::Stable, true, async {
            panic!("a loaded cache must not depend on subsequent disk reads")
        })
        .await;
    assert_eq!(cached, result.to_json());
    assert!(events.lock().unwrap().is_empty());
}
