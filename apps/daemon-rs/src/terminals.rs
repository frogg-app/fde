//! Per-connection native terminal sessions, keyed by the slot byte in the
//! binary frame protocol.
//!
//! Scope note: this owns the *stream* half of a terminal (input, resize,
//! snapshot, output). The registry half - persistence, workspace binding,
//! naming, restore modes - still lives in the Node daemon, so native terminals
//! are opt-in via FDE_RS_NATIVE_TERMINALS until that is ported too.

use crate::frames::{self, TerminalOpcode};
use crate::pty::{PtySession, Spawn};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Deserialize)]
struct ResizePayload {
    rows: u16,
    cols: u16,
}

pub struct Terminals {
    sessions: HashMap<u8, Arc<PtySession>>,
    /// terminalId -> slot, so subscribe can find the session create made.
    by_id: HashMap<String, u8>,
    /// Frames destined for the client, produced by output pumps.
    outbound: mpsc::Sender<Vec<u8>>,
}

impl Terminals {
    pub fn new(outbound: mpsc::Sender<Vec<u8>>) -> Self {
        Self { sessions: HashMap::new(), by_id: HashMap::new(), outbound }
    }

    /// The lowest unused slot, or None when all 256 are taken.
    fn free_slot(&self) -> Option<u8> {
        (0u8..=255).find(|slot| !self.sessions.contains_key(slot))
    }

    /// Creates a terminal for a `create_terminal_request`, returning its id and
    /// slot. The id is ours alone - the Node registry knows nothing about it.
    pub fn create(&mut self, cwd: Option<&str>, rows: u16, cols: u16) -> anyhow::Result<(String, u8)> {
        let slot = self.free_slot().ok_or_else(|| anyhow::anyhow!("no free terminal slots"))?;
        self.open(slot, cwd, rows, cols)?;
        let id = format!("rs-{}", uuid::Uuid::new_v4());
        self.by_id.insert(id.clone(), slot);
        Ok((id, slot))
    }

    pub fn slot_for(&self, terminal_id: &str) -> Option<u8> {
        self.by_id.get(terminal_id).copied()
    }

    /// Starts a shell on `slot`, replacing any session already there.
    pub fn open(&mut self, slot: u8, cwd: Option<&str>, rows: u16, cols: u16) -> anyhow::Result<()> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let session = PtySession::spawn(Spawn {
            command: &shell,
            args: &[],
            cwd,
            rows,
            cols,
        })?;

        if let Some(previous) = self.sessions.insert(slot, session.clone()) {
            previous.kill();
        }

        // Pump this session's output to the client as 0x01 frames.
        let mut rx = session.subscribe();
        let outbound = self.outbound.clone();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(chunk) => {
                        let frame = frames::encode_terminal(TerminalOpcode::Output, slot, &chunk);
                        if outbound.send(frame).await.is_err() {
                            break;
                        }
                    }
                    // Lagged means we dropped chunks under load; the stream is
                    // still usable, so keep going rather than tearing down.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(slot, dropped = n, "terminal output lagged");
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(())
    }

    /// Handles a decoded terminal frame. Returns false when the frame was not
    /// for us and should be forwarded upstream instead.
    pub async fn handle(&mut self, opcode: TerminalOpcode, slot: u8, payload: &[u8]) -> bool {
        let Some(session) = self.sessions.get(&slot).cloned() else {
            return false;
        };
        match opcode {
            TerminalOpcode::Input => {
                if let Err(err) = session.write_input(payload) {
                    tracing::warn!(slot, error = %err, "terminal input failed");
                }
            }
            TerminalOpcode::Resize => match serde_json::from_slice::<ResizePayload>(payload) {
                Ok(size) => {
                    if let Err(err) = session.resize(size.rows, size.cols) {
                        tracing::warn!(slot, error = %err, "terminal resize failed");
                    }
                }
                Err(err) => tracing::warn!(slot, error = %err, "undecodable resize payload"),
            },
            TerminalOpcode::Snapshot | TerminalOpcode::Restore => {
                let frame =
                    frames::encode_terminal(TerminalOpcode::Snapshot, slot, &session.snapshot());
                let _ = self.outbound.send(frame).await;
            }
            // Output is server-to-client only; a client sending it is a no-op.
            TerminalOpcode::Output => {}
        }
        true
    }

    pub fn close_all(&mut self) {
        for (_, session) in self.sessions.drain() {
            session.kill();
        }
        self.by_id.clear();
    }
}

