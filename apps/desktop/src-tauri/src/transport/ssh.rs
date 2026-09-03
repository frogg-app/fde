//! Remote SSH endpoint: the system `ssh` is spawned with `-W 127.0.0.1:<daemonPort>`
//! (the exact argv of `buildSshTunnelArgs` in `packages/protocol`), and its
//! stdin/stdout become the byte stream the WebSocket client speaks over.

use std::io;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::session::DEFAULT_SSH_DAEMON_PORT;
use super::ssh_auth::{self, classify_ssh_failure, SshFailure, SshPassword};

const SSH_STDERR_LIMIT: usize = 8192;
const EXIT_GRACE: Duration = Duration::from_millis(500);

/// Parity with `buildSshTunnelArgs` + `buildSshArgs` in the Electron shell;
/// `ssh_auth::auth_args` decides between `BatchMode` and a password prompt.
pub fn build_ssh_args(
    host: &str,
    ssh_port: Option<u16>,
    daemon_port: Option<u16>,
    password: Option<&SshPassword>,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-T".to_string()];
    args.extend(ssh_auth::auth_args(password));
    args.extend(
        [
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ExitOnForwardFailure=yes",
        ]
        .map(String::from),
    );
    if let Some(port) = ssh_port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    args.push("-W".into());
    args.push(format!(
        "127.0.0.1:{}",
        daemon_port.unwrap_or(DEFAULT_SSH_DAEMON_PORT)
    ));
    args.push(host.to_string());
    args
}

/// `formatSshFailure`: stderr wins, then the signal, then the exit code.
pub fn format_ssh_failure(stderr: &str, code: Option<i32>, signal: Option<i32>) -> String {
    let detail = stderr.trim();
    if !detail.is_empty() {
        return detail.to_string();
    }
    if let Some(signal) = signal {
        return format!("ssh exited with signal {signal}");
    }
    match code {
        Some(code) => format!("ssh exited with code {code}"),
        None => "ssh exited with code unknown".to_string(),
    }
}

/// Environment variable that pins the ssh executable (diagnostics, tests).
pub const SSH_PROGRAM_ENV: &str = "FDE_SSH";

/// The ssh executables to try, in order: `$FDE_SSH` when set, else `ssh` on
/// `PATH`, and on Windows the in-box OpenSSH client as a fallback for shells
/// launched with a PATH that lacks `System32\OpenSSH` (Explorer, the
/// installer's "run after install" step, a portable zip started from a
/// launcher).
pub fn ssh_program_candidates() -> Vec<PathBuf> {
    if let Some(pinned) = std::env::var_os(SSH_PROGRAM_ENV).filter(|v| !v.is_empty()) {
        return vec![PathBuf::from(pinned)];
    }
    let candidates = vec![PathBuf::from("ssh")];
    #[cfg(windows)]
    let candidates = {
        let mut candidates = candidates;
        if let Some(root) = std::env::var_os("SystemRoot").filter(|v| !v.is_empty()) {
            candidates.push(
                PathBuf::from(root)
                    .join("System32")
                    .join("OpenSSH")
                    .join("ssh.exe"),
            );
        }
        candidates
    };
    candidates
}

fn configure(command: &mut Command) {
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Spawns the first candidate that exists; a missing executable moves on to
/// the next one, any other spawn error is final.
fn spawn_first_available(
    args: &[String],
    password: Option<&SshPassword>,
) -> io::Result<(PathBuf, Child)> {
    let mut last_error: Option<io::Error> = None;
    for program in ssh_program_candidates() {
        let mut command = Command::new(&program);
        command.args(args);
        configure(&mut command);
        ssh_auth::apply_password(&mut command, password)?;
        match command.spawn() {
            Ok(child) => return Ok((program, child)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                log::warn!("ssh: {} not found", program.display());
                last_error = Some(error);
            }
            Err(error) => return Err(error),
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "ssh not found")))
}

/// A running `ssh -W` process whose stderr is collected for error reporting.
pub struct SshProcess {
    child: Child,
    stderr: Arc<Mutex<String>>,
    failure: Option<String>,
    failure_kind: Option<SshFailure>,
    password_tried: bool,
}

