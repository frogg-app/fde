//! `DesktopDaemonStatus`, Electron's shape, derived from the CLI's
//! `daemon status --json` payload (`statusFromDaemonProbe`).

use std::path::Path;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonState {
    #[allow(dead_code)]
    Starting,
    Running,
    Stopped,
    Errored,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDaemonStatus {
    pub server_id: String,
    pub status: DaemonState,
    pub listen: Option<String>,
    pub hostname: Option<String>,
    pub pid: Option<u32>,
    pub home: String,
    pub version: Option<String>,
    pub desktop_managed: bool,
    pub error: Option<String>,
}

impl DesktopDaemonStatus {
    /// The status Electron returned when the CLI probe itself failed.
    pub fn errored_probe(home: &Path, error: impl Into<String>) -> Self {
        Self {
            server_id: String::new(),
            status: DaemonState::Stopped,
            listen: None,
            hostname: None,
            pid: None,
            home: home.to_string_lossy().into_owned(),
            version: None,
            desktop_managed: false,
            error: Some(error.into()),
        }
    }

    /// `statusFromDaemonProbe`: reachable or a live process is running, an
    /// unresponsive process is errored, everything else is stopped.
    pub fn from_probe(payload: &Value, home: &Path) -> Self {
        let local = payload
            .get("localDaemon")
            .and_then(Value::as_str)
            .unwrap_or("stopped");
        let reachable = payload.get("connectedDaemon").and_then(Value::as_str) == Some("reachable");
        let process_alive = local == "running";
        let stalled = local == "unresponsive";
        let status = if reachable || process_alive {
            DaemonState::Running
        } else if stalled {
            DaemonState::Errored
        } else {
            DaemonState::Stopped
        };
        let string = |key: &str| payload.get(key).and_then(Value::as_str).map(str::to_string);
        Self {
            server_id: string("serverId").unwrap_or_default(),
            status,
            listen: string("listen"),
            hostname: if status == DaemonState::Running {
                string("hostname")
            } else {
                None
            },
            pid: if process_alive || stalled {
                payload
                    .get("pid")
                    .and_then(Value::as_u64)
                    .map(|pid| pid as u32)
            } else {
                None
            },
            home: home.to_string_lossy().into_owned(),
            version: string("daemonVersion"),
            desktop_managed: payload.get("desktopManaged") == Some(&Value::Bool(true)),
            error: None,
        }
    }

    pub fn is_running(&self) -> bool {
        self.status == DaemonState::Running
    }

    /// What `startDaemon` waited for: running with an id and a listen address.
    pub fn is_ready(&self) -> bool {
        self.is_running()
            && !self.server_id.is_empty()
            && self.listen.as_deref().is_some_and(|l| !l.is_empty())
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    /// The fields Electron logged for lifecycle events.
    pub fn summary(&self) -> String {
        format!(
            "status={:?} pid={:?} listen={:?} serverId={:?} version={:?} desktopManaged={} error={:?}",
            self.status, self.pid, self.listen, self.server_id, self.version, self.desktop_managed, self.error
        )
    }
}

/// `v1.2.3` and `1.2.3` compare equal; blank is `None`.
pub fn normalize_version(version: Option<&str>) -> Option<String> {
    let trimmed = version?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.trim_start_matches(['v', 'V']).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_running_probe() {
        let payload = json!({
            "serverId": "srv", "localDaemon": "running", "connectedDaemon": "reachable",
            "listen": "127.0.0.1:6767", "hostname": "box", "pid": 42, "daemonVersion": "0.1.6",
            "desktopManaged": true
        });
        let status = DesktopDaemonStatus::from_probe(&payload, Path::new("/h"));
        assert_eq!(status.status, DaemonState::Running);
        assert_eq!(status.pid, Some(42));
        assert_eq!(status.hostname.as_deref(), Some("box"));
        assert!(status.desktop_managed);
        assert!(status.is_ready());
        let json = status.to_json();
        assert_eq!(json["status"], "running");
        assert_eq!(json["serverId"], "srv");
        assert_eq!(json["desktopManaged"], true);
        assert_eq!(json["error"], Value::Null);
    }

    #[test]
    fn maps_stopped_unresponsive_and_reachable_without_process() {
        let stopped = DesktopDaemonStatus::from_probe(
            &json!({ "localDaemon": "stopped", "connectedDaemon": "unreachable", "pid": 7, "hostname": "h" }),
            Path::new("/h"),
        );
        assert_eq!(stopped.status, DaemonState::Stopped);
        assert_eq!(stopped.pid, None);
        assert_eq!(stopped.hostname, None);
        assert!(!stopped.is_ready());

        let stalled = DesktopDaemonStatus::from_probe(
            &json!({ "localDaemon": "unresponsive", "connectedDaemon": "unreachable", "pid": 7 }),
            Path::new("/h"),
        );
        assert_eq!(stalled.status, DaemonState::Errored);
        assert_eq!(stalled.pid, Some(7));

        let remote = DesktopDaemonStatus::from_probe(
            &json!({ "localDaemon": "stopped", "connectedDaemon": "reachable", "pid": 7, "serverId": "x", "listen": "1:2" }),
            Path::new("/h"),
        );
        assert_eq!(remote.status, DaemonState::Running);
        assert_eq!(remote.pid, None, "pid only for a live local process");
        assert!(remote.is_ready());
    }

    #[test]
    fn errored_probe_and_version_normalization() {
        let status = DesktopDaemonStatus::errored_probe(Path::new("/h"), "nope");
        assert_eq!(status.status, DaemonState::Stopped);
        assert_eq!(status.error.as_deref(), Some("nope"));
        assert_eq!(status.to_json()["home"], "/h");
        assert_eq!(
            normalize_version(Some(" v1.2.3 ")).as_deref(),
            Some("1.2.3")
        );
        assert_eq!(normalize_version(Some("  ")), None);
        assert_eq!(normalize_version(None), None);
    }
}
