//! Remote SSH endpoint: the system `ssh` is spawned with `-W 127.0.0.1:<daemonPort>`
//! (the exact argv of `buildSshTunnelArgs` in `packages/protocol`), and its
//! stdin/stdout become the byte stream the WebSocket client speaks over.

use std::io;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, ReadBuf};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use super::session::DEFAULT_SSH_DAEMON_PORT;

const SSH_STDERR_LIMIT: usize = 8192;
const EXIT_GRACE: Duration = Duration::from_millis(500);

/// Parity with `buildSshTunnelArgs` + `buildSshArgs` in the Electron shell.
pub fn build_ssh_args(host: &str, ssh_port: Option<u16>, daemon_port: Option<u16>) -> Vec<String> {
    let mut args: Vec<String> = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ExitOnForwardFailure=yes",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect();
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

/// A running `ssh -W` process whose stderr is collected for error reporting.
pub struct SshProcess {
    child: Child,
    stderr: Arc<Mutex<String>>,
    failure: Option<String>,
}

impl SshProcess {
    pub fn spawn(
        host: &str,
        ssh_port: Option<u16>,
        daemon_port: Option<u16>,
    ) -> io::Result<(Self, SshStream)> {
        let mut command = Command::new("ssh");
        command
            .args(build_ssh_args(host, ssh_port, daemon_port))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command.spawn()?;
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
            },
            SshStream { stdin, stdout },
        ))
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
            if let Ok(Ok(status)) = tokio::time::timeout(EXIT_GRACE, self.child.wait()).await {
                if !status.success() {
                    let signal = exit_signal(&status);
                    self.failure = Some(format_ssh_failure(
                        &self.stderr_text(),
                        status.code(),
                        signal,
                    ));
                }
            }
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
}

impl AsyncRead for SshStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
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
        let args = build_ssh_args("dev@example.com", None, None);
        let mut expected: Vec<String> = COMMON.iter().map(|s| s.to_string()).collect();
        expected.extend(["-W", "127.0.0.1:6767", "dev@example.com"].map(String::from));
        assert_eq!(args, expected);
    }

    #[test]
    fn host_with_ports_matches_protocol_argv() {
        let args = build_ssh_args("build-box", Some(2222), Some(7000));
        let mut expected: Vec<String> = COMMON.iter().map(|s| s.to_string()).collect();
        expected.extend(["-p", "2222", "-W", "127.0.0.1:7000", "build-box"].map(String::from));
        assert_eq!(args, expected);
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
