//! Static serving for the bundled browser UI, ported from `server/web-ui.ts`.
//!
//! Keeps the Node behaviour exactly: SPA fallback to index.html, precompressed
//! `.br`/`.gz` siblings chosen from Accept-Encoding, and three cache classes
//! (index.html never cached, content-hashed assets immutable for a year,
//! everything else revalidated).

use std::path::{Component, Path, PathBuf};

pub struct Resolved {
    pub file: PathBuf,
    pub content_encoding: Option<&'static str>,
    pub cache_control: &'static str,
    pub is_index_html: bool,
    pub content_type: &'static str,
}

/// A content-hashed asset name, e.g. `app-3f9a1c2b8d4e5f60.js`. Matches the
/// Node regex `/[-.][0-9a-f]{16,}[-.]/i`.
fn is_hashed_asset(file: &Path) -> bool {
    let Some(base) = file.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let bytes: Vec<char> = base.chars().collect();
    let mut run_start: Option<usize> = None;
    for (i, c) in bytes.iter().enumerate() {
        let is_sep = *c == '-' || *c == '.';
        let is_hex = c.is_ascii_hexdigit();
        match (is_sep, run_start) {
            // A separator closes a run: check whether it was >=16 hex chars.
            (true, Some(start)) => {
                if i - start >= 16 {
                    return true;
                }
                run_start = Some(i + 1);
            }
            (true, None) => run_start = Some(i + 1),
            (false, Some(start)) if !is_hex => {
                let _ = start;
                run_start = None;
            }
            _ => {}
        }
    }
    false
}

/// Strips traversal and absolute components so a request can never escape
/// `dist_dir`. Belt and braces: we also verify containment after joining.
fn sanitize(request_path: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for component in Path::new(request_path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(part) => out.push(part),
            // ParentDir, RootDir, CurDir and prefixes are all dropped.
            _ => {}
        }
    }
    out
}

fn select_encoding(accept_encoding: Option<&str>) -> Option<&'static str> {
    let accept = accept_encoding?.to_ascii_lowercase();
    // Brotli first, matching the Node ordering.
    if accept.contains("br") {
        Some("br")
    } else if accept.contains("gzip") {
        Some("gzip")
    } else {
        None
    }
}

pub fn resolve(dist_dir: &Path, request_path: &str, accept_encoding: Option<&str>) -> Option<Resolved> {
    let mut file = dist_dir.join(sanitize(request_path));

    if file.is_dir() {
        file = file.join("index.html");
    }
    if !file.is_file() {
        // SPA fallback: unknown routes are client-side routes.
        file = dist_dir.join("index.html");
        if !file.is_file() {
            return None;
        }
    }

    let file = file.canonicalize().ok()?;
    let dist = dist_dir.canonicalize().ok()?;
    if !file.starts_with(&dist) {
        return None;
    }

    let is_index_html = file
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("index.html"))
        .unwrap_or(false);

    let content_type = content_type_for(&file);

    // Encoding is chosen from the *uncompressed* path, then swapped for the
    // sibling, so Content-Type stays that of the real asset.
    let (file, content_encoding) = match select_encoding(accept_encoding) {
        Some(encoding) => {
            let suffix = if encoding == "br" { "br" } else { "gz" };
            let candidate = PathBuf::from(format!("{}.{}", file.display(), suffix));
            if candidate.is_file() {
                (candidate, Some(encoding))
            } else {
                (file, None)
            }
        }
        None => (file, None),
    };

    let cache_control = if is_index_html {
        "no-store, no-cache, must-revalidate, proxy-revalidate"
    } else if is_hashed_asset(&file) {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };

    Some(Resolved { file, content_encoding, cache_control, is_index_html, content_type })
}

fn content_type_for(file: &Path) -> &'static str {
    match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fde-webui-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<html>").unwrap();
        std::fs::write(dir.join("assets/app-0123456789abcdef0.js"), "code").unwrap();
        std::fs::write(dir.join("assets/app-0123456789abcdef0.js.br"), "brotli").unwrap();
        std::fs::write(dir.join("assets/plain.css"), "css").unwrap();
        dir
    }

    #[test]
    fn detects_content_hashed_asset_names() {
        assert!(is_hashed_asset(Path::new("app-0123456789abcdef0.js")));
        assert!(is_hashed_asset(Path::new("x.0123456789abcdef.css")));
        assert!(!is_hashed_asset(Path::new("plain.css")));
        assert!(!is_hashed_asset(Path::new("app-0123abc.js")), "under 16 hex chars");
    }

    #[test]
    fn falls_back_to_index_html_for_client_routes() {
        let dir = fixture();
        let r = resolve(&dir, "/workspace/some/deep/route", None).unwrap();
        assert!(r.is_index_html);
        assert_eq!(r.cache_control, "no-store, no-cache, must-revalidate, proxy-revalidate");
        assert_eq!(r.content_type, "text/html; charset=utf-8");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn serves_a_brotli_sibling_when_accepted_and_keeps_the_real_content_type() {
        let dir = fixture();
        let path = "/assets/app-0123456789abcdef0.js";
        let r = resolve(&dir, path, Some("gzip, deflate, br")).unwrap();
        assert_eq!(r.content_encoding, Some("br"));
        assert!(r.file.to_string_lossy().ends_with(".js.br"));
        assert_eq!(r.content_type, "text/javascript; charset=utf-8");
        assert_eq!(r.cache_control, "public, max-age=31536000, immutable");

        // No Accept-Encoding: the plain file, uncompressed.
        let r = resolve(&dir, path, None).unwrap();
        assert_eq!(r.content_encoding, None);
        assert!(r.file.to_string_lossy().ends_with(".js"));

        // gzip accepted but no .gz sibling exists: fall back to plain.
        let r = resolve(&dir, path, Some("gzip")).unwrap();
        assert_eq!(r.content_encoding, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn unhashed_assets_are_revalidated() {
        let dir = fixture();
        let r = resolve(&dir, "/assets/plain.css", None).unwrap();
        assert_eq!(r.cache_control, "no-cache");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_to_escape_the_dist_directory() {
        let dir = fixture();
        // Traversal is stripped, so this lands on index.html rather than /etc/passwd.
        let r = resolve(&dir, "/../../../../etc/passwd", None).unwrap();
        assert!(r.is_index_html);
        let r = resolve(&dir, "/..%2f..%2fetc/passwd", None).unwrap();
        assert!(r.is_index_html);
        std::fs::remove_dir_all(&dir).ok();
    }
}
