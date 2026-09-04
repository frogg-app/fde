//! Bearer/origin authorization, ported from `server/auth.ts` and the
//! `verifyWsUpgrade` path in `server/websocket-server.ts`.

use crate::netclass::{self, Locality};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Debug, Default, Clone, Deserialize)]
pub struct AuthConfig {
    /// bcrypt hash of the daemon password, as written by `hashDaemonPassword`.
    #[serde(default)]
    pub password_hash: Option<String>,
    /// sha256-hex hashes of issued client credentials (the claim store).
    #[serde(default)]
    pub credential_hashes: Vec<String>,
    #[serde(default = "default_trust_lan")]
    pub trust_lan: bool,
}

fn default_trust_lan() -> bool {
    true
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Ok,
    Unclaimed,
    MissingToken,
    InvalidToken,
}

impl AuthConfig {
    fn has_secrets(&self) -> bool {
        self.password_hash.is_some() || !self.credential_hashes.is_empty()
    }

    pub fn needs_bearer(&self, client: Locality) -> bool {
        netclass::is_auth_required(self.password_hash.is_some(), client, self.trust_lan)
    }

    /// Mirrors `authorizeBearerSync`. Returns `Ok` when the request may proceed.
    pub fn authorize(&self, client: Locality, token: Option<&str>) -> Decision {
        if !self.needs_bearer(client) {
            return Decision::Ok;
        }
        if !self.has_secrets() {
            return Decision::Unclaimed;
        }
        let Some(token) = token else {
            return Decision::MissingToken;
        };
        if self.token_is_valid(token) {
            Decision::Ok
        } else {
            Decision::InvalidToken
        }
    }

    fn token_is_valid(&self, token: &str) -> bool {
        if matches_credential(token, &self.credential_hashes) {
            return true;
        }
        match &self.password_hash {
            // bcrypt is deliberately slow; that cost is the point.
            Some(hash) => bcrypt::verify(token, hash).unwrap_or(false),
            None => false,
        }
    }
}

/// Constant-time comparison against every stored hash, matching the Node code's
/// deliberate non-short-circuit loop.
fn matches_credential(token: &str, credential_hashes: &[String]) -> bool {
    let provided = Sha256::digest(token.as_bytes());
    let mut matched = false;
    for hash in credential_hashes {
        let Ok(expected) = hex_decode(hash) else { continue };
        if expected.len() == provided.len() {
            matched |= bool::from(provided.as_slice().ct_eq(&expected));
        }
    }
    matched
}

fn hex_decode(value: &str) -> Result<Vec<u8>, ()> {
    if value.len() % 2 != 0 {
        return Err(());
    }
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| ()))
        .collect()
}

/// `extractWsBearerProtocol` + `extractWsBearerToken`: the token rides in
/// `Sec-WebSocket-Protocol` as `paseo.bearer.<token>`.
pub fn extract_ws_bearer_token(header: Option<&str>) -> Option<String> {
    let header = header?;
    for protocol in header.split(',') {
        let trimmed = protocol.trim();
        let mut segments = trimmed.split('.');
        if segments.next() == Some("paseo") && segments.next() == Some("bearer") {
            let rest: Vec<&str> = segments.collect();
            if !rest.is_empty() {
                // The token may itself contain dots; rejoin them.
                return Some(rest.join("."));
            }
        }
    }
    None
}

/// `extractHttpBearerToken`: exactly `Bearer <token>`, one whitespace-separated arg.
pub fn extract_http_bearer_token(header: Option<&str>) -> Option<String> {
    let parts: Vec<&str> = header?.trim().split_whitespace().collect();
    match parts.as_slice() {
        ["Bearer", token] => Some((*token).to_string()),
        _ => None,
    }
}

/// `isWebSocketSameOrigin`: an exact scheme+host match, or loopback-to-loopback
/// on the same port.
pub fn is_same_origin(origin: Option<&str>, request_host: Option<&str>) -> bool {
    let (Some(origin), Some(host)) = (origin, request_host) else {
        return false;
    };
    if origin == format!("http://{host}") || origin == format!("https://{host}") {
        return true;
    }
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    let default_port = match scheme {
        "http" | "ws" => "80",
        "https" | "wss" => "443",
        _ => return false,
    };
    let (origin_host, origin_port) = split_authority(rest, default_port);
    let (host_name, host_port) = split_authority(host, default_port);
    origin_port == host_port
        && netclass::is_loopback_alias(&origin_host)
        && netclass::is_loopback_alias(&host_name)
}

