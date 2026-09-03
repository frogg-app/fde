//! Running the bundled CLI (`fde daemon status --json`, `fde daemon stop …`).
//! A port of Electron's `daemon/cli/external.ts`. The shell runs the bundle's
//! own Node binary on the CLI entrypoint directly rather than the `bin/fde`
//! launcher, which sidesteps `cmd.exe` quoting on Windows and shell lookups
//! everywhere else; the launchers stay for humans and `PASEO_CLI`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;

use super::bundle::InstalledBundle;

const CLI_TIMEOUT: Duration = Duration::from_secs(60);
const DISABLE_DEP0040: &str = "--disable-warning=DEP0040";

/// A fully resolved process to spawn: program, argv and extra environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliInvocation {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

impl CliInvocation {
    /// `node --disable-warning=DEP0040 <cli entry> <args…>` for `bundle`.
    pub fn new(bundle: &InstalledBundle, args: &[&str], env: BTreeMap<String, String>) -> Self {
        let mut argv = vec![
            DISABLE_DEP0040.to_string(),
            bundle.cli_entry().to_string_lossy().into_owned(),
        ];
        argv.extend(args.iter().map(|a| a.to_string()));
        Self {
            program: bundle.node_binary(),
            args: argv,
            env,
        }
    }

    pub fn describe(&self) -> String {
        format!("{} {}", self.program.display(), self.args.join(" "))
    }

    fn base_env(bundle_launcher: &Path) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        env.insert("PASEO_NODE_ENV".into(), "production".into());
        env.insert(
            "PASEO_CLI".into(),
            bundle_launcher.to_string_lossy().into_owned(),
        );
        env
    }

    /// Environment for status/stop probes: production mode and the launcher
    /// path, plus the daemon home so the CLI looks at the same `paseo.pid`.
    pub fn probe_env(bundle: &InstalledBundle, home: &Path) -> BTreeMap<String, String> {
        let mut env = Self::base_env(&bundle.launcher());
        env.insert("FDE_HOME".into(), home.to_string_lossy().into_owned());
        env
    }

    pub fn to_std_command(&self) -> std::process::Command {
        let mut command = std::process::Command::new(&self.program);
        command
            .args(&self.args)
            .envs(&self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }

    pub fn to_tokio_command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.program);
        command
            .args(&self.args)
            .envs(&self.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            command.creation_flags(CREATE_NO_WINDOW);
        }
        command
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug)]
pub struct CliOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl CliOutput {
    fn failure_message(&self) -> String {
        let stderr = self.stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }
        let stdout = self.stdout.trim();
        let mut message = format!(
            "CLI command failed with exit code {}",
            self.exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "null".into())
        );
        if !stdout.is_empty() {
            message.push_str(&format!("\nstdout: {}", truncate(stdout, 200)));
        }
        message
    }
}

fn truncate(text: &str, max: usize) -> &str {
    match text.char_indices().nth(max) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}

/// Runs the invocation to completion (bounded by `CLI_TIMEOUT`).
pub async fn run(invocation: &CliInvocation) -> Result<CliOutput, String> {
    let child = invocation
        .to_tokio_command()
        .spawn()
        .map_err(|e| format!("could not run {}: {e}", invocation.program.display()))?;
    let output = tokio::time::timeout(CLI_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| format!("CLI command timed out after {}s", CLI_TIMEOUT.as_secs()))?
        .map_err(|e| e.to_string())?;
    Ok(CliOutput {
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Synchronous variant for the app-exit path, where no runtime is available.
pub fn run_blocking(invocation: &CliInvocation) -> Result<CliOutput, String> {
    let output = invocation
        .to_std_command()
        .output()
        .map_err(|e| format!("could not run {}: {e}", invocation.program.display()))?;
    Ok(CliOutput {
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn log_failure(kind: &str, invocation: &CliInvocation, output: &CliOutput) {
    log::warn!(
        "sidecar cli: {kind} command failed: {} (exit {:?}) stdout={:?} stderr={:?}",
        invocation.describe(),
        output.exit_code,
        truncate(output.stdout.trim(), 500),
        truncate(output.stderr.trim(), 500)
    );
}

/// `runExternalCliTextCommand`: stdout on success, stderr (or a summary) as the error.
pub async fn run_text(invocation: &CliInvocation) -> Result<String, String> {
    let output = run(invocation).await?;
    if output.exit_code != Some(0) {
        log_failure("text", invocation, &output);
        return Err(output.failure_message());
    }
    Ok(output.stdout.trim_end().to_string())
}

/// Electron's JSON extraction: the first `{` or `[` starts the document, so a
/// stray warning line before it does not break parsing.
pub fn parse_json_output(stdout: &str) -> Result<Value, String> {
    let stdout = stdout.trim();
    if stdout.is_empty() {
        return Err("CLI command did not produce JSON output.".into());
    }
    let Some(start) = stdout.find(['{', '[']) else {
        return Err(format!(
            "CLI command output contained no JSON. Output: {}",
            truncate(stdout, 200)
        ));
    };
    serde_json::from_str(&stdout[start..])
        .map_err(|e| format!("CLI command returned invalid JSON: {e}"))
}

/// `runExternalCliJsonCommand`.
pub async fn run_json(invocation: &CliInvocation) -> Result<Value, String> {
    let output = run(invocation).await?;
    if output.exit_code != Some(0) {
        log_failure("JSON", invocation, &output);
        return Err(output.failure_message());
    }
    parse_json_output(&output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle() -> InstalledBundle {
        InstalledBundle {
            version: "1.0.0".into(),
            dir: PathBuf::from("/b"),
        }
    }

    #[test]
    fn builds_node_argv_for_cli_entry() {
        let invocation =
            CliInvocation::new(&bundle(), &["daemon", "status", "--json"], BTreeMap::new());
        assert_eq!(invocation.program, bundle().node_binary());
        assert_eq!(invocation.args[0], "--disable-warning=DEP0040");
        assert_eq!(invocation.args[1], bundle().cli_entry().to_string_lossy());
        assert_eq!(&invocation.args[2..], ["daemon", "status", "--json"]);
        let env = CliInvocation::probe_env(&bundle(), Path::new("/home/u/.fde"));
        assert_eq!(env["PASEO_NODE_ENV"], "production");
        assert_eq!(env["FDE_HOME"], "/home/u/.fde");
        assert_eq!(env["PASEO_CLI"], bundle().launcher().to_string_lossy());
    }

    #[test]
    fn extracts_json_after_noise() {
        let value = parse_json_output("(node) warning\n{\"a\":1}\n").unwrap();
        assert_eq!(value["a"], 1);
        assert!(parse_json_output("   ")
            .unwrap_err()
            .contains("did not produce"));
        assert!(parse_json_output("plain text")
            .unwrap_err()
            .contains("contained no JSON"));
        assert!(parse_json_output("{broken")
            .unwrap_err()
            .contains("invalid JSON"));
    }

    #[test]
    fn failure_message_prefers_stderr() {
        let output = CliOutput {
            exit_code: Some(2),
            stdout: "out".into(),
            stderr: " boom \n".into(),
        };
        assert_eq!(output.failure_message(), "boom");
        let output = CliOutput {
            exit_code: Some(2),
            stdout: "out".into(),
            stderr: String::new(),
        };
        assert_eq!(
            output.failure_message(),
            "CLI command failed with exit code 2\nstdout: out"
        );
        let output = CliOutput {
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_eq!(
            output.failure_message(),
            "CLI command failed with exit code null"
        );
    }
}
