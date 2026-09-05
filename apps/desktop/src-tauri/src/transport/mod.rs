//! Local daemon transports (Remote SSH, unix socket, named pipe) driven from
//! Rust. A port of Electron's `daemon/local-transport.ts`: the webview opens a
//! session, frames flow both ways over `paseo:event:local-daemon-transport-event`,
//! and the session registry guarantees a closed session never emits again.

pub mod session;
pub mod socket;
pub mod ssh;
pub mod ssh_auth;
#[cfg(all(test, unix))]
mod ssh_e2e;
mod task;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::sync::{mpsc, oneshot, Notify};
use tokio_tungstenite::tungstenite::Message;

use session::{decode_outgoing_message, parse_open_session_input, session_id_from_args};
use task::SessionTask;

pub type EventSink = Arc<dyn Fn(Value) + Send + Sync>;
pub(super) type Outgoing = (Message, oneshot::Sender<Result<(), String>>);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SessionState {
    Opening,
    Open,
}

pub(super) struct SessionEntry {
    pub(super) generation: u64,
    pub(super) state: SessionState,
    pub(super) outgoing: mpsc::UnboundedSender<Outgoing>,
    pub(super) cancel: Arc<Notify>,
}

pub(super) type Registry = Arc<Mutex<HashMap<String, SessionEntry>>>;

pub struct TransportManager {
    sessions: Registry,
    emit: EventSink,
    generations: AtomicU64,
}

impl TransportManager {
    pub fn new(emit: EventSink) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            emit,
            generations: AtomicU64::new(0),
        }
    }

    pub fn open(&self, args: &Value) -> Result<Value, String> {
        let input = parse_open_session_input(args)?;
        let (tx, rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(Notify::new());
        let generation = self.generations.fetch_add(1, Ordering::Relaxed);
        {
            let mut sessions = lock(&self.sessions);
            if sessions.contains_key(&input.session_id) {
                return Err(format!(
                    "Local transport session already exists: {}",
                    input.session_id
                ));
            }
            sessions.insert(
                input.session_id.clone(),
                SessionEntry {
                    generation,
                    state: SessionState::Opening,
                    outgoing: tx,
                    cancel: Arc::clone(&cancel),
                },
            );
        }
        let task = SessionTask {
            sessions: Arc::clone(&self.sessions),
            emit: Arc::clone(&self.emit),
            id: input.session_id,
            generation,
            target: input.target,
            protocols: input.protocols,
            cancel,
        };
        tauri::async_runtime::spawn(task.run(rx));
        Ok(Value::Null)
    }

    pub async fn send(&self, args: &Value) -> Result<Value, String> {
        let id = session_id_from_args(args);
        let sender = {
            let sessions = lock(&self.sessions);
            let entry = sessions
                .get(&id)
                .ok_or_else(|| format!("Local transport session not found: {id}"))?;
            if entry.state != SessionState::Open {
                return Err("Local transport session is not open yet.".into());
            }
            entry.outgoing.clone()
        };
        let message = decode_outgoing_message(args)?;
        let (reply, done) = oneshot::channel();
        sender
            .send((message, reply))
            .map_err(|_| "Local transport session is closed.".to_string())?;
        done.await
            .unwrap_or_else(|_| Err("Local transport session is closed.".into()))?;
        Ok(Value::Null)
    }

    pub fn close(&self, args: &Value) -> Result<Value, String> {
        let id = session_id_from_args(args);
        if !id.is_empty() {
            self.close_session(&id);
        }
        Ok(Value::Null)
    }

    fn close_session(&self, id: &str) {
        if let Some(entry) = lock(&self.sessions).remove(id) {
            entry.cancel.notify_one();
        }
    }

    pub fn close_all(&self) {
        let entries: Vec<SessionEntry> = lock(&self.sessions)
            .drain()
            .map(|(_, entry)| entry)
            .collect();
        for entry in entries {
            entry.cancel.notify_one();
        }
    }

    #[cfg(test)]
    fn has_session(&self, id: &str) -> bool {
        lock(&self.sessions).contains_key(id)
    }
}

