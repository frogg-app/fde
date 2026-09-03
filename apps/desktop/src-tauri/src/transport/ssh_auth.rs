//! Password authentication for the spawned `ssh` (tunnel and deploy jobs).
//! Without a password ssh runs in `BatchMode` and fails fast; with one, the
//! password reaches ssh only through an askpass helper that prints it from
//! the child's environment (never argv, never a log line). Also the reading
//! of ssh's stderr that tells the UI *why* ssh failed, so it can prompt.

use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde_json::{json, Value};
use tokio::process::Command;

/// Environment variable the askpass helper prints.
pub const PASSWORD_ENV: &str = "FDE_SSH_PW";
#[cfg(unix)]
const HELPER_NAME: &str = "fde-askpass.sh";
#[cfg(unix)]
const HELPER_BODY: &str = "#!/bin/sh\nprintf %s \"$FDE_SSH_PW\"\n";
#[cfg(windows)]
const HELPER_NAME: &str = "fde-askpass.cmd";
#[cfg(windows)]
const HELPER_BODY: &str = "@echo off\r\npowershell -NoProfile -NonInteractive -Command \"[Console]::Out.Write($env:FDE_SSH_PW)\"\r\n";

/// An ssh password. `Debug` is redacted so a target or request that carries
/// one can be logged without leaking it.
#[derive(Clone, PartialEq, Eq)]
pub struct SshPassword(String);

impl SshPassword {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SshPassword {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SshPassword(<redacted>)")
    }
}

/// Reads an optional `sshPassword` string out of a command's arguments.
pub fn password_from_args(value: &Value) -> Option<SshPassword> {
    value
        .get("sshPassword")
        .and_then(Value::as_str)
        .filter(|password| !password.is_empty())
        .map(|password| SshPassword::new(password.to_string()))
}

/// The `-o` options that decide how ssh authenticates: `BatchMode` (no
/// prompts, keys or agent only) without a password; with one, a single
/// password prompt answered by the askpass helper, keys tried first.
pub fn auth_args(password: Option<&SshPassword>) -> Vec<String> {
    let options: &[&str] = if password.is_some() {
        &[
            "NumberOfPasswordPrompts=1",
            "PreferredAuthentications=publickey,keyboard-interactive,password",
        ]
    } else {
        &["BatchMode=yes"]
    };
    options
        .iter()
        .flat_map(|option| ["-o".to_string(), option.to_string()])
        .collect()
}

/// Environment for an ssh child that must answer a password prompt. Older
/// ssh only consults `SSH_ASKPASS` when `DISPLAY` is set, so a placeholder
/// is added when the app itself has none.
pub fn askpass_env(
    helper: &Path,
    password: &SshPassword,
    has_display: bool,
) -> Vec<(String, String)> {
    let mut env = vec![
        (
            "SSH_ASKPASS".to_string(),
            helper.to_string_lossy().to_string(),
        ),
        ("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string()),
        (PASSWORD_ENV.to_string(), password.expose().to_string()),
    ];
    if !has_display {
        env.push(("DISPLAY".to_string(), "fde".to_string()));
    }
    env
}

/// Applies the password (if any) to a command about to spawn ssh.
pub fn apply_password(command: &mut Command, password: Option<&SshPassword>) -> io::Result<()> {
    let Some(password) = password else {
        return Ok(());
    };
    let helper = ensure_helper()?;
    let has_display = std::env::var_os("DISPLAY").is_some_and(|value| !value.is_empty());
    for (key, value) in askpass_env(&helper, password, has_display) {
        command.env(key, value);
    }
    Ok(())
}

static HELPER_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Where the askpass helper lives: the app cache dir once the app is up,
/// else a directory under the system temp dir (tests, early failures).
pub fn configure_helper_dir(dir: PathBuf) {
    let _ = HELPER_DIR.set(dir);
}

fn helper_dir() -> PathBuf {
    HELPER_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().join("fde-askpass"))
}

/// The askpass helper, written on first use and rewritten if its content
/// drifted. Private to the user (0700) on Unix. It holds no secret itself:
/// the password is only ever in the ssh child's environment.
pub fn ensure_helper() -> io::Result<PathBuf> {
    ensure_helper_in(&helper_dir())
}

pub fn ensure_helper_in(dir: &Path) -> io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(HELPER_NAME);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(HELPER_BODY) {
        std::fs::write(&path, HELPER_BODY)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(path)
}

/// What ssh's stderr says about why it failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SshFailure {
    /// `Permission denied (…)`: the authentication methods the server offers.
    PermissionDenied {
        methods: Vec<String>,
    },
    /// The host key is unknown or changed; nothing a password fixes.
    HostKey,
    Other,
}

impl SshFailure {
    /// The server accepts a password (or an interactive prompt), so asking
    /// the user for one can succeed.
    pub fn password_offered(&self) -> bool {
        match self {
            SshFailure::PermissionDenied { methods } => methods
                .iter()
                .any(|method| method == "password" || method == "keyboard-interactive"),
            _ => false,
        }
    }

    /// The structured `detail` attached to a transport error event, when
    /// the failure is one the UI can act on.
    pub fn detail(&self, password_tried: bool) -> Option<Value> {
        match self {
            SshFailure::PermissionDenied { methods } if self.password_offered() => Some(json!({
                "kind": "ssh-auth",
                "methods": methods,
                "passwordTried": password_tried,
            })),
            SshFailure::HostKey => Some(json!({ "kind": "ssh-host-key" })),
            _ => None,
        }
    }
}

