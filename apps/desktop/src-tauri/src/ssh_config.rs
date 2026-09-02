//! `list_ssh_config_hosts`: the concrete `Host` entries of `~/.ssh/config`
//! (with one level of `Include`), so the Remote SSH page can offer them as
//! targets. Only the fields the picker shows are extracted; `ssh` itself
//! resolves everything else when the alias is used.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity_file: Option<String>,
}

pub fn list_ssh_config_hosts<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let Ok(home) = app.path().home_dir() else {
        return Ok(Value::Array(Vec::new()));
    };
    let ssh_dir = home.join(".ssh");
    let hosts = parse_config_file(&ssh_dir.join("config"), &ssh_dir, &home, true);
    serde_json::to_value(hosts).map_err(|e| e.to_string())
}

/// Parses one config file. `follow_includes` is cleared for included files
/// (one level of `Include`, as the picker promises).
pub fn parse_config_file(
    path: &Path,
    ssh_dir: &Path,
    home: &Path,
    follow_includes: bool,
) -> Vec<SshConfigHost> {
    let Ok(contents) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    parse_config(&contents, ssh_dir, home, follow_includes)
}

fn parse_config(
    contents: &str,
    ssh_dir: &Path,
    home: &Path,
    follow_includes: bool,
) -> Vec<SshConfigHost> {
    let mut hosts: Vec<SshConfigHost> = Vec::new();
    // `None` while outside any block or inside a `Match` block.
    let mut current: Option<Vec<SshConfigHost>> = None;

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((keyword, value)) = split_keyword(line) else {
            continue;
        };
        match keyword.to_ascii_lowercase().as_str() {
            "host" => {
                flush(&mut hosts, current.take());
                let aliases: Vec<SshConfigHost> = split_values(value)
                    .into_iter()
                    .filter(|alias| !alias.contains(['*', '?', '!']))
                    .map(|alias| SshConfigHost {
                        alias,
                        ..Default::default()
                    })
                    .collect();
                current = Some(aliases);
            }
            "match" => {
                flush(&mut hosts, current.take());
            }
            "include" => {
                if follow_includes {
                    for pattern in split_values(value) {
                        for included in resolve_include(&pattern, ssh_dir, home) {
                            let entries = parse_config_file(&included, ssh_dir, home, false);
                            match current.as_mut() {
                                // Inside a Host block an Include contributes options to that block.
                                Some(block) => {
                                    for entry in entries {
                                        for host in block.iter_mut() {
                                            merge_missing(host, &entry);
                                        }
                                    }
                                }
                                None => hosts.extend(entries),
                            }
                        }
                    }
                }
            }
            other => {
                if let Some(block) = current.as_mut() {
                    let value = unquote(value);
                    for host in block.iter_mut() {
                        apply_option(host, other, &value);
                    }
                }
            }
        }
    }
    flush(&mut hosts, current.take());
    dedupe(hosts)
}

fn flush(hosts: &mut Vec<SshConfigHost>, block: Option<Vec<SshConfigHost>>) {
    if let Some(block) = block {
        hosts.extend(block);
    }
}

fn apply_option(host: &mut SshConfigHost, keyword: &str, value: &str) {
    if value.is_empty() {
        return;
    }
    // ssh keeps the first value it sees for an option.
    match keyword {
        "hostname" if host.host_name.is_none() => host.host_name = Some(value.to_string()),
        "user" if host.user.is_none() => host.user = Some(value.to_string()),
        "port" if host.port.is_none() => host.port = value.parse::<u16>().ok().filter(|p| *p > 0),
        "identityfile" if host.identity_file.is_none() => {
            host.identity_file = Some(value.to_string())
        }
        _ => {}
    }
}

fn merge_missing(host: &mut SshConfigHost, other: &SshConfigHost) {
    if host.host_name.is_none() {
        host.host_name.clone_from(&other.host_name);
    }
    if host.user.is_none() {
        host.user.clone_from(&other.user);
    }
    if host.port.is_none() {
        host.port = other.port;
    }
    if host.identity_file.is_none() {
        host.identity_file.clone_from(&other.identity_file);
    }
}

