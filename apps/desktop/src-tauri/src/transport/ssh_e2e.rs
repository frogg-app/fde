//! End-to-end check of the Remote SSH path without a real ssh: a fake `ssh`
//! script honours `-W host:port` by bridging stdio to that TCP port (socat),
//! so the WebSocket handshake and frames flow over the child's stdin/stdout
//! exactly as they do through OpenSSH. Needs a daemon listening on
//! `127.0.0.1:$FDE_TEST_DAEMON_PORT` (default 6797) and `socat` on PATH;
//! skips otherwise.

use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::ssh::SSH_PROGRAM_ENV;
use super::{EventSink, TransportManager};

/// `FDE_SSH` is process-global; tests that set it take this lock.
static ENV_LOCK: Mutex<()> = Mutex::new(());

const FAKE_SSH: &str = r#"#!/bin/sh
# Fake ssh: the last argument is the host, `-W host:port` names the tunnel target.
target=""
host=""
while [ $# -gt 0 ]; do
  case "$1" in
    -W) target="$2"; shift ;;
    -p|-o) shift ;;
    *) host="$1" ;;
  esac
  shift
done
case "$host" in
  denied)
    echo "user@denied: Permission denied (publickey)." >&2
    exit 255 ;;
  refused)
    echo "connect_to 127.0.0.1 port 6767: failed." >&2
    exit 255 ;;
esac
exec socat STDIO "TCP:$target"
"#;

fn daemon_port() -> u16 {
    std::env::var("FDE_TEST_DAEMON_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(6797)
}

fn daemon_reachable(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
}

fn socat_available() -> bool {
    std::process::Command::new("socat")
        .arg("-V")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn install_fake_ssh(dir: &std::path::Path) {
    let path = dir.join("ssh");
    std::fs::write(&path, FAKE_SSH).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    std::env::set_var(SSH_PROGRAM_ENV, &path);
}

fn new_manager() -> (Arc<TransportManager>, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let emit: EventSink = Arc::new(move |event| {
        let _ = tx.send(event);
    });
    (Arc::new(TransportManager::new(emit)), rx)
}

async fn next_event(rx: &mut mpsc::UnboundedReceiver<Value>, within: Duration) -> Value {
    tokio::time::timeout(within, rx.recv())
        .await
        .expect("event within deadline")
        .expect("channel open")
}

fn open_args(id: &str, host: &str, port: u16) -> Value {
    json!({
        "sessionId": id,
        "target": { "transportType": "ssh", "host": host, "daemonPort": port }
    })
}

/// One test, scenarios in sequence: the fake ssh is process-global (env var).
#[test]
fn remote_ssh_over_stdio_round_trips_and_reports_ssh_failures() {
    let port = daemon_port();
    if !daemon_reachable(port) {
        eprintln!("skipping: no daemon on 127.0.0.1:{port} (set FDE_TEST_DAEMON_PORT)");
        return;
    }
    if !socat_available() {
        eprintln!("skipping: socat not installed");
        return;
    }
    let _env = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().unwrap();
    install_fake_ssh(dir.path());

    tauri::async_runtime::block_on(async {
        // Happy path: open, hello, server_info back over the tunnel.
        let (manager, mut events) = new_manager();
        manager.open(&open_args("ssh-ok", "ok-host", port)).unwrap();
        let started = Instant::now();
        assert_eq!(
            next_event(&mut events, Duration::from_secs(10)).await,
            json!({ "sessionId": "ssh-ok", "kind": "open" })
        );
        let hello = json!({
            "type": "hello",
            "clientId": "fde-transport-test",
            "clientType": "cli",
            "protocolVersion": 1
        });
        manager
            .send(&json!({ "sessionId": "ssh-ok", "text": hello.to_string() }))
            .await
            .unwrap();
        let reply = next_event(&mut events, Duration::from_secs(10)).await;
        assert_eq!(reply["kind"], "message", "got {reply}");
        let text = reply["text"].as_str().expect("text frame");
        let parsed: Value = serde_json::from_str(text).expect("daemon sends JSON");
        let payload = &parsed["message"]["payload"];
        assert_eq!(
            payload["status"], "server_info",
            "daemon answered hello: {text}"
        );
        assert!(payload["serverId"].as_str().is_some_and(|s| !s.is_empty()));
        assert!(started.elapsed() < Duration::from_secs(10));
        manager.close(&json!({ "sessionId": "ssh-ok" })).unwrap();

        // ssh refusing the login must surface its stderr, promptly.
        let (manager, mut events) = new_manager();
        manager
            .open(&open_args("ssh-denied", "denied", port))
            .unwrap();
        let started = Instant::now();
        let event = next_event(&mut events, Duration::from_secs(5)).await;
        let elapsed = started.elapsed();
        assert_eq!(event["kind"], "error", "got {event}");
        let detail = event["error"].as_str().unwrap();
        assert!(
            detail.contains("Permission denied (publickey)."),
            "detail: {detail}"
        );
        assert!(
            detail.starts_with("Failed to connect to Remote SSH host denied: "),
            "detail: {detail}"
        );
        assert!(elapsed < Duration::from_secs(3), "took {elapsed:?}");

        // A forward failure (no daemon on the remote) reads the same way.
        let (manager, mut events) = new_manager();
        manager
            .open(&open_args("ssh-refused", "refused", port))
            .unwrap();
        let event = next_event(&mut events, Duration::from_secs(5)).await;
        assert_eq!(event["kind"], "error", "got {event}");
        assert!(event["error"]
            .as_str()
            .unwrap()
            .contains("connect_to 127.0.0.1 port 6767: failed."));
    });
}

/// A missing ssh executable is reported as such, not as a timeout.
#[test]
fn missing_ssh_executable_is_an_immediate_error() {
    let _env = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = std::env::var_os(SSH_PROGRAM_ENV);
    std::env::set_var(SSH_PROGRAM_ENV, "/nonexistent/fde-ssh-missing");
    tauri::async_runtime::block_on(async {
        let (manager, mut events) = new_manager();
        manager
            .open(&open_args("ssh-missing", "anything", 6767))
            .unwrap();
        let event = next_event(&mut events, Duration::from_secs(5)).await;
        assert_eq!(event["kind"], "error", "got {event}");
        let detail = event["error"].as_str().unwrap();
        assert!(detail.starts_with("Failed to connect to Remote SSH host anything: "));
    });
    match previous {
        Some(value) => std::env::set_var(SSH_PROGRAM_ENV, value),
        None => std::env::remove_var(SSH_PROGRAM_ENV),
    }
}
