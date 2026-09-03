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

        loop {
            tokio::select! {
                _ = self.cancel.notified() => break,
                request = outgoing.recv() => match request {
                    Some((message, reply)) => {
                        let result = endpoint.ws.send(message).await.map_err(|e| format!("Local transport write failed: {e}"));
                        let _ = reply.send(result);
                    }
                    None => break,
                },
                incoming = endpoint.ws.next() => match incoming {
                    Some(Ok(Message::Close(frame))) => {
                        let (code, reason) = frame
                            .map(|f| (u16::from(f.code), f.reason.to_string()))
                            .unwrap_or((1005, String::new()));
                        if self.dispose() {
                            log::info!("transport {}: closed by peer ({code} {reason})", self.id);
                            (self.emit)(close_event(&self.id, code, &reason));
                        }
                        break;
                    }
                    Some(Ok(message)) => {
                        if let Some(event) = incoming_message_event(&self.id, &message) {
                            if self.is_current() {
                                (self.emit)(event);
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
                        if self.dispose() {
                            log::warn!("transport {}: read failed: {detail}", self.id);
                            (self.emit)(error_event(&self.id, &detail));
                            (self.emit)(close_event(&self.id, 1006, ""));
                        }
                        break;
                    }
                    None => {
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
