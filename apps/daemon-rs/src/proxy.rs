//! Strangler-fig fallback: forward session messages we do not implement natively
//! to the Node daemon over its own WS endpoint, and pump its replies back.
//!
//! One upstream connection per downstream client, so per-connection state in the
//! Node daemon (session identity, subscriptions) keeps working unchanged.

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;

pub struct Upstream {
    to_upstream: mpsc::Sender<String>,
}

impl Upstream {
    /// Dials the Node daemon and starts both pump tasks. Frames arriving from
    /// upstream are pushed to `from_upstream` for the caller to relay to its client.
    pub async fn connect(url: &str, from_upstream: mpsc::Sender<String>) -> Result<Self> {
        let (stream, _) = tokio_tungstenite::connect_async(url)
            .await
            .with_context(|| format!("dialing upstream daemon at {url}"))?;
        let (mut write, mut read) = stream.split();
        let (to_upstream, mut rx) = mpsc::channel::<String>(256);

        tokio::spawn(async move {
            while let Some(text) = rx.recv().await {
                if write.send(WsMessage::Text(text)).await.is_err() {
                    break;
                }
            }
            let _ = write.close().await;
        });

        tokio::spawn(async move {
            while let Some(Ok(msg)) = read.next().await {
                let text = match msg {
                    WsMessage::Text(t) => t,
                    WsMessage::Close(_) => break,
                    // Binary frames (terminal streams) are not proxied yet; they
                    // are handled natively or not at all.
                    _ => continue,
                };
                if from_upstream.send(text).await.is_err() {
                    break;
                }
            }
        });

        Ok(Self { to_upstream })
    }

    pub async fn send(&self, text: String) -> Result<()> {
        self.to_upstream
            .send(text)
            .await
            .context("upstream daemon connection is closed")
    }
}
