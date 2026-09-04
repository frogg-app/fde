//! Strangler-fig fallback: forward session messages we do not implement natively
//! to the Node daemon over its own WS endpoint, and pump its replies back.
//!
//! One upstream connection per downstream client, so per-connection state in the
//! Node daemon (session identity, subscriptions) keeps working unchanged.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

/// A frame moving between the client and the Node daemon. Binary frames carry
/// terminal I/O and file transfers and must be relayed intact.
#[derive(Debug)]
pub enum Frame {
    Text(String),
    Binary(Vec<u8>),
}

pub struct Upstream {
    to_upstream: mpsc::Sender<Frame>,
}

impl Upstream {
    /// Dials the Node daemon and starts both pump tasks. Frames arriving from
    /// upstream are pushed to `from_upstream` for the caller to relay to its client.
    pub async fn connect(url: &str, from_upstream: mpsc::Sender<Frame>) -> Result<Self> {
        let (stream, _) = tokio_tungstenite::connect_async(url)
            .await
            .with_context(|| format!("dialing upstream daemon at {url}"))?;
        let (mut write, mut read) = stream.split();
        let (to_upstream, mut rx) = mpsc::channel::<Frame>(256);

        tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                let message = match frame {
                    Frame::Text(text) => WsMessage::Text(text),
                    Frame::Binary(bytes) => WsMessage::Binary(bytes),
                };
                if write.send(message).await.is_err() {
                    break;
                }
            }
            let _ = write.close().await;
        });

        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                let frame = match msg {
                    WsMessage::Text(t) => Frame::Text(t),
                    WsMessage::Binary(b) => Frame::Binary(b),
                    WsMessage::Close(_) => break,
                    // Ping/Pong are handled by the transport itself.
                    _ => continue,
                };
                if from_upstream.send(frame).await.is_err() {
                    break;
                }
            }
        });

        Ok(Self { to_upstream })
    }

    pub async fn send(&self, frame: Frame) -> Result<()> {
        self.to_upstream
            .send(frame)
            .await
            .context("upstream daemon connection is closed")
    }
}
