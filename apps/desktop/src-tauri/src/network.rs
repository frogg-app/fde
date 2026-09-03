//! `network_local_addresses`, `network_reverse_lookup` and
//! `network_probe_identity`: what the UI's
//! LAN scanner needs from the machine it runs on. Addresses are the IPv4
//! ones of interfaces that are up, with their prefix length, minus loopback
//! and link-local; reverse lookup is one `getnameinfo` with a 1 s budget.

use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use serde_json::{json, Value};

const REVERSE_LOOKUP_TIMEOUT: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalAddress {
    pub interface: String,
    pub ip: Ipv4Addr,
    pub prefix_length: u8,
}

/// One interface address as reported by the OS, before filtering.
pub struct RawAddress {
    pub interface: String,
    pub ip: Ipv4Addr,
    pub prefix_length: u8,
    pub is_up: bool,
}

/// Keeps the addresses a scanner can do something with: interface up, a
/// unicast address that is neither loopback, link-local (169.254/16),
/// unspecified nor broadcast, and a prefix short enough to name a network
/// (a /32 is a single host, so it is dropped).
pub fn filter_addresses(raw: impl IntoIterator<Item = RawAddress>) -> Vec<LocalAddress> {
    raw.into_iter()
        .filter(|entry| entry.is_up)
        .filter(|entry| {
            let ip = entry.ip;
            !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_unspecified()
                && !ip.is_broadcast()
                && !ip.is_multicast()
        })
        .filter(|entry| (1..=31).contains(&entry.prefix_length))
        .map(|entry| LocalAddress {
            interface: entry.interface,
            ip: entry.ip,
            prefix_length: entry.prefix_length,
        })
        .collect()
}

fn raw_addresses() -> Result<Vec<RawAddress>, String> {
    let interfaces = if_addrs::get_if_addrs().map_err(|e| e.to_string())?;
    Ok(interfaces
        .into_iter()
        .filter_map(|interface| {
            let is_up = interface.is_oper_up();
            match interface.addr {
                if_addrs::IfAddr::V4(v4) => Some(RawAddress {
                    interface: interface.name,
                    ip: v4.ip,
                    prefix_length: v4.prefixlen,
                    is_up,
                }),
                if_addrs::IfAddr::V6(_) => None,
            }
        })
        .collect())
}

/// `[{interface, ip, prefixLength}]`.
pub fn local_addresses() -> Result<Value, String> {
    let addresses = filter_addresses(raw_addresses()?);
    Ok(Value::Array(
        addresses
            .into_iter()
            .map(|address| {
                json!({
                    "interface": address.interface,
                    "ip": address.ip.to_string(),
                    "prefixLength": address.prefix_length,
                })
            })
            .collect(),
    ))
}

/// `network_reverse_lookup {ip}`: the PTR name, or `null` when there is
/// none, the resolver is slow, or the answer is just the address again.
pub async fn reverse_lookup(args: &Value) -> Result<Value, String> {
    let raw = args
        .get("ip")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    let ip: IpAddr = raw
        .parse()
        .map_err(|_| "ip must be an IP address.".to_string())?;
    let lookup = tokio::task::spawn_blocking(move || dns_lookup::lookup_addr(&ip).ok());
    let name = match tokio::time::timeout(REVERSE_LOOKUP_TIMEOUT, lookup).await {
        Ok(Ok(Some(name))) => name,
        _ => return Ok(Value::Null),
    };
    let name = name.trim_end_matches('.').to_string();
    if name.is_empty() || name == raw {
        return Ok(Value::Null);
    }
    Ok(Value::String(name))
}

const PROBE_TIMEOUT: Duration = Duration::from_millis(700);
const PROBE_BODY_LIMIT: usize = 64 * 1024;
const PROBE_PATHS: [&str; 2] = ["/api/identity", "/api/health"];

/// Checks the URL the scanner hands over: plain `http`/`https`, one of the
/// daemon's two discovery paths, nothing else (the command is reachable from
/// the page, so it must not become a general HTTP client).
pub fn validate_probe_url(raw: &str) -> Result<reqwest::Url, String> {
    let url =
        reqwest::Url::parse(raw.trim()).map_err(|_| "url must be an absolute URL.".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("url must use http or https.".into());
    }
    if url.host_str().is_none() {
        return Err("url must name a host.".into());
    }
    if !PROBE_PATHS.contains(&url.path()) || url.query().is_some() || url.fragment().is_some() {
        return Err("url must point at /api/identity or /api/health.".into());
    }
    Ok(url)
}

/// `network_probe_identity {url}`: GET the URL from Rust with a 700 ms
/// budget and answer `{status, body}` (body parsed as JSON, `null` when it
/// is not JSON). The webview cannot be trusted with this request: WebView2
/// applies Chromium's local-network-access rules to `http://tauri.localhost`
/// and silently fails LAN fetches. Errors are the transport's message so the
/// scanner can show the first one.
pub async fn probe_identity(args: &Value) -> Result<Value, String> {
    let raw = args.get("url").and_then(Value::as_str).unwrap_or_default();
    let url = validate_probe_url(raw)?;
    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .connect_timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|error| describe_reqwest_error(&error))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| describe_reqwest_error(&error))?;
    let body = if bytes.len() > PROBE_BODY_LIMIT {
        Value::Null
    } else {
        serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null)
    };
    Ok(json!({ "status": status, "body": body }))
}