pub(super) fn lock(
    registry: &Registry,
) -> std::sync::MutexGuard<'_, HashMap<String, SessionEntry>> {
    registry
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::json;
    use std::time::Duration;

    fn manager() -> (Arc<TransportManager>, mpsc::UnboundedReceiver<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let emit: EventSink = Arc::new(move |event| {
            let _ = tx.send(event);
        });
        (Arc::new(TransportManager::new(emit)), rx)
    }

    /// WebSocket echo server on a unix socket; returns the socket path.
    async fn spawn_echo_server(dir: &std::path::Path) -> String {
        let path = dir.join("daemon.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        tauri::async_runtime::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tauri::async_runtime::spawn(async move {
                    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                    while let Some(Ok(message)) = ws.next().await {
                        match message {
                            Message::Text(_) | Message::Binary(_) => {
                                ws.send(message).await.unwrap()
                            }
                            Message::Close(_) => break,
                            _ => {}
                        }
                    }
                });
            }
        });
        path.to_string_lossy().to_string()
    }

    async fn next_event(rx: &mut mpsc::UnboundedReceiver<Value>) -> Value {
        tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("event")
            .expect("channel open")
    }

    #[test]
    fn round_trips_frames_over_a_unix_socket() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let socket_path = spawn_echo_server(dir.path()).await;
            let (manager, mut events) = manager();
            let open = json!({ "sessionId": "s1", "target": { "transportType": "socket", "transportPath": socket_path } });
            manager.open(&open).unwrap();
            assert_eq!(
                manager.open(&open).unwrap_err(),
                "Local transport session already exists: s1"
            );
            assert_eq!(
                next_event(&mut events).await,
                json!({ "sessionId": "s1", "kind": "open" })
            );

            manager
                .send(&json!({ "sessionId": "s1", "text": "ping" }))
                .await
                .unwrap();
            assert_eq!(
                next_event(&mut events).await,
                json!({ "sessionId": "s1", "kind": "message", "text": "ping" })
            );
            manager
                .send(&json!({ "sessionId": "s1", "binaryBase64": "AQID" }))
                .await
                .unwrap();
            assert_eq!(
                next_event(&mut events).await,
                json!({ "sessionId": "s1", "kind": "message", "binaryBase64": "AQID" })
            );

            let missing = manager
                .send(&json!({ "sessionId": "nope", "text": "x" }))
                .await
                .unwrap_err();
            assert_eq!(missing, "Local transport session not found: nope");

            manager.close(&json!({ "sessionId": "s1" })).unwrap();
            assert!(!manager.has_session("s1"));
            // A closed session never emits again.
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(events.try_recv().is_err());
        });
    }

    /// A burst of inbound frames should arrive as one array-shaped emit rather than
    /// one IPC hop each, while every frame still shows up exactly once and in order.
    #[test]
    fn coalesces_a_burst_of_inbound_frames_into_one_event() {
        tauri::async_runtime::block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let socket_path = spawn_echo_server(dir.path()).await;
            let (manager, mut events) = manager();
            let open = json!({ "sessionId": "b1", "target": { "transportType": "socket", "transportPath": socket_path } });
            manager.open(&open).unwrap();
            assert_eq!(
                next_event(&mut events).await,
                json!({ "sessionId": "b1", "kind": "open" })
            );

            const BURST: usize = 12;
            for index in 0..BURST {
                manager
                    .send(&json!({ "sessionId": "b1", "text": format!("m{index}") }))
                    .await
                    .unwrap();
            }

            // Drain whatever the batcher produced and flatten it back to a list.
            let mut seen: Vec<String> = Vec::new();
            let mut emits = 0;
            while seen.len() < BURST {
                let event = next_event(&mut events).await;
                emits += 1;
                match event {
                    Value::Array(batch) => {
                        for entry in batch {
                            seen.push(entry["text"].as_str().unwrap().to_string());
                        }
                    }
                    single => seen.push(single["text"].as_str().unwrap().to_string()),
                }
            }

            let expected: Vec<String> = (0..BURST).map(|index| format!("m{index}")).collect();
            assert_eq!(seen, expected, "every frame arrives once, in order");
            assert!(
                emits < BURST,
                "expected batching to use fewer emits than frames, got {emits} for {BURST}"
            );

            manager.close(&json!({ "sessionId": "b1" })).unwrap();
        });
    }

    #[test]
    fn reports_connection_failures_as_error_events() {
        tauri::async_runtime::block_on(async {
            let (manager, mut events) = manager();
            let open = json!({ "sessionId": "s2", "target": { "transportType": "socket", "transportPath": "/nonexistent/daemon.sock" } });
            manager.open(&open).unwrap();
            let event = next_event(&mut events).await;
            assert_eq!(event["kind"], "error");
            assert!(event["error"]
                .as_str()
                .unwrap()
                .starts_with("Failed to connect to local daemon socket: "));
            assert!(!manager.has_session("s2"));
        });
    }

    #[test]
    fn open_then_close_before_ready_is_silent() {
        tauri::async_runtime::block_on(async {
            let (manager, mut events) = manager();
            let open = json!({ "sessionId": "s3", "target": { "transportType": "socket", "transportPath": "/nonexistent/daemon.sock" } });
            manager.open(&open).unwrap();
            manager.close(&json!({ "sessionId": "s3" })).unwrap();
            tokio::time::sleep(Duration::from_millis(200)).await;
            assert!(events.try_recv().is_err());
            assert!(!manager.has_session("s3"));
        });
    }
}