/// Splits `host[:port]`, tolerating a bracketed IPv6 literal.
fn split_authority(value: &str, default_port: &str) -> (String, String) {
    let value = value.split('/').next().unwrap_or(value);
    if let Some(rest) = value.strip_prefix('[') {
        if let Some((host, tail)) = rest.split_once(']') {
            let port = tail.strip_prefix(':').unwrap_or(default_port);
            return (host.to_string(), port.to_string());
        }
    }
    match value.rsplit_once(':') {
        Some((host, port)) if !port.contains(':') => (host.to_string(), port.to_string()),
        // A bare IPv6 literal has many colons and no port.
        _ => (value.to_string(), default_port.to_string()),
    }
}

/// The origin half of `verifyWsUpgrade`: no Origin at all is allowed (non-browser
/// clients), otherwise it must be allow-listed or same-origin.
pub fn origin_allowed(
    origin: Option<&str>,
    request_host: Option<&str>,
    allowed: &[String],
) -> bool {
    let Some(origin) = origin else { return true };
    allowed.iter().any(|a| a == "*" || a == origin) || is_same_origin(Some(origin), request_host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_ws_bearer_token() {
        assert_eq!(
            extract_ws_bearer_token(Some("paseo.bearer.abc123")).as_deref(),
            Some("abc123")
        );
        // Tokens containing dots (e.g. JWTs) must survive rejoining.
        assert_eq!(
            extract_ws_bearer_token(Some("other, paseo.bearer.a.b.c")).as_deref(),
            Some("a.b.c")
        );
        assert_eq!(extract_ws_bearer_token(Some("paseo.bearer")), None);
        assert_eq!(extract_ws_bearer_token(None), None);
    }

    #[test]
    fn extracts_an_http_bearer_token() {
        assert_eq!(extract_http_bearer_token(Some("Bearer tok")).as_deref(), Some("tok"));
        assert_eq!(extract_http_bearer_token(Some("bearer tok")), None);
        assert_eq!(extract_http_bearer_token(Some("Bearer a b")), None);
    }

    #[test]
    fn loopback_clients_skip_auth_when_no_password_is_set() {
        let cfg = AuthConfig::default();
        assert_eq!(cfg.authorize(Locality::Loopback, None), Decision::Ok);
    }

    #[test]
    fn public_clients_without_secrets_are_unclaimed() {
        let cfg = AuthConfig::default();
        assert_eq!(cfg.authorize(Locality::Public, None), Decision::Unclaimed);
    }

    #[test]
    fn accepts_a_matching_credential_hash() {
        let cfg = AuthConfig {
            credential_hashes: vec![hex_encode(&Sha256::digest(b"s3cret"))],
            ..Default::default()
        };
        assert_eq!(cfg.authorize(Locality::Public, Some("s3cret")), Decision::Ok);
        assert_eq!(cfg.authorize(Locality::Public, Some("wrong")), Decision::InvalidToken);
        assert_eq!(cfg.authorize(Locality::Public, None), Decision::MissingToken);
    }

    #[test]
    fn accepts_a_bcrypt_password_and_forces_auth_on_loopback() {
        let cfg = AuthConfig {
            // Cost 4 keeps the test fast; production uses 12.
            password_hash: Some(bcrypt::hash("hunter2", 4).unwrap()),
            ..Default::default()
        };
        assert_eq!(cfg.authorize(Locality::Loopback, Some("hunter2")), Decision::Ok);
        assert_eq!(cfg.authorize(Locality::Loopback, Some("nope")), Decision::InvalidToken);
        assert_eq!(cfg.authorize(Locality::Loopback, None), Decision::MissingToken);
    }

    #[test]
    fn same_origin_covers_loopback_aliases_on_a_shared_port() {
        assert!(is_same_origin(Some("http://127.0.0.1:9999"), Some("127.0.0.1:9999")));
        assert!(is_same_origin(Some("http://localhost:9999"), Some("127.0.0.1:9999")));
        assert!(!is_same_origin(Some("http://localhost:9999"), Some("127.0.0.1:8888")));
        assert!(!is_same_origin(Some("http://evil.com"), Some("127.0.0.1:9999")));
        assert!(!is_same_origin(None, Some("127.0.0.1:9999")));
    }

    #[test]
    fn origin_gate_matches_the_node_rules() {
        let allowed = vec!["http://tauri.localhost".to_string()];
        // Non-browser clients send no Origin and are allowed through.
        assert!(origin_allowed(None, Some("127.0.0.1:9999"), &allowed));
        assert!(origin_allowed(Some("http://tauri.localhost"), None, &allowed));
        assert!(!origin_allowed(Some("http://evil.com"), Some("127.0.0.1:9999"), &allowed));
        assert!(origin_allowed(Some("http://evil.com"), None, &["*".to_string()]));
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn hex_decode_rejects_malformed_hashes() {
        assert!(hex_decode("abc").is_err());
        assert!(hex_decode("zz").is_err());
        assert_eq!(hex_decode("ff00").unwrap(), vec![255, 0]);
    }
}