/// First occurrence of an alias wins, matching ssh's first-match semantics.
fn dedupe(hosts: Vec<SshConfigHost>) -> Vec<SshConfigHost> {
    let mut seen = std::collections::HashSet::new();
    hosts
        .into_iter()
        .filter(|host| seen.insert(host.alias.clone()))
        .collect()
}

/// `Keyword value`, `Keyword=value`, or `Keyword = value`.
fn split_keyword(line: &str) -> Option<(&str, &str)> {
    let end = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let keyword = &line[..end];
    let rest = line[end..]
        .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
        .trim();
    (!keyword.is_empty()).then_some((keyword, rest))
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

/// Whitespace-separated values, honouring double quotes.
fn split_values(value: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for c in value.chars() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if !current.is_empty() {
                    values.push(std::mem::take(&mut current));
                }
            }
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        values.push(current);
    }
    values
}

fn resolve_include(pattern: &str, ssh_dir: &Path, home: &Path) -> Vec<PathBuf> {
    let expanded = if let Some(rest) = pattern.strip_prefix("~/") {
        home.join(rest)
    } else if pattern == "~" {
        home.to_path_buf()
    } else if Path::new(pattern).is_absolute() {
        PathBuf::from(pattern)
    } else {
        ssh_dir.join(pattern)
    };
    let text = expanded.to_string_lossy();
    match glob::glob(&text) {
        Ok(paths) => {
            let mut files: Vec<PathBuf> = paths
                .filter_map(Result::ok)
                .filter(|p| p.is_file())
                .collect();
            files.sort();
            files
        }
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(alias: &str) -> SshConfigHost {
        SshConfigHost {
            alias: alias.into(),
            ..Default::default()
        }
    }

    #[test]
    fn parses_hosts_includes_aliases_and_skips_wildcards_and_match() {
        let home = tempfile::tempdir().unwrap();
        let ssh_dir = home.path().join(".ssh");
        std::fs::create_dir_all(ssh_dir.join("conf.d")).unwrap();
        std::fs::write(
            ssh_dir.join("conf.d/work.conf"),
            "Host build\n  HostName build.internal\n  User ci\n  Port 2222\n  IdentityFile ~/.ssh/id_work\n\nInclude nested.conf\n",
        )
        .unwrap();
        // Nested includes are not followed (one level only).
        std::fs::write(
            ssh_dir.join("nested.conf"),
            "Host nested\n  HostName nested.example\n",
        )
        .unwrap();
        let config = r#"
# comment
Include conf.d/*.conf

Host dev staging
  HostName=dev.example.com
  User "alice"
  Port 22

Host *.example.com !dev bastion?
  User nobody

Match host build
  User matched

Host lab
  HostName lab.local
  HostName ignored.later

Host dev
  User duplicate
"#;
        let hosts = parse_config(config, &ssh_dir, home.path(), true);
        assert_eq!(
            hosts,
            vec![
                SshConfigHost {
                    host_name: Some("build.internal".into()),
                    user: Some("ci".into()),
                    port: Some(2222),
                    identity_file: Some("~/.ssh/id_work".into()),
                    ..host("build")
                },
                SshConfigHost {
                    host_name: Some("dev.example.com".into()),
                    user: Some("alice".into()),
                    port: Some(22),
                    ..host("dev")
                },
                SshConfigHost {
                    host_name: Some("dev.example.com".into()),
                    user: Some("alice".into()),
                    port: Some(22),
                    ..host("staging")
                },
                SshConfigHost {
                    host_name: Some("lab.local".into()),
                    ..host("lab")
                },
            ]
        );
    }

    #[test]
    fn missing_config_is_empty() {
        let home = tempfile::tempdir().unwrap();
        let ssh_dir = home.path().join(".ssh");
        assert!(parse_config_file(&ssh_dir.join("config"), &ssh_dir, home.path(), true).is_empty());
    }

    #[test]
    fn splits_keywords_and_values() {
        assert_eq!(split_keyword("HostName=x"), Some(("HostName", "x")));
        assert_eq!(split_keyword("Port = 22"), Some(("Port", "22")));
        assert_eq!(split_values(r#"a "b c" d"#), vec!["a", "b c", "d"]);
    }
}
