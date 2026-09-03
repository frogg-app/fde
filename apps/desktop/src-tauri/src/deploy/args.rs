//! Argument parsing for the `ssh_deploy_*` commands and the shell-side
//! encoding of their values. Host strings follow the transport's rules (no
//! leading `-`, no whitespace) so a host can never become an ssh option; every
//! value that reaches the remote command line is single-quoted.

use serde_json::Value;

use crate::transport::ssh_auth::{password_from_args, SshPassword};

pub const DEFAULT_LISTEN: &str = "127.0.0.1:9999";
pub const DEFAULT_RELEASE_BASE: &str = "https://github.com/frogg-app/fde/releases";
const MAX_VERSION_LEN: usize = 64;
const MAX_URL_LEN: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeployMethod {
    Native,
    Docker,
}

impl DeployMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            DeployMethod::Native => "native",
            DeployMethod::Docker => "docker",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshTarget {
    pub host: String,
    pub ssh_port: Option<u16>,
    /// Answers ssh's password prompt through the askpass helper
    /// (`transport::ssh_auth`); absent means `BatchMode`.
    pub ssh_password: Option<SshPassword>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeployRequest {
    pub target: SshTarget,
    pub method: DeployMethod,
    pub version: String,
    pub listen: String,
    pub bundle_url: Option<String>,
}

/// Same rules as `validate_ssh_host` in `transport::session`.
pub fn validate_ssh_host(raw: &str) -> Result<String, String> {
    let host = raw.trim();
    if host.is_empty() {
        return Err("SSH host is required".into());
    }
    if host.chars().any(char::is_whitespace) || host.starts_with('-') {
        return Err("SSH host is invalid".into());
    }
    Ok(host.to_string())
}

fn parse_port(value: Option<&Value>, label: &str) -> Result<Option<u16>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_u64()
            .filter(|port| (1..=65535).contains(port))
            .map(|port| Some(port as u16))
            .ok_or_else(|| format!("{label} must be between 1 and 65535.")),
        Some(_) => Err(format!("{label} must be between 1 and 65535.")),
    }
}

fn string_field<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub fn parse_ssh_target(args: &Value) -> Result<SshTarget, String> {
    if !args.is_object() {
        return Err("Deploy arguments must be an object.".into());
    }
    Ok(SshTarget {
        host: validate_ssh_host(string_field(args, "host").unwrap_or_default())?,
        ssh_port: parse_port(args.get("sshPort"), "SSH port")?,
        ssh_password: password_from_args(args),
    })
}

pub fn parse_method(args: &Value) -> Result<DeployMethod, String> {
    match string_field(args, "method") {
        None | Some("native") => Ok(DeployMethod::Native),
        Some("docker") => Ok(DeployMethod::Docker),
        Some(other) => Err(format!("Unknown deploy method: {other}")),
    }
}

/// A release version or image tag: the characters a semver string or a
/// Docker tag can contain, nothing that means anything to a shell.
pub fn validate_version(raw: &str) -> Result<String, String> {
    let version = raw.trim().trim_start_matches('v');
    let valid = !version.is_empty()
        && version.len() <= MAX_VERSION_LEN
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_'));
    if valid {
        Ok(version.to_string())
    } else {
        Err("Version is invalid".into())
    }
}

/// `host:port` with a numeric port; the host part may not be empty.
pub fn validate_listen(raw: &str) -> Result<String, String> {
    let listen = raw.trim();
    let (host, port) = split_listen(listen).ok_or("Listen address must be host:port")?;
    if host.is_empty()
        || host
            .chars()
            .any(|c| c.is_whitespace() || c == '\'' || c == '"')
        || !(1..=65535).contains(&port)
    {
        return Err("Listen address must be host:port".into());
    }
    Ok(listen.to_string())
}

/// Splits `host:port` at the last colon (so `[::1]:6767` keeps its host).
pub fn split_listen(listen: &str) -> Option<(&str, u16)> {
    let (host, port) = listen.rsplit_once(':')?;
    let port: u16 = port.parse().ok()?;
    Some((host, port))
}

pub fn validate_bundle_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    let valid = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() <= MAX_URL_LEN
        && !url
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\'');
    if valid {
        Ok(url.to_string())
    } else {
        Err("Bundle URL must be an http(s) URL".into())
    }
}

pub fn parse_deploy_request(args: &Value, default_version: &str) -> Result<DeployRequest, String> {
    let target = parse_ssh_target(args)?;
    let method = parse_method(args)?;
    let version = validate_version(string_field(args, "version").unwrap_or(default_version))?;
    let listen = validate_listen(string_field(args, "listen").unwrap_or(DEFAULT_LISTEN))?;
    let bundle_url = string_field(args, "bundleUrl")
        .map(validate_bundle_url)
        .transpose()?;
    Ok(DeployRequest {
        target,
        method,
        version,
        listen,
        bundle_url,
    })
}

