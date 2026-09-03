//! `network_local_addresses` and `network_reverse_lookup`: what the UI's
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
