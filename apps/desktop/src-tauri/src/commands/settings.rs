//! Desktop settings: `desktop-settings.json` in the app config dir. Mirrors
//! Electron's `settings/desktop-settings.ts`, including its lenient coercion
//! (invalid fields fall back to defaults, unknown fields are ignored) and the
//! persisted document shape `{version, settings, migrations}`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const FILENAME: &str = "desktop-settings.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    pub play_sound: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonSettings {
    pub manage_built_in_daemon: bool,
    pub keep_running_after_quit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub release_channel: String,
    pub notifications: NotificationSettings,
    pub daemon: DaemonSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Migrations {
    pub legacy_renderer_settings_imported: bool,
    pub daemon_stop_on_quit_default_applied: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingsDocument {
    pub version: u32,
    pub settings: DesktopSettings,
    pub migrations: Migrations,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            release_channel: "stable".into(),
            notifications: NotificationSettings { play_sound: true },
            // Electron defaulted to `true`; there is no sidecar daemon until
            // milestone 3, so the shell must not try to manage one.
            daemon: DaemonSettings { manage_built_in_daemon: false, keep_running_after_quit: false },
        }
    }
}

impl Default for SettingsDocument {
    fn default() -> Self {
        Self {
            version: 1,
            settings: DesktopSettings::default(),
            migrations: Migrations {
                legacy_renderer_settings_imported: false,
                daemon_stop_on_quit_default_applied: true,
            },
        }
    }
}

/// A validated patch: only present, well-typed fields are applied.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SettingsPatch {
    pub release_channel: Option<String>,
    pub play_sound: Option<bool>,
    pub manage_built_in_daemon: Option<bool>,
    pub keep_running_after_quit: Option<bool>,
}

fn release_channel(value: Option<&Value>) -> Option<String> {
    match value.and_then(Value::as_str) {
        Some(channel @ ("stable" | "beta")) => Some(channel.to_string()),
        _ => None,
    }
}

fn boolean(value: Option<&Value>) -> Option<bool> {
    value.and_then(Value::as_bool)
}

pub fn coerce_patch(input: &Value) -> SettingsPatch {
    let Some(input) = input.as_object() else {
        return SettingsPatch::default();
    };
    let notifications = input.get("notifications").and_then(Value::as_object);
    let daemon = input.get("daemon").and_then(Value::as_object);
    SettingsPatch {
        release_channel: release_channel(input.get("releaseChannel")),
        play_sound: boolean(notifications.and_then(|n| n.get("playSound"))),
        manage_built_in_daemon: boolean(daemon.and_then(|d| d.get("manageBuiltInDaemon"))),
        keep_running_after_quit: boolean(daemon.and_then(|d| d.get("keepRunningAfterQuit"))),
    }
}

/// Electron's `pickDesktopSettingsFromLegacyRendererSettings`: the old
/// renderer-owned settings were flat.
fn coerce_legacy_patch(input: &Value) -> SettingsPatch {
    let Some(input) = input.as_object() else {
        return SettingsPatch::default();
    };
    SettingsPatch {
        release_channel: release_channel(input.get("releaseChannel")),
        manage_built_in_daemon: boolean(input.get("manageBuiltInDaemon")),
        ..SettingsPatch::default()
    }
}

fn has_legacy_renderer_owned_field(patch: &SettingsPatch) -> bool {
    patch.release_channel.is_some() || patch.manage_built_in_daemon.is_some()
}

pub fn merge(current: &DesktopSettings, patch: &SettingsPatch) -> DesktopSettings {
    DesktopSettings {
        release_channel: patch.release_channel.clone().unwrap_or_else(|| current.release_channel.clone()),
        notifications: NotificationSettings {
            play_sound: patch.play_sound.unwrap_or(current.notifications.play_sound),
        },
        daemon: DaemonSettings {
            manage_built_in_daemon: patch
                .manage_built_in_daemon
                .unwrap_or(current.daemon.manage_built_in_daemon),
            keep_running_after_quit: patch
                .keep_running_after_quit
                .unwrap_or(current.daemon.keep_running_after_quit),
        },
    }
}

