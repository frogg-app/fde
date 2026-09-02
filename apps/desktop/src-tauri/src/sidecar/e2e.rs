//! End-to-end: install a real linux bundle from a `file://` URL, start the
//! daemon on a spare port with a scratch `PASEO_HOME`, check the status the
//! UI would see, stop it. Needs `npm run build:daemon-bundle -- --target
//! linux-x64` to have produced `dist/bundles/fde-daemon-<version>-linux-x64.tar.gz`
//! (or `FDE_TEST_DAEMON_BUNDLE=<path>`); skips otherwise.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use super::install::install_from_url;
use super::lifecycle::{self, LaunchConfig};
use super::status::DaemonState;
use super::Sidecar;

fn bundle_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FDE_TEST_DAEMON_BUNDLE") {
        return Some(PathBuf::from(path));
    }
    let repo_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let candidate = repo_root.join("dist/bundles").join(format!(
        "fde-daemon-{}-linux-x64.tar.gz",
        env!("CARGO_PKG_VERSION")
    ));
    candidate.is_file().then_some(candidate)
}

fn test_port() -> u16 {
    std::env::var("FDE_TEST_SIDECAR_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(6799)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn installs_starts_and_stops_a_real_bundle() {
    if cfg!(not(target_os = "linux")) || cfg!(not(target_arch = "x86_64")) {
        eprintln!("sidecar e2e: linux-x64 only, skipping");
        return;
    }
    let Some(bundle) = bundle_path() else {
        eprintln!("sidecar e2e: no linux-x64 bundle in dist/bundles, skipping");
        return;
    };
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let sidecar = Sidecar::new(
        dir.path().join("data"),
        Arc::new(move |event| sink.lock().unwrap().push(event)),
    );
    let url = url::Url::from_file_path(bundle.canonicalize().unwrap())
        .unwrap()
        .to_string();

    let installed = install_from_url(&sidecar, &url, env!("CARGO_PKG_VERSION"))
        .await
        .expect("install");
    assert!(installed.node_binary().is_file());
    assert!(installed.cli_entry().is_file());
    assert_eq!(events.lock().unwrap().last().unwrap()["kind"], "done");

    let home = dir.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let config = LaunchConfig {
        home: home.clone(),
        listen: format!("127.0.0.1:{}", test_port()),
        manage_enabled: true,
    };

    let before = lifecycle::resolve_status(Some(&installed), &home).await;
    assert_eq!(before.status, DaemonState::Stopped, "{}", before.summary());
    assert_eq!(before.error, None);

    let started = lifecycle::start(&sidecar, &config).await.expect("start");
    assert_eq!(
        started.status,
        DaemonState::Running,
        "{}",
        started.summary()
    );
    assert!(started.desktop_managed, "{}", started.summary());
    assert!(started.pid.is_some());
    assert!(!started.server_id.is_empty());
    assert_eq!(started.listen.as_deref(), Some(config.listen.as_str()));
    assert_eq!(started.version.as_deref(), Some(installed.version.as_str()));
    assert!(lifecycle::pid_file_is_desktop_managed(&home));

    // A second start is idempotent (same version, already running).
    let again = lifecycle::start(&sidecar, &config)
        .await
        .expect("start again");
    assert_eq!(again.pid, started.pid);

    let stopped = lifecycle::stop(&sidecar, &home, "manual_ipc")
        .await
        .expect("stop");
    assert_eq!(
        stopped.status,
        DaemonState::Stopped,
        "{}",
        stopped.summary()
    );
    assert!(home.join(lifecycle::DAEMON_LOG_FILENAME).is_file());
}
