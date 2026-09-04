//! Reverse proxy for HTTP routes we do not serve natively.
//!
//! Without this the SPA fallback swallows unmatched paths and answers 200 with
//! index.html - so `/api/files/download` returns HTML instead of a file. Paths
//! under these prefixes belong to the daemon, never to the client-side router.

use axum::body::Body;
use axum::http::{Request, Response, StatusCode, Uri};
use http_body_util::BodyExt;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;

/// Prefixes owned by the daemon. Anything else is a client-side route and
/// correctly falls through to the SPA.
const DAEMON_PREFIXES: [&str; 3] = ["/api/", "/mcp/", "/public/"];

pub fn is_daemon_path(path: &str) -> bool {
    DAEMON_PREFIXES.iter().any(|prefix| path.starts_with(prefix))
        || DAEMON_PREFIXES.iter().any(|prefix| path == prefix.trim_end_matches('/'))
}

#[derive(Clone)]
pub struct HttpProxy {
    client: Client<HttpConnector, Body>,
    base: String,
}

impl HttpProxy {
    /// Derives the HTTP base from the upstream WS url (`ws://host/ws` ->
    /// `http://host`), so one setting configures both.
    pub fn from_ws_url(ws_url: &str) -> Option<Self> {
        let base = http_base_from_ws(ws_url)?;
        Some(Self {
            client: Client::builder(TokioExecutor::new()).build(HttpConnector::new()),
            base,
        })
    }

    pub async fn forward(&self, mut request: Request<Body>) -> Response<Body> {
        let path_and_query = request
            .uri()
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/");
        let Ok(uri) = format!("{}{}", self.base, path_and_query).parse::<Uri>() else {
            return status(StatusCode::BAD_GATEWAY);
        };
        *request.uri_mut() = uri;
        // Host must match the upstream, or its origin checks reject us.
        request.headers_mut().remove(axum::http::header::HOST);

        match self.client.request(request).await {
            Ok(response) => {
                let (parts, body) = response.into_parts();
                Response::from_parts(parts, Body::new(body.map_err(axum::Error::new)))
            }
            Err(err) => {
                tracing::warn!(error = %err, "upstream HTTP request failed");
                status(StatusCode::BAD_GATEWAY)
            }
        }
    }
}

fn status(code: StatusCode) -> Response<Body> {
    Response::builder().status(code).body(Body::empty()).unwrap_or_default()
}

fn http_base_from_ws(ws_url: &str) -> Option<String> {
    let (scheme, rest) = ws_url.split_once("://")?;
    let scheme = match scheme {
        "ws" => "http",
        "wss" => "https",
        other => other,
    };
    let authority = rest.split('/').next()?;
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_daemon_owned_paths() {
        assert!(is_daemon_path("/api/files/download"));
        assert!(is_daemon_path("/api/health"));
        assert!(is_daemon_path("/mcp/agents"));
        assert!(is_daemon_path("/public/logo.png"));
        // Client-side routes must still reach the SPA.
        assert!(!is_daemon_path("/"));
        assert!(!is_daemon_path("/workspace/abc"));
        assert!(!is_daemon_path("/apidocs"), "a prefix match must not be a substring match");
    }

    #[test]
    fn derives_the_http_base_from_the_ws_url() {
        assert_eq!(http_base_from_ws("ws://127.0.0.1:9999/ws").as_deref(), Some("http://127.0.0.1:9999"));
        assert_eq!(http_base_from_ws("wss://box:443/ws").as_deref(), Some("https://box:443"));
        assert_eq!(http_base_from_ws("ws://host").as_deref(), Some("http://host"));
        assert_eq!(http_base_from_ws("not-a-url"), None);
        assert_eq!(http_base_from_ws("ws://"), None);
    }
}