/// Lenient parse of a stored document (zod `.catch` semantics per field).
pub fn coerce_document(input: &Value) -> SettingsDocument {
    let defaults = SettingsDocument::default();
    let Some(object) = input.as_object() else {
        return defaults;
    };
    let settings_value = object.get("settings").unwrap_or(&Value::Null);
    let settings = merge(&DesktopSettings::default(), &coerce_patch(settings_value));
    let migrations_value = object.get("migrations").and_then(Value::as_object);
    let mut migrations = Migrations {
        legacy_renderer_settings_imported: boolean(
            migrations_value.and_then(|m| m.get("legacyRendererSettingsImported")),
        )
        .unwrap_or(false),
        daemon_stop_on_quit_default_applied: boolean(
            migrations_value.and_then(|m| m.get("daemonStopOnQuitDefaultApplied")),
        )
        .unwrap_or(false),
    };

    let mut settings = settings;
    if !migrations.daemon_stop_on_quit_default_applied {
        settings.daemon.keep_running_after_quit =
            DesktopSettings::default().daemon.keep_running_after_quit;
        migrations.daemon_stop_on_quit_default_applied = true;
    }

    SettingsDocument { version: defaults.version, settings, migrations }
}

pub struct SettingsStore {
    dir: PathBuf,
    lock: Mutex<()>,
}

impl SettingsStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, lock: Mutex::new(()) }
    }

    fn file_path(&self) -> PathBuf {
        self.dir.join(FILENAME)
    }

    fn persist(&self, document: &SettingsDocument) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let target = self.file_path();
        let temp = self.dir.join(format!("{FILENAME}.tmp.{}", std::process::id()));
        let body = serde_json::to_string_pretty(document).map_err(|e| e.to_string())?;
        fs::write(&temp, format!("{body}\n")).map_err(|e| e.to_string())?;
        fs::rename(&temp, &target).map_err(|e| e.to_string())
    }

    fn load(&self) -> Result<SettingsDocument, String> {
        match fs::read_to_string(self.file_path()) {
            Ok(raw) => {
                let value: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
                Ok(coerce_document(&value))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let document = SettingsDocument::default();
                self.persist(&document)?;
                Ok(document)
            }
            Err(error) => Err(error.to_string()),
        }
    }

    fn to_value(settings: &DesktopSettings) -> Result<Value, String> {
        serde_json::to_value(settings).map_err(|e| e.to_string())
    }

    pub fn get(&self) -> Result<Value, String> {
        let _guard = self.lock.lock().unwrap();
        Self::to_value(&self.load()?.settings)
    }

    pub fn patch(&self, patch: &Value) -> Result<Value, String> {
        let _guard = self.lock.lock().unwrap();
        let current = self.load()?;
        let coerced = coerce_patch(patch);
        let next = merge(&current.settings, &coerced);
        let document = SettingsDocument {
            settings: next.clone(),
            migrations: Migrations {
                legacy_renderer_settings_imported: current.migrations.legacy_renderer_settings_imported
                    || has_legacy_renderer_owned_field(&coerced),
                ..current.migrations
            },
            ..current
        };
        self.persist(&document)?;
        Self::to_value(&next)
    }

    pub fn migrate_legacy_renderer_settings(&self, legacy: &Value) -> Result<Value, String> {
        let _guard = self.lock.lock().unwrap();
        let current = match self.load() {
            Ok(document) => document,
            Err(_) => {
                let document = SettingsDocument::default();
                self.persist(&document)?;
                document
            }
        };
        if current.migrations.legacy_renderer_settings_imported {
            return Self::to_value(&current.settings);
        }
        let next = merge(&current.settings, &coerce_legacy_patch(legacy));
        let document = SettingsDocument {
            settings: next.clone(),
            migrations: Migrations { legacy_renderer_settings_imported: true, ..current.migrations },
            ..current
        };
        self.persist(&document)?;
        Self::to_value(&next)
    }
}

