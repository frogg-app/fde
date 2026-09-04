//! The WS envelope, and only the envelope.
//!
//! `WSInboundMessageSchema` in @fde/protocol is a 4-arm discriminated union, one
//! arm of which (`session`) wraps all 198 session message types. We model the 4
//! arms and keep the session payload as raw JSON, so unimplemented message types
//! can be forwarded upstream byte-for-byte rather than round-tripped through a
//! Rust type we would have to keep in sync.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Inbound {
    Ping(Ping),
    Hello(Value),
    RecordingState(Value),
    Session { message: Value },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Ping {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
}

impl Inbound {
    /// The session message discriminator, for routing and metrics. `None` for
    /// non-session envelopes or a session message with no string `type`.
    pub fn session_type(&self) -> Option<&str> {
        match self {
            Inbound::Session { message } => message.get("type")?.as_str(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_ping_envelope() {
        let msg: Inbound = serde_json::from_str(r#"{"type":"ping","timestamp":42}"#).unwrap();
        assert!(matches!(msg, Inbound::Ping(Ping { timestamp: Some(42) })));
    }

    #[test]
    fn keeps_unknown_session_payloads_intact() {
        let raw = r#"{"type":"session","message":{"type":"create_agent_request","x":{"deep":[1,2]}}}"#;
        let msg: Inbound = serde_json::from_str(raw).unwrap();
        assert_eq!(msg.session_type(), Some("create_agent_request"));
        // Round-trips without loss, which is what makes opaque proxying safe.
        let back = serde_json::to_value(&msg).unwrap();
        assert_eq!(back, serde_json::from_str::<serde_json::Value>(raw).unwrap());
    }

    #[test]
    fn rejects_an_unknown_envelope_type() {
        assert!(serde_json::from_str::<Inbound>(r#"{"type":"nope"}"#).is_err());
    }
}
