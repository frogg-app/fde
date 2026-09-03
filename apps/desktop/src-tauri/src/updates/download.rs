//! Downloading the chosen release asset into `<app cache dir>/updates/` with
//! `paseo:event:app-update-progress` events, then verifying the `.sha256`
//! sidecar when the release carries one. Reuses the sidecar bundle fetcher.

use std::path::PathBuf;

use serde_json::json;

use super::check::AssetInfo;
use super::Updates;
use crate::sidecar::download::{fetch_text, fetch_to_file, verify_checksum};

const PROGRESS_STEP_BYTES: u64 = 256 * 1024;

fn safe_file_name(name: &str) -> Result<&str, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(format!("asset name {name:?} is not a plain file name"));
    }
    Ok(name)
}

/// Fetches `asset` (and checks `checksum` when given). Returns the local path.
/// An earlier copy of the same file is removed first, so a retry never trusts
/// a partial download.
pub async fn download_asset(
    updates: &Updates,
    asset: &AssetInfo,
    checksum: Option<&AssetInfo>,
) -> Result<PathBuf, String> {
    let file_name = safe_file_name(&asset.name)?;
    let destination = updates.download_dir.join(file_name);
    let _ = tokio::fs::remove_file(&destination).await;
    log::info!(
        "updates: downloading {} ({} bytes) to {}",
        asset.url,
        asset.size,
        destination.display()
    );

    let expected_total = (asset.size > 0).then_some(asset.size);
    let mut last_emitted = 0u64;
    let mut on_progress = |received: u64, total: Option<u64>| {
        let total = total.or(expected_total);
        if received == 0
            || received - last_emitted >= PROGRESS_STEP_BYTES
            || Some(received) == total
        {
            last_emitted = received;
            updates.emit_progress(json!({
                "phase": "download",
                "received": received,
                "total": total,
                "asset": asset.name,
            }));
        }
    };
    fetch_to_file(&asset.url, &destination, &mut on_progress)
        .await
        .map_err(|e| format!("update download failed ({}): {e}", asset.url))?;

    let size = tokio::fs::metadata(&destination)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    match checksum {
        Some(checksum) => {
            updates.emit_progress(json!({
                "phase": "verify",
                "received": size,
                "total": size,
                "asset": asset.name,
            }));
            let text = fetch_text(&checksum.url)
                .await
                .map_err(|e| format!("checksum download failed ({}): {e}", checksum.url))?;
            let path = destination.clone();
            tokio::task::spawn_blocking(move || verify_checksum(&path, &text))
                .await
                .map_err(|e| e.to_string())??;
            log::info!("updates: downloaded {size} bytes, checksum verified");
        }
        None => log::warn!(
            "updates: downloaded {size} bytes; release has no .sha256 sidecar for {}",
            asset.name
        ),
    }
    Ok(destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_asset_names_with_path_parts() {
        assert!(safe_file_name("FDE-1.0.0-amd64.deb").is_ok());
        for bad in ["", ".", "..", "a/b", "a\\b", "../x"] {
            assert!(safe_file_name(bad).is_err(), "{bad:?}");
        }
    }
}
