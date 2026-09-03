//! Session vocabulary shared by the transport manager: target parsing (the
//! exact rules of Electron's `parseOpenTransportSessionInput`), the event
//! payloads the webview receives, and the message shapes exchanged with a
//! session task.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

use super::ssh_auth::{password_from_args, SshPassword};

pub const DEFAULT_SSH_DAEMON_PORT: u16 = 9999;
pub const WS_ENDPOINT_PATH: &str = "/ws";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportTarget {
    Ssh {
        host: String,
        ssh_port: Option<u16>,
        daemon_port: Option<u16>,
        /// Answers ssh's password prompt (see `ssh_auth`); absent means
        /// `BatchMode`, keys and agent only.
        password: Option<SshPassword>,
    },
    Socket {
        path: String,
    },
    Pipe {
        path: String,
    },
}

impl TransportTarget {
    /// Human-readable name used in error messages (`describeTransportTarget`).
    pub fn describe(&self) -> String {
        match self {
            TransportTarget::Ssh { host, .. } => format!("Remote SSH host {host}"),
            TransportTarget::Socket { .. } => "local daemon socket".to_string(),
            TransportTarget::Pipe { .. } => "local daemon pipe".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSessionInput {
    pub session_id: String,
    pub target: TransportTarget,
    /// WebSocket subprotocols for the handshake: the daemon password travels
    /// as `paseo.bearer.<password>`, exactly as the browser client sends it.
    pub protocols: Vec<String>,
}

fn validate_ssh_host(raw: &str) -> Result<String, String> {
    let host = raw.trim();
    if host.is_empty() {
        return Err("SSH host is required".into());
    }
    if host.chars().any(char::is_whitespace) || host.starts_with('-') {
        return Err("SSH host is invalid".into());
    }
    Ok(host.to_string())
}

fn parse_port(value: Option<&Value>, label: &str) -> Result<Option<u16>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_u64()
            .filter(|port| (1..=65535).contains(port))
            .map(|port| Some(port as u16))
            .ok_or_else(|| format!("{label} must be between 1 and 65535.")),
        Some(_) => Err(format!("{label} must be between 1 and 65535.")),
    }
}

pub fn parse_transport_target(value: &Value) -> Result<TransportTarget, String> {
    let Some(object) = value.as_object() else {
        return Err("Desktop transport target must be an object.".into());
    };
    let transport_type = object
        .get("transportType")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match transport_type {
        "socket" | "pipe" => {
            let path = object
                .get("transportPath")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default();
            if path.is_empty() {
                return Err("Local transport path is required.".into());
            }
            Ok(if transport_type == "socket" {
                TransportTarget::Socket {
                    path: path.to_string(),
                }
            } else {
                TransportTarget::Pipe {
                    path: path.to_string(),
                }
            })
        }
        "ssh" => Ok(TransportTarget::Ssh {
            host: validate_ssh_host(
                object
                    .get("host")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )?,
            ssh_port: parse_port(object.get("sshPort"), "SSH port")?,
            daemon_port: parse_port(object.get("daemonPort"), "Daemon port")?,
            password: password_from_args(value),
        }),
        _ => Err("Unsupported desktop transport type.".into()),
    }
}

/// RFC 6455 subprotocol names are HTTP tokens; anything else would corrupt
/// the handshake header.
fn is_valid_subprotocol(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "!#$%&'*+-.^_`|~".contains(c))
}

fn parse_protocols(value: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err("Desktop transport protocols must be a list.".into());
    };
    items
        .iter()
        .map(|item| match item.as_str() {
            Some(name) if is_valid_subprotocol(name) => Ok(name.to_string()),
            _ => Err("Desktop transport subprotocol is invalid.".into()),
        })
        .collect()
}

fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn parse_open_session_input(value: &Value) -> Result<OpenSessionInput, String> {
    let Some(object) = value.as_object() else {
        return Err("Desktop transport open input must be an object.".into());
    };
    let session_id = object
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if !is_valid_session_id(session_id) {
        return Err("Desktop transport session ID is invalid.".into());
    }
    Ok(OpenSessionInput {
        session_id: session_id.to_string(),
        target: parse_transport_target(object.get("target").unwrap_or(&Value::Null))?,
        protocols: parse_protocols(object.get("protocols"))?,
    })
}

/// Reads the `sessionId` of a send/close call.
pub fn session_id_from_args(value: &Value) -> String {
    value
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

/// Decodes `{text}` / `{binaryBase64}` into a WebSocket frame.
pub fn decode_outgoing_message(value: &Value) -> Result<Message, String> {
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        return Ok(Message::text(text));
    }
    if let Some(encoded) = value.get("binaryBase64").and_then(Value::as_str) {
        let bytes = BASE64
            .decode(encoded)
            .map_err(|error| format!("Local transport write failed: {error}"))?;
        return Ok(Message::binary(bytes));
    }
    Err("Local transport send requires text or binary payload.".into())
}

// Event payloads, field for field what Electron's `TransportEventPayload` carries.

pub fn open_event(session_id: &str) -> Value {
    json!({ "sessionId": session_id, "kind": "open" })
}

pub fn text_message_event(session_id: &str, text: &str) -> Value {
    json!({ "sessionId": session_id, "kind": "message", "text": text })
}

pub fn binary_message_event(session_id: &str, bytes: &[u8]) -> Value {
    json!({ "sessionId": session_id, "kind": "message", "binaryBase64": BASE64.encode(bytes) })
}

