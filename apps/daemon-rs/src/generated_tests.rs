//! Round-trip checks for the generated protocol types.
//!
//! The value of generating from zod is that Rust and TypeScript cannot disagree
//! about the wire format. These tests pin that: real message shapes must
//! deserialize into the generated types and serialize back unchanged.

#[cfg(test)]
mod tests {
    use crate::generated::inbound::WsInboundMessage;
    use serde_json::json;

    /// Deserializes, re-serializes, and compares against the original JSON.
    fn round_trip(value: serde_json::Value) {
        let parsed: WsInboundMessage = serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("failed to parse {value}: {e}"));
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(back, value, "round trip changed the message");
    }

    #[test]
    fn parses_the_handshake_the_client_actually_sends() {
        round_trip(json!({
            "type": "hello",
            "clientId": "cid_1",
            "clientType": "cli",
            "protocolVersion": 1
        }));
    }

    #[test]
    fn parses_a_ping() {
        round_trip(json!({ "type": "ping" }));
    }

    #[test]
    fn parses_session_requests_across_the_surface() {
        for message in [
            json!({ "type": "fetch_agents_request", "requestId": "r1" }),
            json!({ "type": "checkout_status_request", "requestId": "r2", "cwd": "/repo" }),
            json!({
                "type": "create_terminal_request",
                "cwd": "/tmp",
                "workspaceId": "w1",
                "requestId": "r3",
                "size": { "rows": 24, "cols": 80 }
            }),
            json!({ "type": "abort_request" }),
        ] {
            round_trip(json!({ "type": "session", "message": message }));
        }
    }

    #[test]
    fn keeps_optional_fields_absent_rather_than_null() {
        // skip_serializing_if on every Option: a field the client omitted must
        // not come back as an explicit null, which some consumers treat
        // differently from absent.
        let value = json!({ "type": "session", "message": {
            "type": "fetch_agents_request", "requestId": "r1"
        }});
        let parsed: WsInboundMessage = serde_json::from_value(value.clone()).unwrap();
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(back, value);
        assert!(!back.to_string().contains("null"));
    }

    #[test]
    fn rejects_an_unknown_message_type() {
        let result: Result<WsInboundMessage, _> =
            serde_json::from_value(json!({ "type": "no_such_message" }));
        assert!(result.is_err());
    }

    #[test]
    fn enum_fields_reject_values_outside_the_schema() {
        let bad = json!({
            "type": "hello",
            "clientId": "c",
            "clientType": "toaster",
            "protocolVersion": 1
        });
        assert!(serde_json::from_value::<WsInboundMessage>(bad).is_err());
    }
}
