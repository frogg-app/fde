//! Env-var parity with the Node daemon. Same names, same defaults, so the Rust
//! daemon can be dropped into an existing install without touching the unit file.

use std::net::SocketAddr;

pub struct Config {
    /// Address to bind. `PASEO_LISTEN` (host:port) wins over `PASEO_PORT`.
    pub listen: SocketAddr,
    /// Upstream Node daemon for message types not yet implemented natively.
    /// `None` means run standalone and reject unknown types instead of proxying.
    pub upstream: Option<String>,
    pub home: Option<String>,
    pub web_ui_enabled: bool,
}

const DEFAULT_PORT: u16 = 9999;

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let listen = match std::env::var("PASEO_LISTEN") {
            Ok(v) if !v.trim().is_empty() => parse_listen(v.trim())?,
            _ => {
                let port = std::env::var("PASEO_PORT")
                    .ok()
                    .and_then(|p| p.trim().parse::<u16>().ok())
                    .unwrap_or(DEFAULT_PORT);
                SocketAddr::from(([127, 0, 0, 1], port))
            }
        };

        Ok(Self {
            listen,
            upstream: std::env::var("FDE_RS_UPSTREAM").ok().filter(|v| !v.is_empty()),
            home: std::env::var("FDE_HOME").or_else(|_| std::env::var("PASEO_HOME")).ok(),
            web_ui_enabled: std::env::var("PASEO_WEB_UI_ENABLED")
                .map(|v| v != "0" && v != "false")
                .unwrap_or(true),
        })
    }
}

/// Accepts `host:port` and a bare `port`, matching the Node daemon's parsing.
fn parse_listen(value: &str) -> anyhow::Result<SocketAddr> {
    if let Ok(port) = value.parse::<u16>() {
        return Ok(SocketAddr::from(([127, 0, 0, 1], port)));
    }
    let (host, port) = value
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("PASEO_LISTEN must be host:port or port, got {value:?}"))?;
    let port: u16 = port
        .parse()
        .map_err(|_| anyhow::anyhow!("PASEO_LISTEN has a non-numeric port: {value:?}"))?;
    let host = host.trim_matches(|c| c == '[' || c == ']');
    let ip = if host == "localhost" {
        "127.0.0.1".parse()?
    } else {
        host.parse()?
    };
    Ok(SocketAddr::new(ip, port))
}

#[cfg(test)]
mod tests {
    use super::parse_listen;

    #[test]
    fn parses_the_forms_the_node_daemon_accepts() {
        assert_eq!(parse_listen("0.0.0.0:6767").unwrap().to_string(), "0.0.0.0:6767");
        assert_eq!(parse_listen("6767").unwrap().to_string(), "127.0.0.1:6767");
        assert_eq!(parse_listen("localhost:80").unwrap().to_string(), "127.0.0.1:80");
        assert_eq!(parse_listen("[::1]:6767").unwrap().to_string(), "[::1]:6767");
        assert!(parse_listen("0.0.0.0:not-a-port").is_err());
    }
}
