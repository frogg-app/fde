//! `paseo://h/<serverId>/agent/<agentId>` links, mirroring
//! `packages/protocol/src/agent-deep-link.ts`. The scheme stays `paseo` because
//! the daemon and CLI emit these links.

use percent_encoding::percent_decode_str;
use serde::Serialize;
use url::Url;

pub const SCHEME: &str = "paseo";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeepLinkTarget {
    pub server_id: String,
    pub agent_id: String,
}

fn decode_segment(segment: &str) -> Option<String> {
    let decoded = percent_decode_str(segment).decode_utf8().ok()?;
    let trimmed = decoded.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn parse_agent_deep_link(input: &str) -> Option<AgentDeepLinkTarget> {
    let url = Url::parse(input.trim()).ok()?;
    if url.scheme() != SCHEME
        || url.host_str() != Some("h")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }

    let segments: Vec<&str> = url.path_segments()?.filter(|s| !s.is_empty()).collect();
    if segments.len() != 3 || segments[1] != "agent" {
        return None;
    }

    Some(AgentDeepLinkTarget {
        server_id: decode_segment(segments[0])?,
        agent_id: decode_segment(segments[2])?,
    })
}

pub fn parse_agent_deep_link_from_args(args: &[String]) -> Option<AgentDeepLinkTarget> {
    args.iter().find_map(|arg| parse_agent_deep_link(arg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_link() {
        let target = parse_agent_deep_link("paseo://h/my-host/agent/agent-123").unwrap();
        assert_eq!(target.server_id, "my-host");
        assert_eq!(target.agent_id, "agent-123");
    }

    #[test]
    fn decodes_percent_encoded_segments() {
        let target = parse_agent_deep_link("paseo://h/host%20one/agent/a%2Fb").unwrap();
        assert_eq!(target.server_id, "host one");
        assert_eq!(target.agent_id, "a/b");
    }

    #[test]
    fn rejects_other_shapes() {
        assert!(parse_agent_deep_link("https://h/x/agent/y").is_none());
        assert!(parse_agent_deep_link("paseo://h/x/agent").is_none());
        assert!(parse_agent_deep_link("paseo://h/x/thread/y").is_none());
        assert!(parse_agent_deep_link("paseo://h/x/agent/y?foo=1").is_none());
        assert!(parse_agent_deep_link("paseo://h/x/agent/y#frag").is_none());
        assert!(parse_agent_deep_link("paseo://other/x/agent/y").is_none());
        assert!(parse_agent_deep_link("/home/user/project").is_none());
    }

    #[test]
    fn picks_first_link_from_args() {
        let args = vec![
            "frogg-de".to_string(),
            "--flag".to_string(),
            "paseo://h/s/agent/a".to_string(),
        ];
        assert_eq!(
            parse_agent_deep_link_from_args(&args).unwrap(),
            AgentDeepLinkTarget { server_id: "s".into(), agent_id: "a".into() }
        );
    }
}
