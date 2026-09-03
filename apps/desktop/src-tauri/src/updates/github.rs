//! The GitHub Releases API call. `FDE_GITHUB_TOKEN` (optional) raises the
//! rate limit and lets a private repository answer; its value is never logged.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};

use super::release::Release;

pub const RELEASES_URL: &str = "https://api.github.com/repos/frogg-app/fde/releases";
const TIMEOUT: Duration = Duration::from_secs(30);
const PER_PAGE: u32 = 30;

pub fn github_token() -> Option<String> {
    std::env::var("FDE_GITHUB_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn user_agent(app_version: &str) -> String {
    format!("FDE/{app_version}")
}

fn headers(app_version: &str, token: Option<&str>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/vnd.github+json"),
    );
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static("2022-11-28"),
    );
    headers.insert(
        USER_AGENT,
        HeaderValue::from_str(&user_agent(app_version)).map_err(|e| e.to_string())?,
    );
    if let Some(token) = token {
        let mut value = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| "FDE_GITHUB_TOKEN contains characters that are not valid in a header")?;
        value.set_sensitive(true);
        headers.insert(AUTHORIZATION, value);
    }
    Ok(headers)
}

/// `GET <releases_url>?per_page=30` parsed into releases, newest first as
/// GitHub returns them (selection does not rely on the order).
pub async fn fetch_releases(
    releases_url: &str,
    app_version: &str,
    token: Option<&str>,
) -> Result<Vec<Release>, String> {
    let client = reqwest::Client::builder()
        .default_headers(headers(app_version, token)?)
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let separator = if releases_url.contains('?') { '&' } else { '?' };
    let url = format!("{releases_url}{separator}per_page={PER_PAGE}");
    log::info!("updates: fetching {url} (token: {})", token.is_some());
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("release check failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            403 | 429 => " (GitHub rate limit; set FDE_GITHUB_TOKEN to raise it)",
            404 => " (repository or releases not found; FDE_GITHUB_TOKEN is needed for a private repository)",
            _ => "",
        };
        return Err(format!("release check failed: HTTP {status}{hint}"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("release check failed: {e}"))?;
    serde_json::from_slice::<Vec<Release>>(&bytes)
        .map_err(|e| format!("release check returned unexpected JSON: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_headers_without_leaking_the_token() {
        let built = headers("1.2.3", Some("ghp_secret")).unwrap();
        assert_eq!(built[USER_AGENT], "FDE/1.2.3");
        assert_eq!(built[ACCEPT], "application/vnd.github+json");
        let auth = &built[AUTHORIZATION];
        assert!(auth.is_sensitive(), "token header must be marked sensitive");
        assert_eq!(auth.to_str().unwrap(), "Bearer ghp_secret");
        assert_eq!(format!("{auth:?}"), "Sensitive");
        assert!(headers("1.2.3", None).unwrap().get(AUTHORIZATION).is_none());
        assert!(headers("1.2.3", Some("bad\nvalue")).is_err());
    }

    #[test]
    fn reads_token_from_env_only_when_non_empty() {
        // Env is process-wide; run the two cases in sequence in one test.
        std::env::remove_var("FDE_GITHUB_TOKEN");
        assert_eq!(github_token(), None);
        std::env::set_var("FDE_GITHUB_TOKEN", "  ");
        assert_eq!(github_token(), None);
        std::env::set_var("FDE_GITHUB_TOKEN", " tok ");
        assert_eq!(github_token().as_deref(), Some("tok"));
        std::env::remove_var("FDE_GITHUB_TOKEN");
    }
}
