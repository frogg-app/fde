//! One transport session: connect to the target (ssh stdio, unix socket or
//! named pipe), run the WebSocket handshake, then pump frames between the
//! socket and the webview until either side closes.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::session::{
    close_event, error_event, error_event_with_detail, incoming_message_event, open_event,
    TransportTarget, DEFAULT_SSH_DAEMON_PORT, WS_ENDPOINT_PATH,
};
use super::socket::{self, BoxedStream};
use super::ssh::SshProcess;
use super::{lock, EventSink, Outgoing, Registry, SessionState};

pub const SETUP_TIMEOUT: Duration = Duration::from_secs(30);
/// Remote SSH gets a shorter window: ssh's own `ConnectTimeout=10` covers the
/// TCP connect, and the webview's connect timer for SSH hosts (20 s in
/// `test-daemon-connection.ts`) must fire *after* this one so the UI shows
/// ssh's stderr rather than its generic "timed out" copy.
pub const SSH_SETUP_TIMEOUT: Duration = Duration::from_secs(18);

struct Endpoint {
    ws: WebSocketStream<BoxedStream>,
    ssh: Option<SshProcess>,
}

pub(super) struct SessionTask {
    pub(super) sessions: Registry,
    pub(super) emit: EventSink,
    pub(super) id: String,
    pub(super) generation: u64,
    pub(super) target: TransportTarget,
    pub(super) protocols: Vec<String>,
    pub(super) cancel: Arc<Notify>,
}

/// Why setup failed: the message the UI shows, plus an optional structured
/// detail (`{kind:"ssh-auth", …}`) it can act on.
struct ConnectError {
    message: String,
    detail: Option<Value>,
}

impl From<String> for ConnectError {
    fn from(message: String) -> Self {
        Self {
            message,
            detail: None,
        }
    }
}

impl SessionTask {
    fn is_current(&self) -> bool {
        lock(&self.sessions)
            .get(&self.id)
            .map(|entry| entry.generation == self.generation)
            .unwrap_or(false)
    }

    /// Removes this session from the registry; `true` if it was still current.
    fn dispose(&self) -> bool {
        let mut sessions = lock(&self.sessions);
        match sessions.get(&self.id) {
            Some(entry) if entry.generation == self.generation => {
                sessions.remove(&self.id);
                true
            }
            _ => false,
        }
    }

    fn fail_opening(&self, message: String, detail: Option<Value>) {
        if self.dispose() {
            log::warn!("transport {}: {message}", self.id);
            (self.emit)(error_event_with_detail(&self.id, &message, detail));
        }
    }

