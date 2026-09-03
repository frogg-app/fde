//! The check result the webview consumes (Electron's `AppUpdateCheckResult`
//! plus release notes, assets and the install plan) and the GitHub-release
//! check that produces it.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::assets::{current_arch, AssetKind};
use super::github::{fetch_releases, github_token};
use super::release::{parse_version, select_release, Channel, Release, ReleaseAsset};
use super::{Strategy, Updates};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetInfo {
    pub name: String,
    pub size: u64,
    pub url: String,
}

impl From<&ReleaseAsset> for AssetInfo {
    fn from(asset: &ReleaseAsset) -> Self {
        Self {
            name: asset.name.clone(),
            size: asset.size,
            url: asset.url.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub has_update: bool,
    /// True when an asset for this platform exists, so Install can proceed.
    pub ready_to_install: bool,
    pub current_version: String,
    pub latest_version: String,
    /// Release body (markdown); `notes` is the same text under the name the
    /// Settings page uses, `body` is what Electron's shape called it.
    pub body: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    pub error_message: Option<String>,
    #[serde(default)]
    pub assets: Vec<AssetInfo>,
    /// The asset the install step downloads, when one matches this platform.
    pub asset: Option<AssetInfo>,
    pub checksum_asset: Option<AssetInfo>,
    pub install_kind: Option<String>,
    pub release_url: Option<String>,
    pub strategy: String,
    pub channel: String,
    pub checked_at: u64,
}

impl CheckResult {
    pub fn up_to_date(updates: &Updates, channel: Channel, strategy: Strategy) -> Self {
        Self::empty(updates, channel, strategy, None)
    }

    pub fn failed(updates: &Updates, channel: Channel, strategy: Strategy, error: String) -> Self {
        Self::empty(updates, channel, strategy, Some(error))
    }

    fn empty(
        updates: &Updates,
        channel: Channel,
        strategy: Strategy,
        error: Option<String>,
    ) -> Self {
        Self {
            has_update: false,
            ready_to_install: false,
            current_version: updates.current_version.clone(),
            latest_version: updates.current_version.clone(),
            body: None,
            notes: None,
            date: None,
            error_message: error,
            assets: Vec::new(),
            asset: None,
            checksum_asset: None,
            install_kind: None,
            release_url: None,
            strategy: strategy.as_str().to_string(),
            channel: channel_name(channel).to_string(),
            checked_at: super::cache::now_ms(),
        }
    }

    pub fn from_release(
        updates: &Updates,
        channel: Channel,
        release: &Release,
        kind: Option<AssetKind>,
    ) -> Self {
        let latest = release
            .version()
            .map(|v| v.to_string())
            .unwrap_or_else(|| release.tag_name.clone());
        let asset_name = kind.map(|kind| kind.asset_name(&latest, current_arch()));
        let asset = asset_name
            .as_deref()
            .and_then(|name| release.asset(name))
            .map(AssetInfo::from);
        let checksum_asset = asset_name
            .as_deref()
            .and_then(|name| release.asset(&format!("{name}.sha256")))
            .map(AssetInfo::from);
        Self {
            has_update: true,
            ready_to_install: asset.is_some(),
            current_version: updates.current_version.clone(),
            latest_version: latest,
            body: release.body.clone(),
            notes: release.body.clone(),
            date: release.published_at.clone(),
            error_message: match (&asset, asset_name) {
                (None, Some(name)) => Some(format!(
                    "Release {} has no {name} asset for this platform.",
                    release.tag_name
                )),
                (None, None) => Some("No update asset is published for this platform.".into()),
                _ => None,
            },
            assets: release.assets.iter().map(AssetInfo::from).collect(),
            asset,
            checksum_asset,
            install_kind: kind.map(|kind| kind.as_str().to_string()),
            release_url: release.html_url.clone(),
            strategy: Strategy::GithubRelease.as_str().to_string(),
            channel: channel_name(channel).to_string(),
            checked_at: super::cache::now_ms(),
        }
    }

    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

pub fn channel_name(channel: Channel) -> &'static str {
    match channel {
        Channel::Stable => "stable",
        Channel::Beta => "beta",
    }
}

/// Queries the releases endpoint and picks the update for `channel`. Network
/// and parse failures come back inside the result (`errorMessage`), as the
/// Electron shell reported them, so the UI decides how loud to be.
pub async fn check_github(
    updates: &Updates,
    channel: Channel,
    kind: Option<AssetKind>,
) -> CheckResult {
    let Some(current) = parse_version(&updates.current_version) else {
        return CheckResult::failed(
            updates,
            channel,
            Strategy::GithubRelease,
            format!("app version {} is not semver", updates.current_version),
        );
    };
    let token = github_token();
    let releases = match fetch_releases(
        &updates.releases_url,
        &updates.current_version,
        token.as_deref(),
    )
    .await
    {
        Ok(releases) => releases,
        Err(error) => {
            log::info!("updates: check failed: {error}");
            return CheckResult::failed(updates, channel, Strategy::GithubRelease, error);
        }
    };
    log::info!(
        "updates: {} releases fetched; current {current}, channel {}",
        releases.len(),
        channel_name(channel)
    );
    match select_release(&releases, &current, channel) {
        Some(release) => {
            let result = CheckResult::from_release(updates, channel, release, kind);
            log::info!(
                "updates: {} available (asset {:?}, kind {:?})",
                result.latest_version,
                result.asset.as_ref().map(|a| &a.name),
                result.install_kind
            );
            result
        }
        None => CheckResult::up_to_date(updates, channel, Strategy::GithubRelease),
    }
}
