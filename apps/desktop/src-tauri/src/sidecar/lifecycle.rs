//! Start, stop and restart of the sidecar daemon: Electron's
//! `daemon-manager.ts` lifecycle on top of the bundled CLI. The daemon is
//! started through `fde daemon start` (which detaches the supervisor and
//! applies its own 1.2 s early-exit grace), then polled with
//! `fde daemon status --json` every 200 ms for up to 150 attempts.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use super::bundle::InstalledBundle;
use super::cli::{self, CliInvocation};
use super::status::{normalize_version, DesktopDaemonStatus};
use super::Sidecar;
use crate::app_log::tail_file;

pub const NOT_INSTALLED: &str = "Local daemon bundle is not installed";
const MANAGEMENT_DISABLED: &str = "Built-in daemon management is disabled.";
const STARTUP_POLL_INTERVAL: Duration = Duration::from_millis(200);
const STARTUP_POLL_MAX_ATTEMPTS: usize = 150;
const STOP_ARGS: [&str; 8] = [
    "daemon",
    "stop",
    "--json",
    "--timeout",
    "5",
    "--force",
    "--kill-timeout",
    "5",
];
pub const DAEMON_LOG_FILENAME: &str = "daemon.log";

/// Per-call launch parameters resolved from settings and the environment.
#[derive(Debug, Clone)]
pub struct LaunchConfig {
    pub home: PathBuf,
    pub listen: String,
    pub manage_enabled: bool,
}

/// Environment for `fde daemon start`, inherited by the supervisor: what
/// Electron's `envOverlay` plus `createElectronNodeEnv` produced.
pub fn daemon_start_env(
    bundle: &InstalledBundle,
    config: &LaunchConfig,
) -> BTreeMap<String, String> {
    let mut env = CliInvocation::probe_env(bundle, &config.home);
    env.insert("PASEO_DESKTOP_MANAGED".into(), "1".into());
    env.insert("PASEO_WEB_UI_ENABLED".into(), "false".into());
    env.insert("PASEO_LISTEN".into(), config.listen.clone());
    env
}

/// `resolveDesktopDaemonStatus`: a failed probe is a stopped status carrying the error.
pub async fn resolve_status(bundle: Option<&InstalledBundle>, home: &Path) -> DesktopDaemonStatus {
    let Some(bundle) = bundle else {
        return DesktopDaemonStatus::errored_probe(home, NOT_INSTALLED);
    };
    let invocation = CliInvocation::new(
        bundle,
        &["daemon", "status", "--json"],
        CliInvocation::probe_env(bundle, home),
    );
    match cli::run_json(&invocation).await {
        Ok(payload) => DesktopDaemonStatus::from_probe(&payload, home),
        Err(error) => {
            log::warn!("sidecar: status probe failed: {error}");
            DesktopDaemonStatus::errored_probe(home, error)
        }
    }
}

/// A desktop-managed daemon whose version differs from the installed bundle
/// is restarted so the bundle just installed (or updated) takes over.
pub fn should_restart_for_version(current: &DesktopDaemonStatus, bundle_version: &str) -> bool {
    if !current.desktop_managed {
        return false;
    }
    match (
        normalize_version(Some(bundle_version)),
        normalize_version(current.version.as_deref()),
    ) {
        (Some(bundle), Some(daemon)) => bundle != daemon,
        _ => false,
    }
}

fn startup_failure(reason: &str, home: &Path) -> String {
    let log_path = home.join(DAEMON_LOG_FILENAME);
    let mut message = format!("Daemon failed to start: {reason}");
    if let Ok(logs) = tail_file(&log_path, 15) {
        if !logs.is_empty() {
            message.push_str(&format!(
                "\n\nRecent logs ({}):\n{logs}",
                log_path.display()
            ));
        }
    }
    message
}

