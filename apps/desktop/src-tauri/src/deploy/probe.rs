//! `ssh_deploy_probe`: a POSIX `sh` snippet reports what the remote host has
//! (OS, architecture, Docker, systemd user session, curl, an existing FDE
//! install) as one JSON line, which the desktop UI turns into the deploy card.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::transport::ssh::format_ssh_failure;

use super::args::SshTarget;
use super::ssh;

const PROBE_TIMEOUT: Duration = Duration::from_secs(45);
const OUTPUT_LIMIT: usize = 64 * 1024;
const MARKER: &str = "FDE_PROBE ";

/// Runs under `sh -s` on Linux and macOS. `docker info` (not just the binary)
/// decides `hasDocker`, so a socket the user cannot reach counts as absent.
/// Strings are JSON-escaped by `esc`; the flags print as bare `true`/`false`.
pub const PROBE_SNIPPET: &str = r#"set +e
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }
os=$(uname -s 2>/dev/null); arch=$(uname -m 2>/dev/null)
docker=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then docker=true; fi
systemd=false
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then systemd=true; fi
curl=false
if command -v curl >/dev/null 2>&1; then curl=true; fi
installed=false; version=""
root="${FDE_INSTALL_DIR:-$HOME/.local/share/fde}"
if [ -x "$root/current/bin/fde" ]; then
  installed=true
  if [ -f "$root/current/manifest.json" ]; then
    version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/current/manifest.json" | head -n 1)
  fi
elif command -v fde >/dev/null 2>&1; then
  installed=true
  version=$(fde --version 2>/dev/null | head -n 1)
fi
container=false
if [ "$docker" = true ] && docker container inspect "${FDE_CONTAINER:-fde-daemon}" >/dev/null 2>&1; then container=true; fi
printf 'FDE_PROBE {"os":"%s","arch":"%s","hasDocker":%s,"hasSystemdUser":%s,"hasCurl":%s,"hasFde":{"installed":%s,"version":"%s"},"hasDockerContainer":%s,"homeDir":"%s"}\n' \
  "$(esc "$os")" "$(esc "$arch")" "$docker" "$systemd" "$curl" "$installed" "$(esc "$version")" "$container" "$(esc "$HOME")"
"#;

/// Finds the marker line in the snippet's stdout and normalises it: flags
/// become booleans, an empty version is dropped.
pub fn parse_probe_output(stdout: &str) -> Result<Value, String> {
    let line = stdout
        .lines()
        .rev()
        .find_map(|line| line.trim().strip_prefix(MARKER))
        .ok_or("The probe printed no result; the remote shell may not be POSIX sh.")?;
    let raw: Map<String, Value> = serde_json::from_str(line)
        .map_err(|error| format!("The probe result could not be parsed: {error}"))?;
    let text = |key: &str| {
        raw.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let flag = |key: &str| raw.get(key).and_then(Value::as_bool).unwrap_or(false);
    let fde = raw.get("hasFde").and_then(Value::as_object);
    let installed = fde
        .and_then(|f| f.get("installed"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let version = fde
        .and_then(|f| f.get("version"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.trim_start_matches('v').to_string());
    let mut has_fde = json!({ "installed": installed });
    if let Some(version) = version {
        has_fde["version"] = Value::String(version);
    }
    Ok(json!({
        "os": text("os"),
        "arch": text("arch"),
        "hasDocker": flag("hasDocker"),
        "hasSystemdUser": flag("hasSystemdUser"),
        "hasCurl": flag("hasCurl"),
        "hasFde": has_fde,
        "hasDockerContainer": flag("hasDockerContainer"),
        "homeDir": text("homeDir"),
    }))
}

async fn read_capped<R: tokio::io::AsyncRead + Unpin>(mut reader: R) -> String {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    while let Ok(read) = reader.read(&mut chunk).await {
        if read == 0 {
            break;
        }
        if bytes.len() < OUTPUT_LIMIT {
            bytes.extend_from_slice(&chunk[..read]);
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Runs the snippet over ssh and returns the normalised report.
pub async fn run_probe(program: Option<&Path>, target: &SshTarget) -> Result<Value, String> {
    let (_, mut child) = ssh::spawn(program, target, "sh -s").map_err(|error| error.to_string())?;
    let mut stdin = child.stdin.take().ok_or("ssh stdin unavailable")?;
    let stdout = child.stdout.take().ok_or("ssh stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("ssh stderr unavailable")?;
    let writer = async move {
        let _ = stdin.write_all(PROBE_SNIPPET.as_bytes()).await;
        let _ = stdin.shutdown().await;
    };
    let run = async {
        let (_, stdout, stderr) = tokio::join!(writer, read_capped(stdout), read_capped(stderr));
        let status = child.wait().await.map_err(|error| error.to_string())?;
        Ok::<_, String>((status, stdout, stderr))
    };
    let (status, stdout, stderr) = match tokio::time::timeout(PROBE_TIMEOUT, run).await {
        Ok(result) => result?,
        Err(_) => {
            log::warn!("deploy: probe of {} timed out", target.host);
            return Err(format!(
                "The probe of {} timed out after {} s.",
                target.host,
                PROBE_TIMEOUT.as_secs()
            ));
        }
    };
    log::info!(
        "deploy: probe of {} exited with {status}; stderr: {}",
        target.host,
        stderr.trim()
    );
    if !status.success() {
        return Err(format_ssh_failure(
            &stderr,
            status.code(),
            ssh::exit_signal(&status),
        ));
    }
    parse_probe_output(&stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_marker_line_and_drops_empty_version() {
        let out =
            "Welcome banner\nFDE_PROBE {\"os\":\"Linux\",\"arch\":\"x86_64\",\"hasDocker\":true,\
                   \"hasSystemdUser\":false,\"hasCurl\":true,\"hasFde\":{\"installed\":false,\
                   \"version\":\"\"},\"hasDockerContainer\":false,\"homeDir\":\"/home/me\"}\n";
        let parsed = parse_probe_output(out).unwrap();
        assert_eq!(parsed["os"], "Linux");
        assert_eq!(parsed["hasDocker"], true);
        assert_eq!(parsed["hasFde"], json!({ "installed": false }));
        assert_eq!(parsed["homeDir"], "/home/me");
    }

    #[test]
    fn keeps_version_without_v_prefix() {
        let out = "FDE_PROBE {\"os\":\"Darwin\",\"arch\":\"arm64\",\"hasFde\":{\"installed\":true,\
                   \"version\":\"v0.1.6\"},\"homeDir\":\"/Users/me\"}";
        let parsed = parse_probe_output(out).unwrap();
        assert_eq!(
            parsed["hasFde"],
            json!({ "installed": true, "version": "0.1.6" })
        );
        assert_eq!(parsed["hasCurl"], false);
    }

    #[test]
    fn rejects_output_without_marker_or_with_bad_json() {
        assert!(parse_probe_output("sh: uname: not found\n").is_err());
        assert!(parse_probe_output("FDE_PROBE {nope").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn snippet_runs_under_local_sh() {
        let output = std::process::Command::new("sh")
            .arg("-c")
            .arg(PROBE_SNIPPET)
            .output()
            .unwrap();
        assert!(output.status.success());
        let parsed = parse_probe_output(&String::from_utf8_lossy(&output.stdout)).unwrap();
        let uname = std::process::Command::new("uname")
            .arg("-s")
            .output()
            .unwrap();
        assert_eq!(parsed["os"], String::from_utf8_lossy(&uname.stdout).trim());
        assert_eq!(parsed["homeDir"], std::env::var("HOME").unwrap());
        assert!(parsed["hasFde"]["installed"].is_boolean());
    }
}
