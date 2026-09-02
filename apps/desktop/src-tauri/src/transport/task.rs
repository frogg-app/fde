//! One transport session: connect to the target (ssh stdio, unix socket or
//! named pipe), run the WebSocket handshake, then pump frames between the
//! socket and the webview until either side closes.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::{mpsc, Notify};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::session::{
    close_event, error_event, incoming_message_event, open_event, TransportTarget,
    DEFAULT_SSH_DAEMON_PORT, WS_ENDPOINT_PATH,
};
use super::socket::{self, BoxedStream};
use super::ssh::SshProcess;
use super::{lock, EventSink, Outgoing, Registry, SessionState};

pub const SETUP_TIMEOUT: Duration = Duration::from_secs(30);

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
    pub(super) cancel: Arc<Notify>,
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

    fn fail_opening(&self, message: String) {
        if self.dispose() {
            (self.emit)(error_event(&self.id, &message));
        }
    }

    pub(super) async fn run(self, mut outgoing: mpsc::UnboundedReceiver<Outgoing>) {
        let description = self.target.describe();
        let setup = tokio::select! {
            result = tokio::time::timeout(SETUP_TIMEOUT, connect(&self.target)) => result,
            _ = self.cancel.notified() => return,
        };
        let mut endpoint = match setup {
            Ok(Ok(endpoint)) => endpoint,
            Ok(Err(detail)) => {
                return self.fail_opening(format!("Failed to connect to {description}: {detail}"))
            }
            Err(_) => {
                return self.fail_opening(format!(
                    "Connection to {description} timed out during setup."
                ))
            }
        };

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
                            (self.emit)(error_event(&self.id, &detail));
                            (self.emit)(close_event(&self.id, 1006, ""));
                        }
                        break;
                    }
                    None => {
                        if self.dispose() {
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

async fn connect(target: &TransportTarget) -> Result<Endpoint, String> {
    match target {
        TransportTarget::Ssh {
            host,
            ssh_port,
            daemon_port,
        } => {
            let (mut ssh, stream) =
                SshProcess::spawn(host, *ssh_port, *daemon_port).map_err(|e| e.to_string())?;
            let port = daemon_port.unwrap_or(DEFAULT_SSH_DAEMON_PORT);
            let url = format!("ws://127.0.0.1:{port}{WS_ENDPOINT_PATH}");
            match handshake(&url, Box::pin(stream)).await {
                Ok(ws) => Ok(Endpoint { ws, ssh: Some(ssh) }),
                Err(error) => {
                    let detail = ssh.failure_detail().await;
                    ssh.kill().await;
                    Err(match detail {
                        Some(failure) => format!("{error}: {failure}"),
                        None => error,
                    })
                }
            }
        }
        TransportTarget::Socket { path } => {
            let stream = socket::connect_socket(path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Endpoint {
                ws: handshake(&format!("ws://localhost{WS_ENDPOINT_PATH}"), stream).await?,
                ssh: None,
            })
        }
        TransportTarget::Pipe { path } => {
            let stream = socket::connect_pipe(path)
                .await
                .map_err(|e| e.to_string())?;
            Ok(Endpoint {
                ws: handshake(&format!("ws://localhost{WS_ENDPOINT_PATH}"), stream).await?,
                ssh: None,
            })
        }
    }
}

async fn handshake(url: &str, stream: BoxedStream) -> Result<WebSocketStream<BoxedStream>, String> {
    let (ws, _response) = tokio_tungstenite::client_async(url, stream)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ws)
}