async fn poll_for_running(bundle: &InstalledBundle, home: &Path) -> DesktopDaemonStatus {
    for attempt in 0..STARTUP_POLL_MAX_ATTEMPTS {
        let status = resolve_status(Some(bundle), home).await;
        if attempt == 0 || attempt == STARTUP_POLL_MAX_ATTEMPTS - 1 || attempt % 10 == 9 {
            log::info!(
                "sidecar: polling daemon status after detached start (attempt {}): {}",
                attempt + 1,
                status.summary()
            );
        }
        if status.is_ready() {
            return status;
        }
        tokio::time::sleep(STARTUP_POLL_INTERVAL).await;
    }
    resolve_status(Some(bundle), home).await
}

async fn stop_via_cli(
    bundle: &InstalledBundle,
    home: &Path,
    reason: &str,
) -> Result<Value, String> {
    let invocation = CliInvocation::new(bundle, &STOP_ARGS, CliInvocation::probe_env(bundle, home));
    log::info!(
        "sidecar: stopping daemon (reason={reason}): {}",
        invocation.describe()
    );
    let result = cli::run_json(&invocation).await?;
    log::info!("sidecar: stop completed (reason={reason}): {result}");
    Ok(result)
}

/// `stopDesktopDaemon`: skips the CLI when nothing runs, returns the status after.
pub async fn stop(
    sidecar: &Sidecar,
    home: &Path,
    reason: &str,
) -> Result<DesktopDaemonStatus, String> {
    let bundle = sidecar.store.installed();
    let status = resolve_status(bundle.as_ref(), home).await;
    if !status.is_running() {
        log::info!(
            "sidecar: stop skipped (reason={reason}): {}",
            status.summary()
        );
        return Ok(status);
    }
    let bundle = bundle.ok_or(NOT_INSTALLED)?;
    stop_via_cli(&bundle, home, reason).await?;
    Ok(resolve_status(Some(&bundle), home).await)
}

/// `startDaemon`.
pub async fn start(
    sidecar: &Sidecar,
    config: &LaunchConfig,
) -> Result<DesktopDaemonStatus, String> {
    if !config.manage_enabled {
        return Err(MANAGEMENT_DISABLED.into());
    }
    let bundle = sidecar.store.installed().ok_or(NOT_INSTALLED)?;
    let current = resolve_status(Some(&bundle), &config.home).await;
    log::info!("sidecar: status before start: {}", current.summary());
    if current.is_running() {
        if should_restart_for_version(&current, &bundle.version) {
            log::info!(
                "sidecar: daemon version {:?} differs from bundle {}, restarting",
                current.version,
                bundle.version
            );
            stop(sidecar, &config.home, "version_mismatch").await?;
        } else {
            return Ok(current);
        }
    }

    let invocation = CliInvocation::new(
        &bundle,
        &["daemon", "start"],
        daemon_start_env(&bundle, config),
    );
    log::info!(
        "sidecar: starting daemon: {} (FDE_HOME={}, PASEO_LISTEN={})",
        invocation.describe(),
        config.home.display(),
        config.listen
    );
    let output = cli::run(&invocation)
        .await
        .map_err(|error| startup_failure(&error, &config.home))?;
    log::info!(
        "sidecar: daemon start command exited with {:?}: {}",
        output.exit_code,
        output.stdout.trim()
    );
    if output.exit_code != Some(0) {
        let reason = if output.stderr.trim().is_empty() {
            format!(
                "exit code {}",
                output
                    .exit_code
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "unknown".into())
            )
        } else {
            output.stderr.trim().to_string()
        };
        return Err(startup_failure(&reason, &config.home));
    }
    let status = poll_for_running(&bundle, &config.home).await;
    if !status.is_ready() {
        log::warn!(
            "sidecar: daemon did not report running after start: {}",
            status.summary()
        );
    }
    Ok(status)
}

/// `restartDaemon`.
pub async fn restart(
    sidecar: &Sidecar,
    config: &LaunchConfig,
) -> Result<DesktopDaemonStatus, String> {
    if !config.manage_enabled {
        return Err(MANAGEMENT_DISABLED.into());
    }
    stop(sidecar, &config.home, "restart").await?;
    start(sidecar, config).await
}