    pub(super) async fn run(self, mut outgoing: mpsc::UnboundedReceiver<Outgoing>) {
        let description = self.target.describe();
        log::info!("transport {}: opening {description}", self.id);
        let setup_timeout = match self.target {
            TransportTarget::Ssh { .. } => SSH_SETUP_TIMEOUT,
            _ => SETUP_TIMEOUT,
        };
        let setup = tokio::select! {
            result = tokio::time::timeout(setup_timeout, connect(&self.target, &self.protocols)) => result,
            _ = self.cancel.notified() => return,
        };
        let mut endpoint = match setup {
            Ok(Ok(endpoint)) => endpoint,
            Ok(Err(error)) => {
                return self.fail_opening(
                    format!("Failed to connect to {description}: {}", error.message),
                    error.detail,
                )
            }
            Err(_) => {
                return self.fail_opening(
                    format!(
                        "Connection to {description} timed out during setup ({} s).",
                        setup_timeout.as_secs()
                    ),
                    None,
                )
            }
        };
        log::info!("transport {}: open ({description})", self.id);

        let became_open = {
            let mut sessions = lock(&self.sessions);
            match sessions.get_mut(&self.id) {
                Some(entry) if entry.generation == self.generation => {
                    entry.state = SessionState::Open;
                    true
                }
                _ => false,
            }
        };
        if !became_open {
            return shutdown(endpoint).await;
        }
        (self.emit)(open_event(&self.id));

        // Inbound frames are coalesced into one emit per batch. Each emit is a
        // separate IPC hop into the webview, and on WebView2 the per-hop cost
        // dominates a small streaming delta — so a turn that arrives as hundreds of
        // little frames per second used to cost hundreds of round trips per second.
        let mut batch = EventBatch::new();

        loop {
            tokio::select! {
                _ = batch.deadline() => batch.flush(&self.emit),
                _ = self.cancel.notified() => {
                    batch.flush(&self.emit);
                    break;
                }
                request = outgoing.recv() => match request {
                    Some((message, reply)) => {
                        let result = endpoint.ws.send(message).await.map_err(|e| format!("Local transport write failed: {e}"));
                        let _ = reply.send(result);
                    }
                    None => {
                        batch.flush(&self.emit);
                        break;
                    }
                },
                incoming = endpoint.ws.next() => match incoming {
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|f| (u16::from(f.code), f.reason.to_string()))
                            .unwrap_or((1005, String::new()));
                        // Buffered messages precede the close they arrived before.
                        batch.flush(&self.emit);
                        if self.dispose() {
                            log::info!("transport {}: closed by peer ({code} {reason})", self.id);
                            (self.emit)(close_event(&self.id, code, &reason));
                        }
                        break;
                    }
                    Some(Ok(message)) => {
                        if let Some(event) = incoming_message_event(&self.id, &message) {
                            if self.is_current() {
                                batch.push(event, &self.emit);
                            }
                        }
                    }
                    Some(Err(error)) => {
                        let detail = match endpoint.ssh.as_mut() {
                            Some(ssh) => match ssh.failure_detail().await {
                                Some(failure) => format!("{error}: {failure}"),
                                None => error.to_string(),
                            },
                            None => error.to_string(),
                        };
                        batch.flush(&self.emit);
                        if self.dispose() {
                            log::warn!("transport {}: read failed: {detail}", self.id);
                            (self.emit)(error_event(&self.id, &detail));
                            (self.emit)(close_event(&self.id, 1006, ""));
                        }
                        break;
                    }
                    None => {
                        batch.flush(&self.emit);
                        if self.dispose() {
                            log::info!("transport {}: stream ended", self.id);
                            (self.emit)(close_event(&self.id, 1006, ""));
                        }
                        break;
                    }
                },
            }
        }
        shutdown(endpoint).await;
    }
}

/// How long a message may wait for company before it is emitted on its own.
/// Short enough to stay invisible next to a frame at 60 Hz, long enough that a
/// burst of streaming deltas rides in on one IPC hop.
const BATCH_WINDOW: Duration = Duration::from_millis(8);
/// Flush early past these, so batching never adds latency to a fast producer or
/// builds a single payload large enough to stall the webview parsing it.
const BATCH_MAX_EVENTS: usize = 64;
const BATCH_MAX_BYTES: usize = 256 * 1024;

/// Coalesces inbound message events into one emit.
///
/// Emits a bare event when a batch holds exactly one, so the low-rate case is
/// shaped exactly as it was before batching, and an array otherwise. Non-message
/// events (open / close / error) are never batched — callers flush first, so
/// ordering against them is preserved.
struct EventBatch {
    pending: Vec<Value>,
    bytes: usize,
    deadline: Option<tokio::time::Instant>,
}

impl EventBatch {
    fn new() -> Self {
        Self {
            pending: Vec::new(),
            bytes: 0,
            deadline: None,
        }
    }

    /// Resolves when the open batch is due. Never resolves when there is none, so
    /// it parks harmlessly in the select.
    async fn deadline(&self) {
        match self.deadline {
            Some(deadline) => tokio::time::sleep_until(deadline).await,
            None => std::future::pending().await,
        }
    }

    fn push(&mut self, event: Value, emit: &EventSink) {
        self.bytes += estimate_event_bytes(&event);
        self.pending.push(event);
        if self.deadline.is_none() {
            self.deadline = Some(tokio::time::Instant::now() + BATCH_WINDOW);
        }
        if self.pending.len() >= BATCH_MAX_EVENTS || self.bytes >= BATCH_MAX_BYTES {
            self.flush(emit);
        }
    }

    fn flush(&mut self, emit: &EventSink) {
        self.deadline = None;
        self.bytes = 0;
        match self.pending.len() {
            0 => {}
            1 => {
                if let Some(event) = self.pending.pop() {
                    emit(event);
                }
            }
            _ => emit(Value::Array(std::mem::take(&mut self.pending))),
        }
    }
}

/// Rough payload size — the body dominates, and this only has to be good enough
/// to decide when to flush.
fn estimate_event_bytes(event: &Value) -> usize {
    let field = |name: &str| {
        event
            .get(name)
            .and_then(Value::as_str)
            .map(str::len)
            .unwrap_or(0)
    };
    field("text") + field("binaryBase64") + 64
}

