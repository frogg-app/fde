//! Shell log file. A minimal `log` backend that appends one line per record
//! to `<app log dir>/fde.log`, so `desktop_app_logs` and diagnostic reports
//! have something real to show, as Electron's `electron-log` file did.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

pub const FILENAME: &str = "fde.log";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
pub const APP_LOG_TAIL_LINES: usize = 200;
pub const DAEMON_LOG_TAIL_LINES: usize = 100;

pub struct FileLogger {
    file: Mutex<File>,
}

impl FileLogger {
    /// Opens (or rotates) the log file and installs it as the global logger.
    pub fn install(path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::metadata(path)
            .map(|m| m.len() > MAX_LOG_BYTES)
            .unwrap_or(false)
        {
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let logger = Box::new(FileLogger {
            file: Mutex::new(file),
        });
        log::set_boxed_logger(logger).map_err(std::io::Error::other)?;
        log::set_max_level(log::LevelFilter::Info);
        Ok(())
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Info
    }

    fn log(&self, record: &log::Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let line = format!(
            "{} [{}] {}: {}\n",
            timestamp(),
            record.level(),
            record.target(),
            record.args()
        );
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(line.as_bytes());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// UTC `YYYY-MM-DDTHH:MM:SSZ` without pulling in a date crate.
fn timestamp() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

// Howard Hinnant's days-to-civil algorithm.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

pub fn log_file_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_log_dir().ok().map(|dir| dir.join(FILENAME))
}

/// Last `lines` lines of a file; empty when it does not exist.
pub fn tail_file(path: &Path, lines: usize) -> Result<String, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
        Err(error) => return Err(error.to_string()),
    };
    let all: Vec<String> = BufReader::new(file).lines().map_while(Result::ok).collect();
    let start = all.len().saturating_sub(lines);
    Ok(all[start..].join("\n"))
}

/// `desktop_app_logs`: `{logPath, contents}`.
pub fn app_logs<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let Some(path) = log_file_path(app) else {
        return Ok(json!({ "logPath": "", "contents": "" }));
    };
    Ok(
        json!({ "logPath": path.to_string_lossy(), "contents": tail_file(&path, APP_LOG_TAIL_LINES)? }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tails_last_lines() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("x.log");
        fs::write(&path, "a\nb\nc\nd\n").unwrap();
        assert_eq!(tail_file(&path, 2).unwrap(), "c\nd");
        assert_eq!(tail_file(&dir.path().join("missing.log"), 2).unwrap(), "");
    }

    #[test]
    fn formats_civil_dates() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
    }
}