/// `isDesktopManagedDaemonRunningSync` minus the liveness probe: the pid file
/// says a desktop-managed daemon owns this home. The CLI stop is a no-op for
/// a dead pid, so a stale file costs one short CLI run at exit.
pub fn pid_file_is_desktop_managed(home: &Path) -> bool {
    fs::read_to_string(home.join("paseo.pid"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .map(|lock| {
            lock.get("desktopManaged") == Some(&Value::Bool(true))
                && lock.get("pid").and_then(Value::as_u64).is_some()
        })
        .unwrap_or(false)
}

/// Electron's quit lifecycle: unless the user keeps the daemon running after
/// quit, a desktop-managed daemon is stopped before the process exits.
/// Blocking on purpose: it runs from Tauri's exit callback.
pub fn stop_on_exit(sidecar: &Sidecar, home: &Path, keep_running_after_quit: bool) {
    if keep_running_after_quit {
        log::info!("sidecar: exit: keepRunningAfterQuit is set, leaving the daemon running");
        return;
    }
    if !pid_file_is_desktop_managed(home) {
        log::info!("sidecar: exit: no desktop-managed daemon pid file, nothing to stop");
        return;
    }
    let Some(bundle) = sidecar.store.installed() else {
        log::warn!("sidecar: exit: desktop-managed pid file present but no bundle installed");
        return;
    };
    let invocation =
        CliInvocation::new(&bundle, &STOP_ARGS, CliInvocation::probe_env(&bundle, home));
    log::info!(
        "sidecar: exit: stopping desktop-managed daemon: {}",
        invocation.describe()
    );
    match cli::run_blocking(&invocation) {
        Ok(output) => log::info!(
            "sidecar: exit: stop exited with {:?}: {}",
            output.exit_code,
            output.stdout.trim()
        ),
        Err(error) => log::warn!("sidecar: exit: stop failed: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::super::status::DaemonState;
    use super::*;

    fn bundle() -> InstalledBundle {
        InstalledBundle {
            version: "0.1.6".into(),
            dir: PathBuf::from("/b"),
        }
    }

    fn config() -> LaunchConfig {
        LaunchConfig {
            home: PathBuf::from("/h/.fde"),
            listen: "127.0.0.1:6767".into(),
            manage_enabled: true,
        }
    }

    #[test]
    fn start_env_matches_electron_overlay() {
        let env = daemon_start_env(&bundle(), &config());
        assert_eq!(env["PASEO_DESKTOP_MANAGED"], "1");
        assert_eq!(env["PASEO_WEB_UI_ENABLED"], "false");
        assert_eq!(env["PASEO_NODE_ENV"], "production");
        assert_eq!(env["PASEO_LISTEN"], "127.0.0.1:6767");
        assert_eq!(env["FDE_HOME"], "/h/.fde");
        assert_eq!(env["PASEO_CLI"], bundle().launcher().to_string_lossy());
    }

    #[test]
    fn version_mismatch_only_restarts_managed_daemons() {
        let mut status = DesktopDaemonStatus::errored_probe(Path::new("/h"), "");
        status.status = DaemonState::Running;
        status.version = Some("v0.1.5".into());
        assert!(!should_restart_for_version(&status, "0.1.6"), "unmanaged");
        status.desktop_managed = true;
        assert!(should_restart_for_version(&status, "0.1.6"));
        assert!(!should_restart_for_version(&status, "v0.1.5"));
        status.version = None;
        assert!(
            !should_restart_for_version(&status, "0.1.6"),
            "unknown version"
        );
    }

    #[test]
    fn reads_desktop_managed_pid_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!pid_file_is_desktop_managed(dir.path()));
        fs::write(
            dir.path().join("paseo.pid"),
            r#"{"pid":12,"desktopManaged":true}"#,
        )
        .unwrap();
        assert!(pid_file_is_desktop_managed(dir.path()));
        fs::write(dir.path().join("paseo.pid"), r#"{"pid":12}"#).unwrap();
        assert!(!pid_file_is_desktop_managed(dir.path()));
    }

    #[test]
    fn startup_failure_includes_recent_logs() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(DAEMON_LOG_FILENAME), "line1\nline2\n").unwrap();
        let message = startup_failure("exit code 1", dir.path());
        assert!(message.starts_with("Daemon failed to start: exit code 1"));
        assert!(message.contains("line2"));
    }
}