pub fn close_event(session_id: &str, code: u16, reason: &str) -> Value {
    json!({ "sessionId": session_id, "kind": "close", "code": code, "reason": reason })
}

pub fn error_event(session_id: &str, error: &str) -> Value {
    json!({ "sessionId": session_id, "kind": "error", "error": error })
}

/// An error event with a structured `detail` the UI can act on (for
/// example `{kind:"ssh-auth", methods:[…]}`: ssh wants a password).
pub fn error_event_with_detail(session_id: &str, error: &str, detail: Option<Value>) -> Value {
    let mut event = error_event(session_id, error);
    if let Some(detail) = detail {
        event["detail"] = detail;
    }
    event
}

/// Maps an incoming frame to the webview event, or `None` for control frames.
pub fn incoming_message_event(session_id: &str, message: &Message) -> Option<Value> {
    match message {
        Message::Text(text) => Some(text_message_event(session_id, text.as_str())),
        Message::Binary(bytes) => Some(binary_message_event(session_id, bytes)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_target_with_optional_ports() {
        let input = json!({
            "sessionId": "local-session-1",
            "target": { "transportType": "ssh", "host": "dev@example.com", "sshPort": 2222 }
        });
        let parsed = parse_open_session_input(&input).unwrap();
        assert_eq!(parsed.session_id, "local-session-1");
        assert_eq!(
            parsed.target,
            TransportTarget::Ssh {
                host: "dev@example.com".into(),
                ssh_port: Some(2222),
                daemon_port: None,
                password: None,
            }
        );
        assert!(parsed.protocols.is_empty());
    }

    #[test]
    fn parses_ssh_password_and_subprotocols() {
        let input = json!({
            "sessionId": "s",
            "protocols": ["paseo.bearer.hunter2"],
            "target": { "transportType": "ssh", "host": "box", "sshPassword": "pw" }
        });
        let parsed = parse_open_session_input(&input).unwrap();
        assert_eq!(parsed.protocols, vec!["paseo.bearer.hunter2".to_string()]);
        let TransportTarget::Ssh { password, .. } = parsed.target else {
            panic!("ssh target");
        };
        assert_eq!(password.as_ref().map(SshPassword::expose), Some("pw"));
        // The password never shows in a debug rendering of the target.
        assert!(!format!("{password:?}").contains("pw"));

        let bad = json!({ "sessionId": "s", "protocols": ["has space"],
            "target": { "transportType": "ssh", "host": "box" } });
        assert_eq!(
            parse_open_session_input(&bad).unwrap_err(),
            "Desktop transport subprotocol is invalid."
        );
        let not_list = json!({ "sessionId": "s", "protocols": "x",
            "target": { "transportType": "ssh", "host": "box" } });
        assert_eq!(
            parse_open_session_input(&not_list).unwrap_err(),
            "Desktop transport protocols must be a list."
        );
    }

    #[test]
    fn rejects_invalid_inputs() {
        let bad_id = json!({ "sessionId": "has space", "target": { "transportType": "socket", "transportPath": "/x" } });
        assert_eq!(
            parse_open_session_input(&bad_id).unwrap_err(),
            "Desktop transport session ID is invalid."
        );
        let bad_host = json!({ "transportType": "ssh", "host": "-oProxyCommand=x" });
        assert_eq!(
            parse_transport_target(&bad_host).unwrap_err(),
            "SSH host is invalid"
        );
        let bad_port = json!({ "transportType": "ssh", "host": "h", "daemonPort": 70000 });
        assert_eq!(
            parse_transport_target(&bad_port).unwrap_err(),
            "Daemon port must be between 1 and 65535."
        );
        let empty_path = json!({ "transportType": "pipe", "transportPath": "  " });
        assert_eq!(
            parse_transport_target(&empty_path).unwrap_err(),
            "Local transport path is required."
        );
        assert_eq!(
            parse_transport_target(&json!({ "transportType": "tcp" })).unwrap_err(),
            "Unsupported desktop transport type."
        );
    }

    #[test]
    fn encodes_frames_both_ways() {
        let text = decode_outgoing_message(&json!({ "text": "hello" })).unwrap();
        assert_eq!(text, Message::text("hello"));
        let binary = decode_outgoing_message(&json!({ "binaryBase64": "AQID" })).unwrap();
        assert_eq!(binary, Message::binary(vec![1, 2, 3]));
        assert!(decode_outgoing_message(&json!({})).is_err());

        assert_eq!(
            incoming_message_event("s", &Message::binary(vec![1, 2, 3])).unwrap(),
            json!({ "sessionId": "s", "kind": "message", "binaryBase64": "AQID" })
        );
        assert_eq!(
            incoming_message_event("s", &Message::text("hi")).unwrap(),
            json!({ "sessionId": "s", "kind": "message", "text": "hi" })
        );
        assert!(incoming_message_event("s", &Message::Ping(vec![].into())).is_none());
        assert_eq!(
            close_event("s", 1000, "done"),
            json!({ "sessionId": "s", "kind": "close", "code": 1000, "reason": "done" })
        );
        assert_eq!(
            error_event_with_detail("s", "denied", Some(json!({ "kind": "ssh-auth" }))),
            json!({ "sessionId": "s", "kind": "error", "error": "denied", "detail": { "kind": "ssh-auth" } })
        );
        assert_eq!(
            error_event_with_detail("s", "x", None),
            error_event("s", "x")
        );
    }
}