#[allow(dead_code)]
pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join(FILENAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> (tempfile::TempDir, SettingsStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("config"));
        (dir, store)
    }

    #[test]
    fn get_creates_default_document() {
        let (_dir, store) = store();
        let settings = store.get().unwrap();
        assert_eq!(settings["releaseChannel"], "stable");
        assert_eq!(settings["notifications"]["playSound"], true);
        assert_eq!(settings["daemon"]["manageBuiltInDaemon"], false);
        assert!(store.file_path().exists());
        let raw: Value = serde_json::from_str(&fs::read_to_string(store.file_path()).unwrap()).unwrap();
        assert_eq!(raw["version"], 1);
        assert_eq!(raw["migrations"]["daemonStopOnQuitDefaultApplied"], true);
    }

    #[test]
    fn patch_merges_nested_sections_and_ignores_invalid_values() {
        let (_dir, store) = store();
        let patched = store
            .patch(&json!({
                "releaseChannel": "nightly",
                "notifications": { "playSound": false, "extra": 1 },
                "daemon": { "keepRunningAfterQuit": "yes", "manageBuiltInDaemon": true },
                "unknown": true
            }))
            .unwrap();
        assert_eq!(patched["releaseChannel"], "stable", "invalid channel ignored");
        assert_eq!(patched["notifications"]["playSound"], false);
        assert_eq!(patched["daemon"]["manageBuiltInDaemon"], true);
        assert_eq!(patched["daemon"]["keepRunningAfterQuit"], false, "non-boolean ignored");
        assert!(patched.get("unknown").is_none());

        let again = store.patch(&json!({ "releaseChannel": "beta" })).unwrap();
        assert_eq!(again["releaseChannel"], "beta");
        assert_eq!(again["notifications"]["playSound"], false, "earlier patch preserved");
        assert_eq!(again["daemon"]["manageBuiltInDaemon"], true);
        assert_eq!(store.get().unwrap(), again, "persisted");
    }

    #[test]
    fn patch_with_non_object_is_a_noop() {
        let (_dir, store) = store();
        let before = store.get().unwrap();
        assert_eq!(store.patch(&json!("nope")).unwrap(), before);
        assert_eq!(store.patch(&Value::Null).unwrap(), before);
    }

    #[test]
    fn patch_marks_legacy_renderer_fields_as_imported() {
        let (_dir, store) = store();
        store.patch(&json!({ "notifications": { "playSound": false } })).unwrap();
        let raw: Value = serde_json::from_str(&fs::read_to_string(store.file_path()).unwrap()).unwrap();
        assert_eq!(raw["migrations"]["legacyRendererSettingsImported"], false);

        store.patch(&json!({ "releaseChannel": "beta" })).unwrap();
        let raw: Value = serde_json::from_str(&fs::read_to_string(store.file_path()).unwrap()).unwrap();
        assert_eq!(raw["migrations"]["legacyRendererSettingsImported"], true);

        let migrated = store
            .migrate_legacy_renderer_settings(&json!({ "releaseChannel": "stable" }))
            .unwrap();
        assert_eq!(migrated["releaseChannel"], "beta", "legacy import skipped once imported");
    }

    #[test]
    fn migrate_legacy_imports_flat_settings_once() {
        let (_dir, store) = store();
        let migrated = store
            .migrate_legacy_renderer_settings(&json!({ "releaseChannel": "beta", "manageBuiltInDaemon": true }))
            .unwrap();
        assert_eq!(migrated["releaseChannel"], "beta");
        assert_eq!(migrated["daemon"]["manageBuiltInDaemon"], true);
        let second = store.migrate_legacy_renderer_settings(&json!({ "releaseChannel": "stable" })).unwrap();
        assert_eq!(second["releaseChannel"], "beta");
    }

    #[test]
    fn malformed_document_falls_back_to_defaults_per_field() {
        let (_dir, store) = store();
        fs::create_dir_all(&store.dir).unwrap();
        fs::write(
            store.file_path(),
            r#"{"version":7,"settings":{"releaseChannel":"beta","notifications":"bad","daemon":{"keepRunningAfterQuit":true}}}"#,
        )
        .unwrap();
        let settings = store.get().unwrap();
        assert_eq!(settings["releaseChannel"], "beta");
        assert_eq!(settings["notifications"]["playSound"], true);
        assert_eq!(
            settings["daemon"]["keepRunningAfterQuit"], false,
            "stop-on-quit migration resets the flag when not yet applied"
        );
    }

    #[test]
    fn unparsable_json_is_an_error_for_get_but_reset_by_migration() {
        let (_dir, store) = store();
        fs::create_dir_all(&store.dir).unwrap();
        fs::write(store.file_path(), "{not json").unwrap();
        assert!(store.get().is_err());
        let migrated = store.migrate_legacy_renderer_settings(&Value::Null).unwrap();
        assert_eq!(migrated["releaseChannel"], "stable");
        assert!(store.get().is_ok());
    }
}
