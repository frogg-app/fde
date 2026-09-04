//! FDE daemon, Rust front half.
//!
//! Terminates HTTP + WebSocket, answers the message types it implements natively,
//! and forwards the rest to the Node daemon (see `proxy`). The point is to migrate
//! the protocol surface incrementally while staying a drop-in replacement.

mod auth;
mod config;
mod daemon_config;
mod envelope;
mod frames;
mod netclass;
mod proxy;
mod pty;
mod terminals;
mod web_ui;

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
    web_ui_dist: Option<std::path::PathBuf>,
    native_terminals: bool,
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
        web_ui_dist: config.web_ui_dist.clone(),
        native_terminals: config.native_terminals,
    });

    let app = Router::new()
        // Unauthenticated by design, matching the Node daemon: health for probes,
        // identity for LAN scanners and the pairing flow.
        .route("/api/health", get(health))
        .route("/api/identity", get(identity))
        .route("/api/status", get(status))
        .route("/ws", get(ws_upgrade))
        // Everything else is the SPA. Registered last so it never shadows /api.
        .fallback(get(web_ui_handler))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    let bound = listener.local_addr()?;
    tracing::info!(
        elapsed_ms = boot.elapsed().as_millis() as u64,
        host = %bound.ip(),
        port = bound.port(),
        upstream = config.upstream.as_deref().unwrap_or("<none>"),
        auth_required,
        native_terminals = config.native_terminals,
        web_ui = state.web_ui_dist.as_ref().map(|d| d.display().to_string()).unwrap_or_default(),
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

/// Serves the bundled browser UI. Returns 404 when no dist directory is
/// configured, which is the Node behaviour when the web UI is disabled.
async fn web_ui_handler(
    State(state): State<Arc<AppState>>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> Response {
    let Some(dist) = state.web_ui_dist.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let accept_encoding = header(&headers, "accept-encoding");
    let Some(resolved) = web_ui::resolve(dist, uri.path(), accept_encoding) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(body) = tokio::fs::read(&resolved.file).await else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let mut response = Response::builder()
        .header("Content-Type", resolved.content_type)
        .header("Cache-Control", resolved.cache_control);
    if let Some(encoding) = resolved.content_encoding {
        response = response.header("Content-Encoding", encoding);
        // Content-Encoding varies by request, so caches must not share entries.
        response = response.header("Vary", "Accept-Encoding");
    }
    if resolved.is_index_html {
        response = response.header("Pragma", "no-cache").header("Expires", "0");
    }
    response.body(body.into()).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
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
    let (from_upstream_tx, mut from_upstream_rx) = mpsc::channel::<proxy::Frame>(256);
    // Frames produced locally (native terminal output) rather than by upstream.
    let (local_tx, mut local_rx) = mpsc::channel::<Vec<u8>>(256);
    let mut terminals = state
        .native_terminals
        .then(|| terminals::Terminals::new(local_tx));

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
            // Frames from natively-owned terminals.
            Some(bytes) = local_rx.recv() => {
                if socket.send(Message::Binary(bytes)).await.is_err() {
                    break;
                }
            }
            // Replies from the Node daemon, relayed verbatim.
            Some(frame) = from_upstream_rx.recv() => {
                let message = match frame {
                    proxy::Frame::Text(text) => Message::Text(text),
                    proxy::Frame::Binary(bytes) => Message::Binary(bytes),
                };
                if socket.send(message).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => {
                let Some(Ok(msg)) = incoming else { break };
                match msg {
                    Message::Text(text) => {
                        if !handle_text(&text, &mut socket, upstream.as_ref(), terminals.as_mut()).await {
                            break;
                        }
                    }
                    Message::Binary(bytes) => {
                        if !handle_binary(bytes, upstream.as_ref(), terminals.as_mut()).await {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
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
    terminals: Option<&mut terminals::Terminals>,
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
        Inbound::Session { message } => {
            if let Some(terminals) = terminals {
                if let Some(reply) = native_terminal_reply(message, terminals) {
                    return socket.send(Message::Text(reply.to_string())).await.is_ok();
                }
            }
            tracing::trace!(session_type = parsed.session_type(), "forwarding upstream");
            forward(text, upstream).await
        }
        _ => {
            tracing::trace!(session_type = parsed.session_type(), "forwarding upstream");
            forward(text, upstream).await
        }
    }
}

/// Serves terminal create/subscribe natively when native terminals are on.
/// Returns None for anything we do not own, which then goes upstream.
fn native_terminal_reply(
    message: &serde_json::Value,
    terminals: &mut terminals::Terminals,
) -> Option<serde_json::Value> {
    let request_id = message.get("requestId")?.as_str()?.to_string();
    match message.get("type")?.as_str()? {
        "create_terminal_request" => {
            let cwd = message.get("cwd").and_then(|c| c.as_str());
            let size = message.get("size");
            let rows = size.and_then(|s| s.get("rows")?.as_u64()).unwrap_or(24) as u16;
            let cols = size.and_then(|s| s.get("cols")?.as_u64()).unwrap_or(80) as u16;

            let payload = match terminals.create(cwd, rows, cols) {
                Ok((id, _slot)) => json!({
                    "terminal": {
                        "id": id,
                        "name": "terminal",
                        "cwd": cwd.unwrap_or("/"),
                        "workspaceId": message.get("workspaceId").and_then(|w| w.as_str()),
                    },
                    "error": null,
                    "requestId": request_id,
                }),
                Err(err) => json!({
                    "terminal": null,
                    "error": err.to_string(),
                    "requestId": request_id,
                }),
            };
            Some(json!({ "type": "session", "message": {
                "type": "create_terminal_response", "payload": payload } }))
        }
        "subscribe_terminal_request" => {
            let terminal_id = message.get("terminalId")?.as_str()?;
            // Only ours: ids the Node daemon issued must go upstream.
            let slot = terminals.slot_for(terminal_id)?;
            Some(json!({ "type": "session", "message": {
                "type": "subscribe_terminal_response",
                "payload": {
                    "terminalId": terminal_id,
                    "slot": slot,
                    "error": null,
                    "requestId": request_id,
                }
            } }))
        }
        _ => None,
    }
}

/// Terminal I/O and file transfers. Decoded only far enough to log the route;
/// the payload is relayed intact.
async fn handle_binary(
    bytes: Vec<u8>,
    upstream: Option<&proxy::Upstream>,
    terminals: Option<&mut terminals::Terminals>,
) -> bool {
    match frames::decode(&bytes) {
        Some(frames::Frame::Terminal { opcode, slot, payload }) => {
            // Natively-owned slots are served here; everything else falls
            // through to the Node daemon, which still owns the registry.
            if let Some(terminals) = terminals {
                let payload = payload.to_vec();
                if terminals.handle(opcode, slot, &payload).await {
                    return true;
                }
            }
            tracing::trace!(?opcode, slot, "forwarding terminal frame upstream");
        }
        Some(frame) => tracing::trace!(?frame, "forwarding binary frame upstream"),
        None => {
            tracing::debug!(len = bytes.len(), "dropping undecodable binary frame");
            return true;
        }
    }
    match upstream {
        Some(up) => up.send(proxy::Frame::Binary(bytes)).await.is_ok(),
        None => true,
    }
}

async fn forward(text: &str, upstream: Option<&proxy::Upstream>) -> bool {
    match upstream {
        Some(up) => up.send(proxy::Frame::Text(text.to_string())).await.is_ok(),
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
