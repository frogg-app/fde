//! Client address classification, ported from `server/access-policy.ts`.
//!
//! Deliberately mirrors the Node implementation's shapes (including its
//! IPv4-mapped-IPv6 handling) so the two daemons make identical trust decisions.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Locality {
    Loopback,
    Lan,
    Public,
}

/// Strips an `::ffff:` prefix and lowercases, matching `normalizeIp`.
fn normalize(address: &str) -> String {
    let trimmed = address.trim().to_ascii_lowercase();
    trimmed
        .strip_prefix("::ffff:")
        .map(str::to_owned)
        .unwrap_or(trimmed)
}

pub fn is_loopback_ip(address: &str) -> bool {
    let normalized = address.trim().to_ascii_lowercase();
    if normalized == "::1" || normalized == "0:0:0:0:0:0:0:1" {
        return true;
    }
    let candidate = normalize(&normalized);
    // Node checks `startsWith("127.")` on a validated IPv4, not the full /8 range.
    matches!(candidate.parse::<Ipv4Addr>(), Ok(v4) if v4.octets()[0] == 127)
}

pub fn is_private_lan_ip(address: &str) -> bool {
    let normalized = normalize(address);
    if let Ok(v4) = normalized.parse::<Ipv4Addr>() {
        let [a, b, ..] = v4.octets();
        return a == 10
            || (a == 172 && (16..=31).contains(&b))
            || (a == 192 && b == 168)
            || (a == 169 && b == 254);
    }
    let Ok(v6) = normalized.parse::<Ipv6Addr>() else {
        return false;
    };
    let first = v6.segments()[0];
    // fc00::/7 (unique local) and fe80::/10 (link local).
    (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
}

pub fn classify(address: Option<&str>) -> Locality {
    let Some(address) = address else {
        // Unix sockets and named pipes have no remote address and are local
        // by construction.
        return Locality::Loopback;
    };
    if is_loopback_ip(address) {
        Locality::Loopback
    } else if is_private_lan_ip(address) {
        Locality::Lan
    } else {
        Locality::Public
    }
}

pub fn is_client_trusted(client: Locality, trust_lan: bool) -> bool {
    client == Locality::Loopback || (client == Locality::Lan && trust_lan)
}

/// `isAuthRequired`: a configured password always forces auth; otherwise trust
/// follows locality.
pub fn is_auth_required(has_password: bool, client: Locality, trust_lan: bool) -> bool {
    has_password || !is_client_trusted(client, trust_lan)
}

pub fn is_loopback_alias(host: &str) -> bool {
    let host = host.trim().to_ascii_lowercase();
    host == "localhost" || matches!(host.parse::<IpAddr>(), Ok(ip) if ip.is_loopback())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_loopback() {
        assert!(is_loopback_ip("127.0.0.1"));
        assert!(is_loopback_ip("127.5.5.5"));
        assert!(is_loopback_ip("::1"));
        assert!(is_loopback_ip("0:0:0:0:0:0:0:1"));
        assert!(is_loopback_ip("::ffff:127.0.0.1"));
        assert!(!is_loopback_ip("128.0.0.1"));
        assert!(!is_loopback_ip(""));
    }

    #[test]
    fn classifies_private_lan_ranges() {
        for addr in [
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.10",
            "169.254.1.1",
        ] {
            assert!(is_private_lan_ip(addr), "{addr} should be LAN");
        }
        for addr in ["172.15.0.1", "172.32.0.1", "8.8.8.8", "1.1.1.1"] {
            assert!(!is_private_lan_ip(addr), "{addr} should not be LAN");
        }
        assert!(is_private_lan_ip("fd00::1")); // unique local
        assert!(is_private_lan_ip("fe80::1")); // link local
        assert!(!is_private_lan_ip("2001:4860::1"));
    }

    #[test]
    fn auth_is_required_for_public_clients_but_not_loopback() {
        assert!(!is_auth_required(false, Locality::Loopback, false));
        assert!(is_auth_required(false, Locality::Public, true));
        assert!(is_auth_required(false, Locality::Lan, false));
        assert!(!is_auth_required(false, Locality::Lan, true));
        // A password overrides locality entirely.
        assert!(is_auth_required(true, Locality::Loopback, true));
    }

    #[test]
    fn missing_address_is_treated_as_loopback() {
        assert_eq!(classify(None), Locality::Loopback);
        assert_eq!(classify(Some("192.168.0.5")), Locality::Lan);
        assert_eq!(classify(Some("8.8.8.8")), Locality::Public);
    }
}