async fn shutdown(mut endpoint: Endpoint) {
    let _ = tokio::time::timeout(Duration::from_secs(1), endpoint.ws.close(None)).await;
    if let Some(mut ssh) = endpoint.ssh {
        ssh.kill().await;
    }
}

async fn connect(target: &TransportTarget, protocols: &[String]) -> Result<Endpoint, ConnectError> {
    match target {
        TransportTarget::Ssh {
            host,
            ssh_port,
            daemon_port,
            password,
        } => {
            let (mut ssh, stream) =
                SshProcess::spawn(host, *ssh_port, *daemon_port, password.as_ref())
                    .map_err(|e| e.to_string())?;
            let port = daemon_port.unwrap_or(DEFAULT_SSH_DAEMON_PORT);
            let url = format!("ws://127.0.0.1:{port}{WS_ENDPOINT_PATH}");
            // ssh exiting (auth refused, forward failed, host unreachable)
            // ends the attempt at once: its stderr is the error, not the
            // handshake's view of a closed pipe.
            let outcome = tokio::select! {
                result = handshake(&url, Box::pin(stream), protocols) => result,
                exit = ssh.wait() => Err(match exit {
                    Some(failure) => format!("ssh exited before the tunnel opened: {failure}"),
                    None => "ssh exited before the tunnel opened".to_string(),
                }),
            };
            match outcome {
                Ok(ws) => Ok(Endpoint { ws, ssh: Some(ssh) }),
                Err(error) => {
                    let failure = ssh.failure_detail().await;
                    let detail = ssh.failure_detail_value();
                    ssh.kill().await;
                    Err(ConnectError {
                        message: match failure {
                            Some(failure) if !error.contains(&failure) => {
                                format!("{error}: {failure}")
                            }
                            _ => error,
                        },
                        detail,
                    })
                }
            }
        }
        TransportTarget::Socket { path } => {
            let stream = socket::connect_socket(path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Endpoint {
                ws: handshake(
                    &format!("ws://localhost{WS_ENDPOINT_PATH}"),
                    stream,
                    protocols,
                )
                .await?,
                ssh: None,
            })
        }
        TransportTarget::Pipe { path } => {
            let stream = socket::connect_pipe(path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Endpoint {
                ws: handshake(
                    &format!("ws://localhost{WS_ENDPOINT_PATH}"),
                    stream,
                    protocols,
                )
                .await?,
                ssh: None,
            })
        }
    }
}

/// The upgrade request: `protocols` become one `Sec-WebSocket-Protocol`
/// header (the daemon echoes the `paseo.bearer.*` entry it accepted).
fn build_request(
    url: &str,
    protocols: &[String],
) -> Result<tokio_tungstenite::tungstenite::handshake::client::Request, String> {
    let mut request = url.into_client_request().map_err(|e| e.to_string())?;
    if !protocols.is_empty() {
        let value = HeaderValue::from_str(&protocols.join(", ")).map_err(|e| e.to_string())?;
        request
            .headers_mut()
            .insert("Sec-WebSocket-Protocol", value);
    }
    Ok(request)
}

async fn handshake(
    url: &str,
    stream: BoxedStream,
    protocols: &[String],
) -> Result<WebSocketStream<BoxedStream>, String> {
    log::info!("transport: websocket handshake to {url}");
    let request = build_request(url, protocols)?;
    let (ws, response) = tokio_tungstenite::client_async(request, stream)
        .await
        .map_err(|e| {
            log::warn!("transport: websocket handshake to {url} failed: {e}");
            e.to_string()
        })?;
    log::info!(
        "transport: websocket handshake to {url} ok (HTTP {})",
        response.status()
    );
    Ok(ws)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_carries_subprotocols_as_one_header() {
        let plain = build_request("ws://127.0.0.1:9999/ws", &[]).unwrap();
        assert!(plain.headers().get("Sec-WebSocket-Protocol").is_none());
        let with = build_request(
            "ws://127.0.0.1:9999/ws",
            &["paseo.bearer.pw".to_string(), "other".to_string()],
        )
        .unwrap();
        assert_eq!(
            with.headers().get("Sec-WebSocket-Protocol").unwrap(),
            "paseo.bearer.pw, other"
        );
        assert_eq!(with.uri().path(), "/ws");
    }
}
