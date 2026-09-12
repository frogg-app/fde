//! Build-time product identity shared by the desktop shell and experimental daemon.
#![allow(dead_code)]
include!(concat!(env!("OUT_DIR"), "/brand.rs"));

pub fn env_key(suffix: &str) -> String {
    format!("{ENV_PREFIX}_{suffix}")
}
pub fn env_value(suffix: &str) -> Option<String> {
    let read = |key: String| {
        std::env::var(key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };
    read(env_key(suffix)).or_else(|| {
        if LEGACY_FDE {
            read(format!("PASEO_{suffix}"))
        } else {
            None
        }
    })
}
pub fn matches_identity(value: Option<&serde_json::Value>) -> bool {
    match value.filter(|v| !v.is_null()) {
        Some(identity) => {
            identity["id"].as_str() == Some(ID)
                && identity["applicationId"].as_str() == Some(APPLICATION_ID)
        }
        None => LEGACY_FDE,
    }
}
pub fn identity() -> serde_json::Value {
    serde_json::json!({ "id": ID, "name": NAME, "applicationId": APPLICATION_ID })
}
pub fn home_path(base: std::path::PathBuf) -> std::path::PathBuf {
    match env_value("HOME") {
        Some(value) if value == "~" => base,
        Some(value) if value.starts_with("~/") || value.starts_with("~\\") => {
            base.join(&value[2..])
        }
        Some(value) => std::path::PathBuf::from(value),
        None => base.join(HOME_DIR),
    }
}
pub fn daemon_artifact(version: &str, platform: &str, arch: &str) -> String {
    let extension = if platform == "win" { "zip" } else { "tar.gz" };
    format!("{DAEMON_ARTIFACT_PREFIX}-{version}-{platform}-{arch}.{extension}")
}
pub fn desktop_artifact(version: &str, suffix: &str) -> String {
    format!("{ARTIFACT_PREFIX}-{version}-{suffix}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_must_match_even_when_names_change() {
        assert!(matches_identity(Some(&identity())));
        assert!(!matches_identity(Some(
            &serde_json::json!({"id":"other","applicationId":APPLICATION_ID})
        )));
        assert_eq!(matches_identity(None), LEGACY_FDE);
        assert_eq!(
            daemon_artifact("1.2.3", "win", "x64"),
            format!("{DAEMON_ARTIFACT_PREFIX}-1.2.3-win-x64.zip")
        );
    }
}