/// POSIX single-quoting: safe for any byte sequence, including newlines.
pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// `KEY='value' KEY2='value2'` prefix for a remote command line.
pub fn env_assignments(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| format!("{key}={}", shell_quote(value)))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The remote command that reads the install script from stdin.
pub fn build_install_command(request: &DeployRequest) -> String {
    let mut pairs: Vec<(&str, &str)> = vec![("FDE_VERSION", request.version.as_str())];
    let (bind, port) = split_listen(&request.listen).unwrap_or(("127.0.0.1", 9999));
    let port = port.to_string();
    match request.method {
        DeployMethod::Native => {
            pairs.push(("FDE_LISTEN", request.listen.as_str()));
            pairs.push(("FDE_RELEASE_BASE", DEFAULT_RELEASE_BASE));
            if let Some(url) = &request.bundle_url {
                pairs.push(("FDE_BUNDLE_URL", url.as_str()));
            }
        }
        DeployMethod::Docker => {
            pairs.push(("FDE_BIND", bind));
            pairs.push(("FDE_PORT", port.as_str()));
        }
    }
    format!("{} bash -s", env_assignments(&pairs))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(method: DeployMethod) -> DeployRequest {
        DeployRequest {
            target: SshTarget {
                host: "dev@box".into(),
                ssh_port: None,
                ssh_password: None,
            },
            method,
            version: "0.2.0".into(),
            listen: "127.0.0.1:9999".into(),
            bundle_url: None,
        }
    }

    #[test]
    fn host_rules_match_transport() {
        assert_eq!(validate_ssh_host(" box ").unwrap(), "box");
        assert!(validate_ssh_host("").is_err());
        assert!(validate_ssh_host("-oProxyCommand=x").is_err());
        assert!(validate_ssh_host("a b").is_err());
    }

    #[test]
    fn quotes_values_for_posix_sh() {
        assert_eq!(shell_quote("plain"), "'plain'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote("$(rm -rf /)"), "'$(rm -rf /)'");
        assert_eq!(
            env_assignments(&[("A", "1"), ("B", "x y")]),
            "A='1' B='x y'"
        );
    }

    #[test]
    fn builds_native_and_docker_commands() {
        assert_eq!(
            build_install_command(&request(DeployMethod::Native)),
            "FDE_VERSION='0.2.0' FDE_LISTEN='127.0.0.1:9999' \
             FDE_RELEASE_BASE='https://github.com/frogg-app/fde/releases' bash -s"
        );
        let mut with_url = request(DeployMethod::Native);
        with_url.bundle_url = Some("https://example.com/b.tar.gz".into());
        assert!(build_install_command(&with_url)
            .contains("FDE_BUNDLE_URL='https://example.com/b.tar.gz' bash -s"));
        let mut docker = request(DeployMethod::Docker);
        docker.listen = "0.0.0.0:7000".into();
        assert_eq!(
            build_install_command(&docker),
            "FDE_VERSION='0.2.0' FDE_BIND='0.0.0.0' FDE_PORT='7000' bash -s"
        );
    }

    #[test]
    fn parses_request_with_defaults_and_rejects_bad_values() {
        let parsed = parse_deploy_request(&json!({ "host": "box" }), "0.1.6").unwrap();
        assert_eq!(parsed.method, DeployMethod::Native);
        assert_eq!(parsed.version, "0.1.6");
        assert_eq!(parsed.listen, DEFAULT_LISTEN);
        assert_eq!(parsed.bundle_url, None);

        let parsed = parse_deploy_request(
            &json!({ "host": "box", "sshPort": 2222, "method": "docker", "version": "v1.2.3",
                     "listen": "0.0.0.0:6767", "bundleUrl": "https://x.y/z.tar.gz" }),
            "0.1.6",
        )
        .unwrap();
        assert_eq!(parsed.target.ssh_port, Some(2222));
        assert_eq!(parsed.target.ssh_password, None);
        assert_eq!(parsed.method, DeployMethod::Docker);

        let with_password =
            parse_ssh_target(&json!({ "host": "box", "sshPassword": "hunter2" })).unwrap();
        assert_eq!(
            with_password.ssh_password.as_ref().map(SshPassword::expose),
            Some("hunter2")
        );
        assert!(!format!("{with_password:?}").contains("hunter2"));
        assert_eq!(parsed.version, "1.2.3");
        assert_eq!(parsed.bundle_url.as_deref(), Some("https://x.y/z.tar.gz"));

        assert!(parse_deploy_request(&json!({ "host": "box", "method": "snap" }), "0").is_err());
        assert!(parse_deploy_request(&json!({ "host": "box", "version": "1;rm" }), "0").is_err());
        assert!(parse_deploy_request(&json!({ "host": "box", "listen": "nope" }), "0").is_err());
        assert!(parse_deploy_request(&json!({ "host": "box", "listen": ":0" }), "0").is_err());
        assert!(
            parse_deploy_request(&json!({ "host": "box", "bundleUrl": "ftp://x" }), "0").is_err()
        );
        assert!(parse_deploy_request(&json!({ "host": "box", "sshPort": 70000 }), "0").is_err());
        assert!(parse_deploy_request(&json!("box"), "0").is_err());
    }

    #[test]
    fn listen_split_keeps_ipv6_host() {
        assert_eq!(split_listen("[::1]:6767"), Some(("[::1]", 6767)));
        assert_eq!(split_listen("6767"), None);
        assert!(validate_listen("[::1]:6767").is_ok());
    }
}