/// Classifies ssh's stderr. After a rejected password ssh prints
/// `Permission denied, please try again.` and then the final
/// `Permission denied (publickey,password).`; the last line with a method
/// list wins.
pub fn classify_ssh_failure(stderr: &str) -> SshFailure {
    if stderr.contains("Host key verification failed")
        || stderr.contains("REMOTE HOST IDENTIFICATION HAS CHANGED")
    {
        return SshFailure::HostKey;
    }
    let mut denied = false;
    let mut methods: Option<Vec<String>> = None;
    for line in stderr.lines() {
        let Some(rest) = line.split("Permission denied").nth(1) else {
            continue;
        };
        denied = true;
        if let Some(list) = rest
            .trim_start()
            .strip_prefix('(')
            .and_then(|list| list.split(')').next())
        {
            methods = Some(
                list.split(',')
                    .map(str::trim)
                    .filter(|method| !method.is_empty())
                    .map(str::to_string)
                    .collect(),
            );
        }
    }
    if denied {
        SshFailure::PermissionDenied {
            methods: methods.unwrap_or_default(),
        }
    } else {
        SshFailure::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_args_switch_between_batch_mode_and_one_prompt() {
        assert_eq!(auth_args(None), ["-o", "BatchMode=yes"]);
        let password = SshPassword::new("hunter2".into());
        let args = auth_args(Some(&password));
        assert_eq!(
            args,
            [
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "PreferredAuthentications=publickey,keyboard-interactive,password"
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("hunter2")));
        assert!(!args.iter().any(|arg| arg.contains("BatchMode")));
    }

    #[test]
    fn askpass_env_carries_the_password_and_a_display_placeholder() {
        let password = SshPassword::new("s3cret".into());
        let env = askpass_env(Path::new("/x/fde-askpass.sh"), &password, false);
        assert_eq!(
            env,
            [
                ("SSH_ASKPASS".to_string(), "/x/fde-askpass.sh".to_string()),
                ("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string()),
                ("FDE_SSH_PW".to_string(), "s3cret".to_string()),
                ("DISPLAY".to_string(), "fde".to_string()),
            ]
        );
        let with_display = askpass_env(Path::new("/x/h"), &password, true);
        assert!(!with_display.iter().any(|(key, _)| key == "DISPLAY"));
        assert_eq!(format!("{password:?}"), "SshPassword(<redacted>)");
    }

    #[test]
    fn password_from_args_ignores_empty_and_non_strings() {
        assert_eq!(
            password_from_args(&json!({ "sshPassword": "pw" })),
            Some(SshPassword::new("pw".into()))
        );
        assert_eq!(password_from_args(&json!({ "sshPassword": "" })), None);
        assert_eq!(password_from_args(&json!({ "sshPassword": 5 })), None);
        assert_eq!(password_from_args(&json!({})), None);
    }

    #[test]
    fn classifies_ssh_stderr() {
        assert_eq!(
            classify_ssh_failure("me@box: Permission denied (publickey).\n"),
            SshFailure::PermissionDenied {
                methods: vec!["publickey".into()]
            }
        );
        let offered = classify_ssh_failure(
            "Permission denied, please try again.\nme@box: Permission denied (publickey,password).\n",
        );
        assert_eq!(
            offered,
            SshFailure::PermissionDenied {
                methods: vec!["publickey".into(), "password".into()]
            }
        );
        assert!(offered.password_offered());
        assert_eq!(
            offered.detail(true),
            Some(
                json!({ "kind": "ssh-auth", "methods": ["publickey", "password"], "passwordTried": true })
            )
        );
        let interactive = classify_ssh_failure("Permission denied (keyboard-interactive).");
        assert!(interactive.password_offered());
        let keys_only = classify_ssh_failure("Permission denied (publickey).");
        assert!(!keys_only.password_offered());
        assert_eq!(keys_only.detail(false), None);
        assert_eq!(
            classify_ssh_failure("Permission denied, please try again."),
            SshFailure::PermissionDenied { methods: vec![] }
        );
        assert_eq!(
            classify_ssh_failure("Host key verification failed.\n"),
            SshFailure::HostKey
        );
        assert_eq!(
            classify_ssh_failure("@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @"),
            SshFailure::HostKey
        );
        assert_eq!(
            classify_ssh_failure("ssh: connect to host box port 22: Connection refused"),
            SshFailure::Other
        );
    }

    #[cfg(unix)]
    #[test]
    fn helper_is_private_and_prints_the_password_from_its_environment() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let helper = ensure_helper_in(&dir.path().join("askpass")).unwrap();
        let mode = std::fs::metadata(&helper).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        let dir_mode = std::fs::metadata(helper.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert!(!std::fs::read_to_string(&helper).unwrap().contains("p@ss"));
        let output = std::process::Command::new(&helper)
            .arg("me@box's password:")
            .env(PASSWORD_ENV, "p@ss w0rd\"'$x")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8_lossy(&output.stdout), "p@ss w0rd\"'$x");
        // Rewriting is idempotent and repairs a tampered helper.
        std::fs::write(&helper, "#!/bin/sh\necho nope\n").unwrap();
        ensure_helper_in(helper.parent().unwrap()).unwrap();
        assert_eq!(std::fs::read_to_string(&helper).unwrap(), HELPER_BODY);
    }
}
