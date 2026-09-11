//! Fetching a bundle and its `.sha256` sidecar. `file://` URLs are read from
//! disk (tests, local builds); anything else goes through reqwest with a
//! streaming body so the UI can show progress.

use std::io::Read;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub type ProgressFn<'a> = &'a mut (dyn FnMut(u64, Option<u64>) + Send);

fn file_url_path(url: &str) -> Option<PathBuf> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "file" {
        return None;
    }
    parsed.to_file_path().ok()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(format!("fde-desktop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// Downloads `url` to `destination`, reporting `(received, total)` as bytes
/// arrive. The destination is written through a `.part` file and renamed.
pub async fn fetch_to_file(
    url: &str,
    destination: &Path,
    progress: ProgressFn<'_>,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let partial = destination.with_extension("part");
    if let Some(source) = file_url_path(url) {
        let total = tokio::fs::metadata(&source).await.ok().map(|m| m.len());
        tokio::fs::copy(&source, &partial)
            .await
            .map_err(|e| format!("copy {}: {e}", source.display()))?;
        progress(total.unwrap_or(0), total);
    } else {
        let response = client()?
            .get(url)
            .send()
            .await
            .map_err(|e| format!("download failed: {e}"))?
            .error_for_status()
            .map_err(|e| format!("download failed: {e}"))?;
        let total = response.content_length();
        let mut file = tokio::fs::File::create(&partial)
            .await
            .map_err(|e| e.to_string())?;
        let mut stream = response.bytes_stream();
        let mut received = 0u64;
        progress(0, total);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
            file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            received += chunk.len() as u64;
            progress(received, total);
        }
        file.flush().await.map_err(|e| e.to_string())?;
    }
    tokio::fs::rename(&partial, destination)
        .await
        .map_err(|e| e.to_string())
}

/// Fetches a small text resource (the checksum sidecar).
pub async fn fetch_text(url: &str) -> Result<String, String> {
    if let Some(source) = file_url_path(url) {
        return tokio::fs::read_to_string(&source)
            .await
            .map_err(|e| format!("read {}: {e}", source.display()));
    }
    client()?
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download failed: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// Lowercase hex SHA-256 of a file, streamed.
pub fn sha256_of_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    // sha2 0.11 no longer implements std::io::Write. Keep hashing streamed
    // with a fixed buffer rather than loading a complete installer into RAM.
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        };
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}

/// The digest from a `<hex>  <name>` sidecar line (the `sha256sum` format).
pub fn parse_checksum_sidecar(text: &str) -> Result<String, String> {
    let digest = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .and_then(|line| line.split_whitespace().next())
        .map(str::to_ascii_lowercase)
        .ok_or("checksum file is empty")?;
    if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "checksum file does not contain a SHA-256 digest: {digest}"
        ));
    }
    Ok(digest)
}

pub fn verify_checksum(path: &Path, sidecar_text: &str) -> Result<(), String> {
    let expected = parse_checksum_sidecar(sidecar_text)?;
    let actual = sha256_of_file(path)?;
    if actual != expected {
        return Err(format!(
            "checksum mismatch for {}: expected {expected}, got {actual}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sha256sum_lines_and_rejects_garbage() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_checksum_sidecar(&format!("\n{digest}  bundle.tar.gz\n")).unwrap(),
            digest
        );
        assert_eq!(
            parse_checksum_sidecar(&digest.to_uppercase()).unwrap(),
            digest
        );
        assert!(parse_checksum_sidecar("").is_err());
        assert!(parse_checksum_sidecar("nothex  x").is_err());
    }

    #[test]
    fn verifies_file_digest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.bin");
        std::fs::write(&path, b"hello").unwrap();
        let digest = sha256_of_file(&path).unwrap();
        assert_eq!(
            digest,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        verify_checksum(&path, &format!("{digest}  x.bin")).unwrap();
        let error = verify_checksum(&path, &format!("{}  x.bin", "0".repeat(64))).unwrap_err();
        assert!(error.contains("checksum mismatch"));
    }

    #[test]
    fn hashes_empty_files_and_multiple_read_buffers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("digest.bin");
        std::fs::write(&path, []).unwrap();
        assert_eq!(
            sha256_of_file(&path).unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // The million-'a' vector crosses full buffers and ends with a short read.
        std::fs::write(&path, vec![b'a'; 1_000_000]).unwrap();
        assert_eq!(
            sha256_of_file(&path).unwrap(),
            "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
        );
    }

    #[tokio::test]
    async fn fetches_file_urls_with_progress() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("src.bin");
        std::fs::write(&source, b"payload").unwrap();
        let url = url::Url::from_file_path(&source).unwrap().to_string();
        let destination = dir.path().join("nested").join("dst.bin");
        let mut seen = Vec::new();
        fetch_to_file(&url, &destination, &mut |r, t| seen.push((r, t)))
            .await
            .unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"payload");
        assert_eq!(seen, vec![(7, Some(7))]);
        assert_eq!(fetch_text(&url).await.unwrap(), "payload");
        assert!(fetch_text("file:///definitely/missing").await.is_err());
    }
}
