//! GitHub release records and the rule that picks the one to offer: the
//! highest non-draft semver above the running version, with prerelease tags
//! (`1.2.0-beta.1`) only on the `beta` channel. GitHub's own `prerelease` flag
//! is ignored on purpose: `release.yml` marks every `0.x` version pre-release,
//! so honouring it would hide every update before 1.0.

use semver::Version;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    #[serde(default)]
    pub size: u64,
    #[serde(rename = "browser_download_url")]
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Release {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub html_url: Option<String>,
    #[serde(default)]
    pub assets: Vec<ReleaseAsset>,
}

impl Release {
    /// The semver behind the tag (`v1.2.3` or `1.2.3`), if it parses.
    pub fn version(&self) -> Option<Version> {
        parse_version(&self.tag_name)
    }

    pub fn asset(&self, name: &str) -> Option<&ReleaseAsset> {
        self.assets.iter().find(|asset| asset.name == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Stable,
    Beta,
}

impl Channel {
    /// Anything but `beta` is stable, matching the settings store's coercion.
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("beta") => Channel::Beta,
            _ => Channel::Stable,
        }
    }

    pub fn allows(self, version: &Version) -> bool {
        self == Channel::Beta || version.pre.is_empty()
    }
}

/// `v1.2.3`, `1.2.3`, `1.2.3-beta.1` → `Version`. Whitespace is tolerated.
pub fn parse_version(text: &str) -> Option<Version> {
    let trimmed = text.trim();
    let bare = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    Version::parse(bare).ok()
}

/// The newest release worth offering, or `None` when the running version is
/// the latest for this channel.
pub fn select_release<'a>(
    releases: &'a [Release],
    current: &Version,
    channel: Channel,
) -> Option<&'a Release> {
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| release.version().map(|version| (version, release)))
        .filter(|(version, _)| channel.allows(version) && version > current)
        .max_by(|(a, _), (b, _)| a.cmp(b))
        .map(|(_, release)| release)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            name: None,
            body: None,
            draft: false,
            prerelease: tag.starts_with("v0.") || tag.contains('-'),
            published_at: None,
            html_url: None,
            assets: Vec::new(),
        }
    }

    fn v(text: &str) -> Version {
        parse_version(text).unwrap()
    }

    #[test]
    fn parses_tags_with_and_without_prefix() {
        assert_eq!(parse_version("v1.2.3"), Some(Version::new(1, 2, 3)));
        assert_eq!(parse_version(" 1.2.3 "), Some(Version::new(1, 2, 3)));
        assert_eq!(
            parse_version("v1.2.3-beta.1").unwrap().pre.as_str(),
            "beta.1"
        );
        assert_eq!(parse_version("nightly"), None);
        assert_eq!(parse_version("v1.2"), None);
    }

    #[test]
    fn stable_channel_skips_prerelease_tags_but_not_github_prerelease_flag() {
        let releases = vec![
            release("v0.1.12"),
            release("v0.2.0-beta.1"),
            release("v0.1.11"),
        ];
        let picked = select_release(&releases, &v("0.1.11"), Channel::Stable).unwrap();
        assert_eq!(picked.tag_name, "v0.1.12");
        assert!(
            picked.prerelease,
            "0.x releases carry GitHub's prerelease flag"
        );
    }

    #[test]
    fn beta_channel_offers_prerelease_tags_and_orders_them_below_the_final() {
        let releases = vec![release("v0.2.0-beta.1"), release("v0.1.12")];
        let picked = select_release(&releases, &v("0.1.12"), Channel::Beta).unwrap();
        assert_eq!(picked.tag_name, "v0.2.0-beta.1");

        let releases = vec![release("v0.2.0-beta.1"), release("v0.2.0")];
        let picked = select_release(&releases, &v("0.1.12"), Channel::Beta).unwrap();
        assert_eq!(
            picked.tag_name, "v0.2.0",
            "the final beats its own prerelease"
        );
        assert!(select_release(&releases, &v("0.2.0"), Channel::Beta).is_none());
        assert_eq!(
            select_release(&releases, &v("0.2.0-alpha.9"), Channel::Beta)
                .unwrap()
                .tag_name,
            "v0.2.0"
        );
    }

    #[test]
    fn skips_drafts_unparsable_tags_and_older_versions() {
        let mut draft = release("v9.0.0");
        draft.draft = true;
        let releases = vec![
            draft,
            release("latest"),
            release("v0.1.0"),
            release("v0.1.5"),
        ];
        assert_eq!(
            select_release(&releases, &v("0.1.2"), Channel::Stable)
                .unwrap()
                .tag_name,
            "v0.1.5"
        );
        assert!(select_release(&releases, &v("0.1.5"), Channel::Stable).is_none());
        assert!(select_release(&[], &v("0.1.5"), Channel::Beta).is_none());
    }

    #[test]
    fn deserializes_github_release_json() {
        let json = r#"[{"tag_name":"v1.0.0","draft":false,"prerelease":false,
            "body":"notes","published_at":"2026-01-01T00:00:00Z",
            "assets":[{"name":"FDE-1.0.0-amd64.deb","size":12,"browser_download_url":"https://x/y"}]}]"#;
        let releases: Vec<Release> = serde_json::from_str(json).unwrap();
        assert_eq!(releases[0].assets[0].url, "https://x/y");
        assert_eq!(releases[0].assets[0].size, 12);
        assert_eq!(
            releases[0].asset("FDE-1.0.0-amd64.deb").map(|a| a.size),
            Some(12)
        );
        assert!(releases[0].asset("missing").is_none());
    }
}
