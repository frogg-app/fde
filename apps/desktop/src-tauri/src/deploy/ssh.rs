//! Running one command on a Remote SSH host with the script on stdin: the
//! same `ssh` executable search, `BatchMode`, `ConnectTimeout` and `-p` as
//! the tunnel transport, minus the `-W` forwarding.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use tokio::process::{Child, Command};

use crate::transport::ssh::ssh_program_candidates;

use super::args::SshTarget;

/// `ssh -T -o BatchMode=yes -o ConnectTimeout=10 [-p N] <host> <command>`.
pub fn build_exec_args(target: &SshTarget, remote_command: &str) -> Vec<String> {
    let mut args: Vec<String> = ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"]
        .iter()
        .map(|arg| arg.to_string())
        .collect();
    if let Some(port) = target.ssh_port {
        args.push("-p".into());
        args.push(port.to_string());
    }
    args.push(target.host.clone());
    args.push(remote_command.to_string());
    args
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

/// Spawns ssh for `remote_command`. `program` pins the executable (tests);
/// otherwise the transport's candidate list is tried in order, moving past a
/// missing executable and stopping at any other error.
pub fn spawn(
    program: Option<&Path>,
    target: &SshTarget,
    remote_command: &str,
) -> io::Result<(PathBuf, Child)> {
    let args = build_exec_args(target, remote_command);
    log::info!("deploy: spawning ssh {}", args.join(" "));
    let candidates = match program {
        Some(program) => vec![program.to_path_buf()],
        None => ssh_program_candidates(),
    };
    let mut last_error: Option<io::Error> = None;
    for program in candidates {
        let mut command = Command::new(&program);
        command.args(&args);
        configure(&mut command);
        match command.spawn() {
            Ok(child) => {
                log::info!(
                    "deploy: spawned {} (pid {}) for host {}",
                    program.display(),
                    child.id().map(|pid| pid.to_string()).unwrap_or_default(),
                    target.host
                );
                return Ok((program, child));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                log::warn!("deploy: {} not found", program.display());
                last_error = Some(error);
            }
            Err(error) => {
                log::warn!("deploy: spawn failed for host {}: {error}", target.host);
                return Err(error);
            }
        }
    }
    Err(last_error.unwrap_or_else(|| io::Error::new(io::ErrorKind::NotFound, "ssh not found")))
}

#[cfg(unix)]
pub fn exit_signal(status: &std::process::ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
pub fn exit_signal(_status: &std::process::ExitStatus) -> Option<i32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_args_keep_transport_options_and_put_command_last() {
        let target = SshTarget {
            host: "dev@box".into(),
            ssh_port: Some(2222),
        };
        assert_eq!(
            build_exec_args(&target, "FDE_VERSION='1' bash -s"),
            [
                "-T",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "-p",
                "2222",
                "dev@box",
                "FDE_VERSION='1' bash -s"
            ]
        );
        let plain = SshTarget {
            host: "box".into(),
            ssh_port: None,
        };
        assert_eq!(build_exec_args(&plain, "sh -s")[5..], ["box", "sh -s"]);
    }
}
