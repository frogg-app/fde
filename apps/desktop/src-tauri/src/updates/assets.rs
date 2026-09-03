//! Which release asset this running binary updates from. Names follow
//! `scripts/release/collect-desktop-bundles.mjs` (see docs/ci.md):
//!
//! | kind              | asset                          |
//! | ----------------- | ------------------------------ |
//! | Windows installer | `FDE-<v>-x64-setup.exe`        |
//! | Windows portable  | `FDE-<v>-x64-portable.zip`     |
//! | Linux AppImage    | `FDE-<v>-x86_64.AppImage`      |
//! | Linux deb         | `FDE-<v>-amd64.deb`            |
//! | macOS             | `FDE-<v>-<aarch64|x86_64>.dmg` |

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetKind {
    WindowsInstaller,
    WindowsPortable,
    LinuxAppImage,
    LinuxDeb,
    MacDmg,
}

impl AssetKind {
    /// Stable identifier the UI uses to describe the install step.
    pub fn as_str(self) -> &'static str {
        match self {
            AssetKind::WindowsInstaller => "windows-installer",
            AssetKind::WindowsPortable => "windows-portable",
            AssetKind::LinuxAppImage => "linux-appimage",
            AssetKind::LinuxDeb => "linux-deb",
            AssetKind::MacDmg => "macos-dmg",
        }
    }

    /// Release asset name for `version` on `arch` (`aarch64` or `x86_64`).
    pub fn asset_name(self, version: &str, arch: &str) -> String {
        match self {
            AssetKind::WindowsInstaller => format!("FDE-{version}-x64-setup.exe"),
            AssetKind::WindowsPortable => format!("FDE-{version}-x64-portable.zip"),
            AssetKind::LinuxAppImage => format!("FDE-{version}-x86_64.AppImage"),
            AssetKind::LinuxDeb => format!("FDE-{version}-amd64.deb"),
            AssetKind::MacDmg => format!("FDE-{version}-{arch}.dmg"),
        }
    }
}

/// What the shell knows about how it was installed; kept as plain data so the
/// mapping is testable on every host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallContext {
    pub os: &'static str,
    /// Linux: `$APPIMAGE` (set by the AppImage runtime) when running from one.
    pub appimage: Option<String>,
    /// Windows: an NSIS install has `uninstall.exe` next to the exe.
    pub nsis_install: bool,
}

impl InstallContext {
    pub fn detect() -> Self {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf));
        Self {
            os: current_os(),
            appimage: std::env::var("APPIMAGE")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            nsis_install: exe_dir.as_deref().map(is_nsis_install_dir).unwrap_or(false),
        }
    }

    pub fn asset_kind(&self) -> Option<AssetKind> {
        match self.os {
            "windows" => Some(if self.nsis_install {
                AssetKind::WindowsInstaller
            } else {
                AssetKind::WindowsPortable
            }),
            "linux" => Some(if self.appimage.is_some() {
                AssetKind::LinuxAppImage
            } else {
                AssetKind::LinuxDeb
            }),
            "macos" => Some(AssetKind::MacDmg),
            _ => None,
        }
    }
}

pub fn current_os() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
}

/// `aarch64` or `x86_64`, the two the release builds.
pub fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x86_64"
    }
}

/// Tauri's NSIS bundle writes `uninstall.exe` into the install directory; a
/// portable exe copied anywhere has no such neighbour.
pub fn is_nsis_install_dir(dir: &Path) -> bool {
    dir.join("uninstall.exe").is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(os: &'static str) -> InstallContext {
        InstallContext {
            os,
            appimage: None,
            nsis_install: false,
        }
    }

    #[test]
    fn maps_platforms_to_asset_kinds() {
        assert_eq!(
            context("windows").asset_kind(),
            Some(AssetKind::WindowsPortable)
        );
        assert_eq!(
            InstallContext {
                nsis_install: true,
                ..context("windows")
            }
            .asset_kind(),
            Some(AssetKind::WindowsInstaller)
        );
        assert_eq!(context("linux").asset_kind(), Some(AssetKind::LinuxDeb));
        assert_eq!(
            InstallContext {
                appimage: Some("/opt/FDE.AppImage".into()),
                ..context("linux")
            }
            .asset_kind(),
            Some(AssetKind::LinuxAppImage)
        );
        assert_eq!(context("macos").asset_kind(), Some(AssetKind::MacDmg));
        assert_eq!(context("freebsd").asset_kind(), None);
    }

    #[test]
    fn names_assets_like_the_release_workflow() {
        assert_eq!(
            AssetKind::WindowsInstaller.asset_name("0.2.0", "x86_64"),
            "FDE-0.2.0-x64-setup.exe"
        );
        assert_eq!(
            AssetKind::WindowsPortable.asset_name("0.2.0", "x86_64"),
            "FDE-0.2.0-x64-portable.zip"
        );
        assert_eq!(
            AssetKind::LinuxAppImage.asset_name("0.2.0", "x86_64"),
            "FDE-0.2.0-x86_64.AppImage"
        );
        assert_eq!(
            AssetKind::LinuxDeb.asset_name("0.2.0", "x86_64"),
            "FDE-0.2.0-amd64.deb"
        );
        assert_eq!(
            AssetKind::MacDmg.asset_name("0.2.0", "aarch64"),
            "FDE-0.2.0-aarch64.dmg"
        );
        assert_eq!(
            AssetKind::MacDmg.asset_name("0.2.0-beta.1", "x86_64"),
            "FDE-0.2.0-beta.1-x86_64.dmg"
        );
    }

    #[test]
    fn detects_nsis_install_by_uninstaller() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_nsis_install_dir(dir.path()));
        std::fs::write(dir.path().join("uninstall.exe"), b"MZ").unwrap();
        assert!(is_nsis_install_dir(dir.path()));
    }

    #[test]
    fn detect_reports_this_host() {
        let context = InstallContext::detect();
        assert_eq!(context.os, current_os());
        assert!(["aarch64", "x86_64"].contains(&current_arch()));
    }
}