impl SshProcess {
    pub fn spawn(
        host: &str,
        ssh_port: Option<u16>,
        daemon_port: Option<u16>,
        password: Option<&SshPassword>,
    ) -> io::Result<(Self, SshStream)> {
        let args = build_ssh_args(host, ssh_port, daemon_port, password);
        log::info!(
            "ssh: spawning ssh {}{}",
            args.join(" "),
            if password.is_some() {
                " (password via askpass)"
            } else {
                ""
            }
        );
        let (program, mut child) = spawn_first_available(&args, password).map_err(|error| {
            log::warn!("ssh: spawn failed for host {host}: {error}");
            error
        })?;
        log::info!(
            "ssh: spawned {} (pid {}) for host {host}",
            program.display(),
            child.id().map(|pid| pid.to_string()).unwrap_or_default()
        );
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("ssh stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("ssh stdout unavailable"))?;
        let stderr = Arc::new(Mutex::new(String::new()));
        if let Some(mut pipe) = child.stderr.take() {
            let sink = Arc::clone(&stderr);
            tauri::async_runtime::spawn(async move {
                let mut chunk = [0u8; 1024];
                while let Ok(read) = pipe.read(&mut chunk).await {
                    if read == 0 {
                        break;
                    }
                    let mut buffer = sink.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                    buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
                    if buffer.len() > SSH_STDERR_LIMIT {
                        let cut = buffer.len() - SSH_STDERR_LIMIT;
                        let boundary = (cut..buffer.len())
                            .find(|i| buffer.is_char_boundary(*i))
                            .unwrap_or(buffer.len());
                        buffer.drain(..boundary);
                    }
                }
            });
        }
        Ok((
            Self {
                child,
                stderr,
                failure: None,
                failure_kind: None,
                password_tried: password.is_some(),
            },
            SshStream {
                stdin,
                stdout,
                logged_first_read: false,
            },
        ))
    }

    /// Resolves once ssh exits, with the failure text (`format_ssh_failure`)
    /// or `None` for a clean exit. Also records the failure for
    /// `failure_detail`.
    pub async fn wait(&mut self) -> Option<String> {
        let status = self.child.wait().await.ok()?;
        let stderr = self.stderr_text();
        log::info!(
            "ssh: exited with {status}; stderr: {}",
            stderr.trim().replace('\n', " | ")
        );
        if status.success() {
            return None;
        }
        let failure = format_ssh_failure(&stderr, status.code(), exit_signal(&status));
        self.failure = Some(failure.clone());
        self.failure_kind = Some(classify_ssh_failure(&stderr));
        Some(failure)
    }

    /// The structured reading of the exit failure (`SshFailure::detail`),
    /// once `wait` or `failure_detail` has seen ssh exit.
    pub fn failure_detail_value(&self) -> Option<serde_json::Value> {
        self.failure_kind
            .as_ref()
            .and_then(|kind| kind.detail(self.password_tried))
    }

    fn stderr_text(&self) -> String {
        self.stderr
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// `resolveSshFailureDetail`: the recorded exit failure, else whatever
    /// stderr holds. Waits briefly for ssh to exit so the message is complete.
    pub async fn failure_detail(&mut self) -> Option<String> {
        if self.failure.is_none() {
            let _ = tokio::time::timeout(EXIT_GRACE, self.wait()).await;
        }
        if let Some(failure) = &self.failure {
            return Some(failure.clone());
        }
        let stderr = self.stderr_text();
        let trimmed = stderr.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    }

    pub async fn kill(&mut self) {
        let _ = self.child.kill().await;
    }
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

/// ssh's stdio as one duplex stream.
pub struct SshStream {
    stdin: ChildStdin,
    stdout: ChildStdout,
    logged_first_read: bool,
}

impl AsyncRead for SshStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let before = buf.filled().len();
        let poll = Pin::new(&mut self.stdout).poll_read(cx, buf);
        if !self.logged_first_read {
            if let Poll::Ready(Ok(())) = &poll {
                let received = &buf.filled()[before..];
                if !received.is_empty() {
                    self.logged_first_read = true;
                    let preview: String = String::from_utf8_lossy(received)
                        .chars()
                        .take(64)
                        .filter(|c| !c.is_control())
                        .collect();
                    log::info!(
                        "ssh: first {} bytes from tunnel: {preview:?}",
                        received.len()
                    );
                }
            }
        }
        poll
    }
}

impl AsyncWrite for SshStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        data: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stdin).poll_write(cx, data)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdin).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values are the output of `buildSshTunnelArgs` in
    // packages/protocol/src/ssh-transport.ts for the same inputs.
    const COMMON: [&str; 9] = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ExitOnForwardFailure=yes",
    ];

    #[test]
    fn host_only_matches_protocol_argv() {
        let args = build_ssh_args("dev@example.com", None, None, None);
        let mut expected: Vec<String> = COMMON.iter().map(|s| s.to_string()).collect();
        expected.extend(["-W", "127.0.0.1:9999", "dev@example.com"].map(String::from));
        assert_eq!(args, expected);
    }

    #[test]
    fn host_with_ports_matches_protocol_argv() {
        let args = build_ssh_args("build-box", Some(2222), Some(7000), None);
        let mut expected: Vec<String> = COMMON.iter().map(|s| s.to_string()).collect();
        expected.extend(["-p", "2222", "-W", "127.0.0.1:7000", "build-box"].map(String::from));
        assert_eq!(args, expected);
    }

    #[test]
    fn password_drops_batch_mode_and_keeps_the_secret_out_of_argv() {
        let password = SshPassword::new("hunter2".into());
        let args = build_ssh_args("build-box", None, None, Some(&password));
        assert_eq!(
            args,
            [
                "-T",
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "PreferredAuthentications=publickey,keyboard-interactive,password",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ClearAllForwardings=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-W",
                "127.0.0.1:9999",
                "build-box"
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("hunter2")));
    }

    #[test]
    fn formats_failures_like_electron() {
        assert_eq!(
            format_ssh_failure("  Permission denied (publickey).\n", Some(255), None),
            "Permission denied (publickey)."
        );
        assert_eq!(
            format_ssh_failure("", None, Some(9)),
            "ssh exited with signal 9"
        );
        assert_eq!(
            format_ssh_failure("", Some(255), None),
            "ssh exited with code 255"
        );
        assert_eq!(
            format_ssh_failure("", None, None),
            "ssh exited with code unknown"
        );
    }
}
