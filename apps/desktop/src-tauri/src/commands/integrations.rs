//! CLI install and the legacy skill-selection file. The bundled CLI shim is
//! part of the sidecar (milestone 3), so install reports "not available"; the
//! legacy skill selection mirrors Electron's `legacy-skill-selection.ts`.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

const LEGACY_SKILL_SELECTION_FILENAME: &str = "skill-selection.json";

/// `get_cli_install_status`: `{installed}`.
pub fn cli_install_status() -> Value {
    json!({ "installed": false })
}

/// `install_cli`.
pub fn install_cli() -> Result<Value, String> {
    Err("The FDE CLI is not available in this build yet; it ships with the local daemon.".into())
}

fn legacy_selection_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(LEGACY_SKILL_SELECTION_FILENAME))
}

/// Electron's `parseSelection`: anything malformed degrades to `{mode:"all"}`.
pub fn parse_legacy_selection(document: &Value) -> Value {
    let Some(selection) = document.get("selection").filter(|v| v.is_object()) else {
        return json!({ "mode": "all" });
    };
    if selection.get("mode").and_then(Value::as_str) != Some("custom") {
        return json!({ "mode": "all" });
    }
    let Some(skills) = selection.get("skills").and_then(Value::as_array) else {
        return json!({ "mode": "all" });
    };
    let mut names: Vec<String> = skills
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect();
    names.sort();
    names.dedup();
    json!({ "mode": "custom", "skills": names })
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
pub fn read_legacy_skill_selection<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let Some(path) = legacy_selection_path(app) else {
        return Ok(Value::Null);
    };
    match fs::read_to_string(&path) {
        Ok(raw) => Ok(serde_json::from_str::<Value>(&raw)
            .map(|document| parse_legacy_selection(&document))
            .unwrap_or_else(|_| json!({ "mode": "all" }))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(error) => Err(error.to_string()),
    }
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
pub fn delete_legacy_skill_selection<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    if let Some(path) = legacy_selection_path(app) {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_selection_like_electron() {
        assert_eq!(parse_legacy_selection(&json!({})), json!({ "mode": "all" }));
        assert_eq!(
            parse_legacy_selection(&json!({ "selection": { "mode": "all" } })),
            json!({ "mode": "all" })
        );
        assert_eq!(
            parse_legacy_selection(
                &json!({ "selection": { "mode": "custom", "skills": [" b", "a", "b", "", 3] } })
            ),
            json!({ "mode": "custom", "skills": ["a", "b"] })
        );
        assert_eq!(
            parse_legacy_selection(&json!({ "selection": { "mode": "custom" } })),
            json!({ "mode": "all" })
        );
    }
}
