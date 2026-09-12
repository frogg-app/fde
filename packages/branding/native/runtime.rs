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
fn artifact_name(contract: &str, key: &str, version: &str) -> String {
    let parse = |value: &str| -> Option<Vec<u64>> {
        let parts = value
            .split(['-', '+'])
            .next()?
            .split('.')
            .map(str::parse::<u64>)
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        (parts.len() == 3).then_some(parts)
    };
    let legacy = LEGACY_FDE
        && parse(version)
            .zip(parse(LEGACY_ARTIFACT_CUTOFF))
            .is_some_and(|(version, cutoff)| version < cutoff);
    let names: serde_json::Value =
        serde_json::from_str(contract).expect("generated artifact contract");
    names[key][if legacy { "legacy" } else { "current" }]
        .as_str()
        .expect("supported distribution target")
        .replace("{version}", version)
}
pub fn daemon_artifact(version: &str, platform: &str, arch: &str) -> String {
    artifact_name(
        DAEMON_ARTIFACT_NAMES,
        &format!("{platform}-{arch}"),
        version,
    )
}
pub fn desktop_artifact(version: &str, suffix: &str) -> String {
    artifact_name(DESKTOP_ARTIFACT_NAMES, suffix, version)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn historical_fde_names_remain_addressable() {
        if LEGACY_FDE {
            assert_eq!(
                daemon_artifact("0.2.15", "darwin", "x64"),
                "fde-daemon-0.2.15-darwin-x64.tar.gz"
            );
            assert_eq!(
                daemon_artifact("0.2.16", "darwin", "x64"),
                "FDE-0.2.16-mac-x86_64-daemon.tar.gz"
            );
            assert_eq!(
                desktop_artifact("0.2.15", "linux-x86_64.deb"),
                "FDE-0.2.15-amd64.deb"
            );
            assert_eq!(
                desktop_artifact("0.2.16", "linux-x86_64.deb"),
                "FDE-0.2.16-linux-x86_64.deb"
            );
        }
    }
    #[test]
    fn identity_must_match_even_when_names_change() {
        assert!(matches_identity(Some(&identity())));
        assert!(!matches_identity(Some(
            &serde_json::json!({"id":"other","applicationId":APPLICATION_ID})
        )));
        assert_eq!(matches_identity(None), LEGACY_FDE);
        assert_eq!(
            daemon_artifact("1.2.3", "win", "x64"),
            if LEGACY_FDE {
                format!("{ARTIFACT_PREFIX}-1.2.3-win-x64-daemon.zip")
            } else {
                format!("{DAEMON_ARTIFACT_PREFIX}-1.2.3-win-x64.zip")
            }
        );
    }
}