impl Drop for Terminals {
    fn drop(&mut self) {
        self.close_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    async fn collect_output(rx: &mut mpsc::Receiver<Vec<u8>>, needle: &str) -> bool {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let mut seen = Vec::new();
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                Ok(Some(frame)) => {
                    assert_eq!(frame[0], TerminalOpcode::Output as u8);
                    seen.extend_from_slice(&frame[2..]);
                    if String::from_utf8_lossy(&seen).contains(needle) {
                        return true;
                    }
                }
                Ok(None) => return false,
                Err(_) => {}
            }
        }
        false
    }

    #[tokio::test]
    async fn opens_a_shell_and_streams_output_as_frames() {
        let (tx, mut rx) = mpsc::channel(256);
        let mut terminals = Terminals::new(tx);
        terminals.open(3, Some("/tmp"), 24, 80).unwrap();

        assert!(terminals.handle(TerminalOpcode::Input, 3, b"echo FRAMED_OK\n").await);
        assert!(collect_output(&mut rx, "FRAMED_OK").await);
        terminals.close_all();
    }

    #[tokio::test]
    async fn create_allocates_distinct_slots_and_resolves_ids() {
        let (tx, _rx) = mpsc::channel(256);
        let mut terminals = Terminals::new(tx);
        let (first_id, first_slot) = terminals.create(Some("/tmp"), 24, 80).unwrap();
        let (second_id, second_slot) = terminals.create(Some("/tmp"), 24, 80).unwrap();
        assert_ne!(first_slot, second_slot);
        assert_eq!(terminals.slot_for(&first_id), Some(first_slot));
        assert_eq!(terminals.slot_for(&second_id), Some(second_slot));
        assert_eq!(terminals.slot_for("nope"), None);
        terminals.close_all();
        assert_eq!(terminals.slot_for(&first_id), None);
    }

    #[tokio::test]
    async fn frames_for_an_unknown_slot_are_left_for_upstream() {
        let (tx, _rx) = mpsc::channel(256);
        let mut terminals = Terminals::new(tx);
        assert!(
            !terminals.handle(TerminalOpcode::Input, 9, b"x").await,
            "an unopened slot must fall through to the Node daemon"
        );
    }

    #[tokio::test]
    async fn resize_is_applied_and_bad_payloads_do_not_panic() {
        let (tx, _rx) = mpsc::channel(256);
        let mut terminals = Terminals::new(tx);
        terminals.open(0, Some("/tmp"), 24, 80).unwrap();

        assert!(terminals.handle(TerminalOpcode::Resize, 0, br#"{"rows":40,"cols":100}"#).await);
        assert!(terminals.handle(TerminalOpcode::Resize, 0, b"not json").await);
        terminals.close_all();
    }

    #[tokio::test]
    async fn snapshot_requests_are_answered_with_a_snapshot_frame() {
        let (tx, mut rx) = mpsc::channel(256);
        let mut terminals = Terminals::new(tx);
        terminals.open(1, Some("/tmp"), 24, 80).unwrap();
        terminals.handle(TerminalOpcode::Input, 1, b"echo SNAP\n").await;
        assert!(collect_output(&mut rx, "SNAP").await);

        terminals.handle(TerminalOpcode::Snapshot, 1, b"").await;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            if let Ok(Some(frame)) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await
            {
                if frame[0] == TerminalOpcode::Snapshot as u8 {
                    assert_eq!(frame[1], 1, "snapshot must carry the slot");
                    assert!(String::from_utf8_lossy(&frame[2..]).contains("SNAP"));
                    terminals.close_all();
                    return;
                }
            }
        }
        panic!("no snapshot frame arrived");
    }
}
