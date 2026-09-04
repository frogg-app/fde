//! FDE daemon, Rust front half.
//!
//! Terminates HTTP + WebSocket, answers the message types it implements natively,
//! and forwards the rest to the Node daemon (see `proxy`). The point is to migrate
//! the protocol surface incrementally while staying a drop-in replacement.

mod auth;
mod config;
mod daemon_config;
mod envelope;
mod netclass;
mod proxy;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use envelope::Inbound;
use serde_json::json;
use tokio::sync::mpsc;

const DAEMON_VERSION: &str = env!("CARGO_PKG_VERSION");

struct AppState {
    server_id: String,
    started: Instant,
    upstream_url: Option<String>,
    auth: auth::AuthConfig,
    allowed_origins: Vec<String>,
}

impl AppState {
    /// The locality of a request, honouring the same inputs the Node daemon uses.
    /// X-Forwarded-For is deliberately *not* trusted here: the Node daemon only
    /// honours it for configured trusted proxies, and until we port that setting
    /// the safe direction is to gate more, never less.
    fn locality(&self, peer: SocketAddr) -> netclass::Locality {
        netclass::classify(Some(&peer.ip().to_string()))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let boot = Instant::now();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let home = daemon_config::resolve_home();
    let persisted = daemon_config::load(home.as_deref());
    let config = config::Config::from_env(persisted.listen.as_deref())?;

    let auth_required = persisted.auth.password_hash.is_some()
        || !persisted.auth.credential_hashes.is_empty();
    let state = Arc::new(AppState {
        server_id: uuid::Uuid::new_v4().to_string(),
        started: Instant::now(),
        upstream_url: config.upstream.clone(),
        auth: persisted.auth,
        allowed_origins: persisted.allowed_origins,
    });

    let app = Router::new()
        // Unauthenticated by design, matching the Node daemon: health for probes,
        // identity for LAN scanners and the pairing flow.
        .route("/api/health", get(health))
        .route("/api/identity", get(identity))
        .route("/api/status", get(status))
        .route("/ws", get(ws_upgrade))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    let bound = listener.local_addr()?;
    tracing::info!(
        elapsed_ms = boot.elapsed().as_millis() as u64,
        host = %bound.ip(),
        port = bound.port(),
        upstream = config.upstream.as_deref().unwrap_or("<none>"),
        auth_required,
        home = home.as_ref().map(|h| h.display().to_string()).unwrap_or_default(),
        "Server listening"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}

async fn health() -> impl IntoResponse {
    Json(json!({ "status": "ok", "timestamp": now_iso8601() }))
}

async fn identity(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(json!({
        "serverId": state.server_id,
        "version": DAEMON_VERSION,
        "runtime": "rust",
    }))
}

async fn status(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let token = auth::extract_http_bearer_token(header(&headers, "authorization"));
    match state.auth.authorize(state.locality(peer), token.as_deref()) {
        auth::Decision::Ok => Json(json!({
            "status": "ok",
            "uptimeMs": state.started.elapsed().as_millis() as u64,
            "runtime": "rust",
        }))
        .into_response(),
        decision => {
            tracing::warn!(?decision, %peer, "rejected /api/status");
            StatusCode::UNAUTHORIZED.into_response()
        }
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let origin = header(&headers, "origin");
    let host = header(&headers, "host");

    if !auth::origin_allowed(origin, host, &state.allowed_origins) {
        tracing::warn!(?origin, %peer, "rejected connection from origin");
        return (StatusCode::FORBIDDEN, "Origin not allowed").into_response();
    }

    let protocol_header = header(&headers, "sec-websocket-protocol").map(str::to_owned);
    let token = auth::extract_ws_bearer_token(protocol_header.as_deref());
    match state.auth.authorize(state.locality(peer), token.as_deref()) {
        auth::Decision::Ok => {}
        decision => {
            tracing::warn!(?decision, %peer, "rejected websocket upgrade");
            return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
        }
    }

    // Echo back the exact subprotocol the client offered, or the upgrade fails.
    let selected = protocol_header
        .as_deref()
        .and_then(|h| h.split(',').map(str::trim).find(|p| !p.is_empty()).map(str::to_owned));
    let ws = match selected {
        Some(protocol) => ws.protocols([protocol]),
        None => ws,
    };
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    let (from_upstream_tx, mut from_upstream_rx) = mpsc::channel::<String>(256);

    // If the Node daemon is unreachable we still serve the message types we
    // implement natively rather than dropping the client.
    let upstream = match &state.upstream_url {
        Some(url) => match proxy::Upstream::connect(url, from_upstream_tx).await {
            Ok(up) => Some(up),
            Err(err) => {
                tracing::warn!(error = %err, "no upstream; serving native message types only");
                None
            }
        },
        None => None,
    };

    loop {
        tokio::select! {
            // Replies from the Node daemon, relayed verbatim.
            Some(text) = from_upstream_rx.recv() => {
                if socket.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                let Some(Ok(msg)) = incoming else { break };
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Close(_) => break,
                    _ => continue,
                };
                if !handle_text(&text, &mut socket, upstream.as_ref()).await {
                    break;
                }
            }
        }
    }
}

/// Returns false when the connection should close.
async fn handle_text(
    text: &str,
    socket: &mut WebSocket,
    upstream: Option<&proxy::Upstream>,
) -> bool {
    let parsed: Inbound = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(err) => {
            // Unknown envelope shapes are forwarded rather than rejected: the Node
            // daemon stays the authority on the protocol while we are partial.
            tracing::debug!(error = %err, "unparsed envelope, forwarding upstream");
            return forward(text, upstream).await;
        }
    };

    match &parsed {
        // Natively handled: a pong needs no Node daemon round trip.
        Inbound::Ping(ping) => {
            let pong = json!({ "type": "pong", "timestamp": ping.timestamp });
            socket.send(Message::Text(pong.to_string())).await.is_ok()
        }
        _ => {
            tracing::trace!(session_type = parsed.session_type(), "forwarding upstream");
            forward(text, upstream).await
        }
    }
}

async fn forward(text: &str, upstream: Option<&proxy::Upstream>) -> bool {
    match upstream {
        Some(up) => up.send(text.to_string()).await.is_ok(),
        None => true,
    }
}

fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    // Avoids a chrono dependency; the Node daemon only needs a valid ISO-8601 string.
    let secs = now.as_secs();
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let (hh, mm, ss) = (secs % 86_400 / 3600, secs % 3600 / 60, secs % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}.{:03}Z", now.subsec_millis())
}

/// Howard Hinnant's days-from-civil, inverted.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    #[test]
    fn converts_epoch_days_to_civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(19_783), (2024, 3, 1)); // leap year boundary
    }
}
