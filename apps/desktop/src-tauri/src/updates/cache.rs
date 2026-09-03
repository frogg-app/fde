//! The last check result, persisted as `update-check.json` next to
//! `desktop-settings.json` so the Settings page can show "last checked" across
//! launches and automatic checks can be answered without hitting GitHub again.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FILENAME: &str = "update-check.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCheck {
    /// Unix time in milliseconds, what JavaScript's `Date.now()` returns.
    pub checked_at: u64,
    pub result: Value,
}

impl LastCheck {
    pub fn age_ms(&self, now: u64) -> u64 {
        now.saturating_sub(self.checked_at)
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn cache_path(dir: &Path) -> PathBuf {
    dir.join(FILENAME)
}

pub fn read(dir: &Path) -> Option<LastCheck> {
    let raw = fs::read_to_string(cache_path(dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn write(dir: &Path, entry: &LastCheck) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let target = cache_path(dir);
    let temp = dir.join(format!("{FILENAME}.tmp.{}", std::process::id()));
    let body = serde_json::to_string_pretty(entry).map_err(|e| e.to_string())?;
    fs::write(&temp, body).map_err(|e| e.to_string())?;
    fs::rename(&temp, &target).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trips_and_tolerates_garbage() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path().join("config");
        assert!(read(&cache_dir).is_none());
        let entry = LastCheck {
            checked_at: 1_700_000_000_000,
            result: json!({ "hasUpdate": false }),
        };
        write(&cache_dir, &entry).unwrap();
        assert_eq!(read(&cache_dir), Some(entry.clone()));
        assert_eq!(entry.age_ms(1_700_000_000_500), 500);
        assert_eq!(entry.age_ms(0), 0);
        fs::write(cache_path(&cache_dir), "{nope").unwrap();
        assert!(read(&cache_dir).is_none());
    }
}
