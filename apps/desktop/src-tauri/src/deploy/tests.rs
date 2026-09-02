//! Deploy commands against a fake `ssh`: the script drops ssh's options and
//! runs the remote command locally with `sh -c`, stdin attached, so the probe
//! snippet and the `... bash -s` install line execute exactly as they would
//! on a host. No network, no real ssh.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::scripts::INSTALL_SH;
use super::DeployManager;
use crate::transport::EventSink;

/// Skips `-T`, `-o X`, `-p N` and the host; the last argument is the command.
const FAKE_SSH_EXEC: &str = r#"#!/bin/sh
cmd=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-p) shift ;;
    -T) ;;
    *) cmd="$1" ;;
  esac
  shift
done
exec sh -c "$cmd"
"#;

/// Echoes the remote command line and the byte count of stdin instead of
/// running anything; `fail` as the host exits 255 with a stderr message.
const FAKE_SSH_ECHO: &str = r#"#!/bin/sh
cmd=""; host=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|-p) shift ;;
    -T) ;;
    *) host="$cmd"; cmd="$1" ;;
  esac
  shift
done
if [ "$host" = "fail" ]; then
  echo "user@fail: Permission denied (publickey)." >&2
  exit 255
fi
if [ "$host" = "slow" ]; then
  sleep 30
  exit 0
fi
echo "CMD: $cmd"
echo "STDIN: $(wc -c | tr -d ' ')"
echo "warning line" >&2
"#;

fn install_fake_ssh(dir: &Path, name: &str, body: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn manager(program: PathBuf) -> (DeployManager, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let emit: EventSink = Arc::new(move |event| {
        let _ = tx.send(event);
    });
    (DeployManager::with_program(emit, program), rx)
}

async fn collect_until_final(rx: &mut mpsc::UnboundedReceiver<Value>, job_id: &str) -> Vec<Value> {
    let mut events = Vec::new();
    loop {
        let event = tokio::time::timeout(Duration::from_secs(10), rx.recv())
            .await
            .expect("event within deadline")
            .expect("channel open");
        assert_eq!(event["jobId"], job_id);
        let kind = event["kind"].as_str().unwrap_or_default().to_string();
        events.push(event);
        if kind == "done" || kind == "error" {
            return events;
        }
    }
}

fn logs(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .filter(|e| e["kind"] == "log")
        .map(|e| e["text"].as_str().unwrap_or_default().to_string())
        .collect()
}

#[test]
fn probe_runs_the_snippet_through_ssh_and_reports_this_machine() {
    let dir = tempfile::tempdir().unwrap();
    let fake = install_fake_ssh(dir.path(), "ssh", FAKE_SSH_EXEC);
    let (manager, _events) = manager(fake);
    tauri::async_runtime::block_on(async {
        let report = manager
            .probe(&json!({ "host": "box", "sshPort": 2222 }))
            .await
            .unwrap();
        let uname = std::process::Command::new("uname")
            .arg("-s")
            .output()
            .unwrap();
        assert_eq!(report["os"], String::from_utf8_lossy(&uname.stdout).trim());
        assert_eq!(report["homeDir"], std::env::var("HOME").unwrap());
        assert!(report["hasDocker"].is_boolean());
        assert!(report["hasSystemdUser"].is_boolean());
        assert!(report["hasFde"]["installed"].is_boolean());

        let error = manager.probe(&json!({ "host": "-bad" })).await.unwrap_err();
        assert_eq!(error, "SSH host is invalid");
    });
}

#[test]
fn deploy_job_streams_env_line_and_full_script_then_done() {
    let dir = tempfile::tempdir().unwrap();
    let fake = install_fake_ssh(dir.path(), "ssh", FAKE_SSH_ECHO);
    let (manager, mut events) = manager(fake);
    tauri::async_runtime::block_on(async {
        let started = manager
            .start(
                &json!({ "host": "box", "method": "native", "version": "1.2.3",
                         "listen": "127.0.0.1:7000" }),
                "0.0.0",
            )
            .unwrap();
        let job_id = started["jobId"].as_str().unwrap().to_string();
        let received = collect_until_final(&mut events, &job_id).await;
        let lines = logs(&received);
        assert!(lines.contains(
            &"CMD: FDE_VERSION='1.2.3' FDE_LISTEN='127.0.0.1:7000' \
              FDE_RELEASE_BASE='https://github.com/frogg-app/frogg-de/releases' bash -s"
                .to_string()
        ));
        assert!(lines.contains(&format!("STDIN: {}", INSTALL_SH.len())));
        let stderr = received
            .iter()
            .find(|e| e["stream"] == "stderr")
            .expect("stderr line forwarded");
        assert_eq!(stderr["text"], "warning line");
        assert_eq!(received.last().unwrap()["kind"], "done");
    });
}

#[test]
fn deploy_job_reports_ssh_failure_and_uninstall_uses_uninstall_script() {
    let dir = tempfile::tempdir().unwrap();
    let fake = install_fake_ssh(dir.path(), "ssh", FAKE_SSH_ECHO);
    let (manager, mut events) = manager(fake);
    tauri::async_runtime::block_on(async {
        let job_id = manager.start(&json!({ "host": "fail" }), "0.1.6").unwrap()["jobId"]
            .as_str()
            .unwrap()
            .to_string();
        let received = collect_until_final(&mut events, &job_id).await;
        let last = received.last().unwrap();
        assert_eq!(last["kind"], "error");
        assert_eq!(last["detail"], "user@fail: Permission denied (publickey).");

        let job_id = manager
            .uninstall(&json!({ "host": "box", "method": "docker" }))
            .unwrap()["jobId"]
            .as_str()
            .unwrap()
            .to_string();
        let received = collect_until_final(&mut events, &job_id).await;
        let lines = logs(&received);
        assert!(lines.contains(&"CMD: bash -s".to_string()));
        assert!(lines.contains(&format!(
            "STDIN: {}",
            super::scripts::UNINSTALL_DOCKER_SH.len()
        )));
    });
}

#[test]
fn cancel_kills_the_ssh_child() {
    let dir = tempfile::tempdir().unwrap();
    let fake = install_fake_ssh(dir.path(), "ssh", FAKE_SSH_ECHO);
    let (manager, mut events) = manager(fake);
    tauri::async_runtime::block_on(async {
        let job_id = manager.start(&json!({ "host": "slow" }), "0.1.6").unwrap()["jobId"]
            .as_str()
            .unwrap()
            .to_string();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(
            manager.cancel(&json!({ "jobId": job_id })).unwrap(),
            json!({ "cancelled": true })
        );
        let started = std::time::Instant::now();
        let received = collect_until_final(&mut events, &job_id).await;
        assert!(started.elapsed() < Duration::from_secs(5));
        let last = received.last().unwrap();
        assert_eq!(last["kind"], "error");
        assert_eq!(last["cancelled"], true);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(
            manager.cancel(&json!({ "jobId": job_id })).unwrap(),
            json!({ "cancelled": false })
        );
    });
}