fn describe_reqwest_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        return "timed out".into();
    }
    // reqwest's Display nests the cause ("error sending request for url (…): …");
    // the innermost message is the useful part ("Connection refused").
    let mut source: &dyn std::error::Error = error;
    while let Some(next) = source.source() {
        source = next;
    }
    source.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(interface: &str, ip: [u8; 4], prefix_length: u8, is_up: bool) -> RawAddress {
        RawAddress {
            interface: interface.into(),
            ip: Ipv4Addr::from(ip),
            prefix_length,
            is_up,
        }
    }

    #[test]
    fn keeps_up_unicast_addresses_with_their_prefix() {
        let kept = filter_addresses([
            raw("lo", [127, 0, 0, 1], 8, true),
            raw("eth0", [192, 168, 1, 20], 24, true),
            raw("eth1", [10, 0, 0, 5], 16, false),
            raw("wlan0", [169, 254, 3, 4], 16, true),
            raw("docker0", [172, 17, 0, 1], 16, true),
            raw("tun0", [10, 8, 0, 2], 32, true),
            raw("bad", [0, 0, 0, 0], 0, true),
        ]);
        assert_eq!(
            kept,
            vec![
                LocalAddress {
                    interface: "eth0".into(),
                    ip: Ipv4Addr::new(192, 168, 1, 20),
                    prefix_length: 24,
                },
                LocalAddress {
                    interface: "docker0".into(),
                    ip: Ipv4Addr::new(172, 17, 0, 1),
                    prefix_length: 16,
                },
            ]
        );
    }

    /// What `if-addrs` yields on a Windows laptop: adapter names with spaces,
    /// the Wi-Fi /24, Hyper-V / WSL virtual switches (up, /20), a disabled
    /// Ethernet port (OperStatus Down → not up) and an APIPA fallback.
    #[test]
    fn keeps_windows_shaped_addresses_in_order() {
        let kept = filter_addresses([
            raw("Wi-Fi", [192, 168, 1, 42], 24, true),
            raw("Ethernet", [169, 254, 12, 7], 16, true),
            raw("Ethernet 2", [192, 168, 50, 3], 24, false),
            raw("vEthernet (WSL)", [172, 27, 16, 1], 20, true),
            raw("Loopback Pseudo-Interface 1", [127, 0, 0, 1], 8, true),
        ]);
        assert_eq!(
            kept.iter()
                .map(|a| format!("{}/{}", a.ip, a.prefix_length))
                .collect::<Vec<_>>(),
            vec!["192.168.1.42/24", "172.27.16.1/20"]
        );
    }

    #[test]
    fn probe_url_accepts_only_daemon_discovery_paths() {
        assert!(validate_probe_url("http://192.168.1.17:9999/api/identity").is_ok());
        assert!(validate_probe_url("https://box.local/api/health").is_ok());
        for bad in [
            "",
            "192.168.1.17:9999/api/identity",
            "ftp://192.168.1.17/api/identity",
            "file:///etc/passwd",
            "http://192.168.1.17:9999/api/hosts",
            "http://192.168.1.17:9999/api/identity?x=1",
            "http://192.168.1.17:9999/api/identity#f",
        ] {
            assert!(validate_probe_url(bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn probe_identity_returns_status_and_json_or_the_transport_error() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let body = r#"{"product":"fde","serverId":"srv_1","hostname":"box"}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
        });
        tauri::async_runtime::block_on(async {
            let answer = probe_identity(&json!({
                "url": format!("http://127.0.0.1:{port}/api/identity")
            }))
            .await
            .unwrap();
            assert_eq!(answer["status"], 200);
            assert_eq!(answer["body"]["serverId"], "srv_1");

            // A closed port answers quickly with the OS error, not a timeout.
            let closed = TcpListener::bind("127.0.0.1:0").unwrap();
            let closed_port = closed.local_addr().unwrap().port();
            drop(closed);
            let started = std::time::Instant::now();
            let error = probe_identity(&json!({
                "url": format!("http://127.0.0.1:{closed_port}/api/identity")
            }))
            .await
            .unwrap_err();
            assert!(started.elapsed() < Duration::from_secs(3));
            assert!(!error.is_empty());
            assert!(!error.contains("error sending request"), "{error}");

            assert_eq!(
                probe_identity(&json!({ "url": "http://x/" }))
                    .await
                    .unwrap_err(),
                "url must point at /api/identity or /api/health."
            );
        });
    }

    #[test]
    fn reverse_lookup_validates_and_answers_within_budget() {
        tauri::async_runtime::block_on(async {
            assert_eq!(
                reverse_lookup(&json!({ "ip": "not-an-ip" }))
                    .await
                    .unwrap_err(),
                "ip must be an IP address."
            );
            assert!(reverse_lookup(&json!({})).await.is_err());
            // Loopback resolves to "localhost" on most systems, or to
            // nothing; either way the call returns within the budget.
            let started = std::time::Instant::now();
            let answer = reverse_lookup(&json!({ "ip": "127.0.0.1" })).await.unwrap();
            assert!(started.elapsed() < Duration::from_secs(3));
            assert!(answer.is_null() || answer.as_str().is_some_and(|s| !s.is_empty()));
        });
    }
}
