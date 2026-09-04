//! Reads the same on-disk state as the Node daemon: `$FDE_HOME/config.json` for
//! listen/CORS/password, and `$FDE_HOME/principals.json` for issued credentials.
//!
//! Both are read best-effort — a missing or malformed file yields defaults, which
//! is what the Node daemon does, rather than refusing to boot.

use crate::auth::AuthConfig;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Deserialize)]
struct PersistedConfig {
    #[serde(default)]
    daemon: Option<DaemonSection>,
}

#[derive(Debug, Default, Deserialize)]
struct DaemonSection {
    #[serde(default)]
    listen: Option<String>,
    #[serde(default)]
    cors: Option<CorsSection>,
    #[serde(default)]
    auth: Option<AuthSection>,
    #[serde(default, rename = "trustLan")]
    trust_lan: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct CorsSection {
    #[serde(default, rename = "allowedOrigins")]
    allowed_origins: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct AuthSection {
    /// Already a bcrypt hash on disk; never a plaintext password.
    #[serde(default)]
    password: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct PrincipalsFile {
    #[serde(default)]
    principals: Vec<Principal>,
}

#[derive(Debug, Default, Deserialize)]
struct Principal {
    #[serde(default)]
    credentials: Vec<Credential>,
}

#[derive(Debug, Deserialize)]
struct Credential {
    sha256: String,
}

pub struct Loaded {
    pub listen: Option<String>,
    /// Stable id shared with the Node daemon via $FDE_HOME/server-id.
    pub server_id: String,
    pub allowed_origins: Vec<String>,
    pub auth: AuthConfig,
}

/// `$FDE_HOME`, else `$PASEO_HOME`, else `~/.fde`.
pub fn resolve_home() -> Option<PathBuf> {
    for key in ["FDE_HOME", "PASEO_HOME"] {
        if let Ok(value) = std::env::var(key) {
            if !value.trim().is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    std::env::var("HOME")
        .ok()
        .map(|h| Path::new(&h).join(".fde"))
}

pub fn load(home: Option<&Path>) -> Loaded {
    let config: PersistedConfig = home
        .map(|h| h.join("config.json"))
        .and_then(read_json)
        .unwrap_or_default();
    let principals: PrincipalsFile = home
        .map(|h| h.join("principals.json"))
        .and_then(read_json)
        .unwrap_or_default();

    let daemon = config.daemon.unwrap_or_default();
    let credential_hashes = principals
        .principals
        .into_iter()
        .flat_map(|p| p.credentials)
        .map(|c| c.sha256)
        .collect();

    // PASEO_PASSWORD is plaintext in the env; the Node daemon bcrypts it at load.
    // We hash it here for the same reason, so the compare path is uniform.
    let password_hash = match std::env::var("PASEO_PASSWORD")
        .ok()
        .filter(|p| !p.trim().is_empty())
    {
        Some(plain) => bcrypt::hash(plain.trim(), 12).ok(),
        None => daemon.auth.and_then(|a| a.password),
    };

    Loaded {
        listen: daemon.listen,
        server_id: read_or_create_server_id(home),
        allowed_origins: daemon.cors.map(|c| c.allowed_origins).unwrap_or_default(),
        auth: AuthConfig {
            password_hash,
            credential_hashes,
            trust_lan: daemon.trust_lan.unwrap_or(true),
        },
    }
}

/// Reuses the Node daemon's server-id so both report the same identity for the
/// same home. Falls back to an ephemeral id when there is no writable home.
fn read_or_create_server_id(home: Option<&Path>) -> String {
    let Some(path) = home.map(|h| h.join("server-id")) else {
        return ephemeral_server_id();
    };
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let trimmed = existing.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let generated = ephemeral_server_id();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, &generated);
    generated
}

fn ephemeral_server_id() -> String {
    // Matches the Node daemon's srv_<token> shape.
    format!("srv_{}", uuid::Uuid::new_v4().simple())
}

fn read_json<T: serde::de::DeserializeOwned>(path: PathBuf) -> Option<T> {
    let raw = std::fs::read_to_string(&path).ok()?;
    match serde_json::from_str(&raw) {
        Ok(value) => Some(value),
        Err(err) => {
            tracing::warn!(path = %path.display(), error = %err, "ignoring unreadable config file");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tempdir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fde-rs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_listen_origins_and_credentials() {
        let dir = tempdir();
        std::fs::write(
            dir.join("config.json"),
            r#"{"daemon":{"listen":"0.0.0.0:6767","cors":{"allowedOrigins":["http://a"]},
                "auth":{"password":"$2b$12$abc"},"trustLan":false}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("principals.json"),
            r#"{"version":1,"principals":[{"id":"p","label":"l","createdAt":"t","permissions":[],
                "credentials":[{"id":"c","sha256":"aa","createdAt":"t"}]}]}"#,
        )
        .unwrap();

        std::fs::write(dir.join("server-id"), "srv_fromdisk\n").unwrap();
        let loaded = load(Some(&dir));
        assert_eq!(
            loaded.server_id, "srv_fromdisk",
            "must reuse the Node daemon's id"
        );
        assert_eq!(loaded.listen.as_deref(), Some("0.0.0.0:6767"));
        assert_eq!(loaded.allowed_origins, vec!["http://a".to_string()]);
        assert_eq!(loaded.auth.password_hash.as_deref(), Some("$2b$12$abc"));
        assert_eq!(loaded.auth.credential_hashes, vec!["aa".to_string()]);
        assert!(!loaded.auth.trust_lan);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn generates_and_persists_a_server_id_when_none_exists() {
        let dir = tempdir();
        let first = load(Some(&dir)).server_id;
        assert!(first.starts_with("srv_"));
        assert_eq!(
            load(Some(&dir)).server_id,
            first,
            "must be stable across restarts"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_missing_or_malformed_home_yields_defaults_rather_than_failing() {
        let loaded = load(Some(Path::new("/nonexistent-fde-home")));
        assert!(loaded.listen.is_none());
        assert!(loaded.auth.password_hash.is_none());
        assert!(
            loaded.auth.trust_lan,
            "trustLan defaults to true like the Node daemon"
        );

        let dir = tempdir();
        std::fs::write(dir.join("config.json"), "{ not json").unwrap();
        assert!(load(Some(&dir)).listen.is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
