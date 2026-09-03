//! Applying a downloaded asset. Every path returns an `InstallOutcome` the
//! webview shows and logs what it did to `fde.log`.
//!
//! - Windows installer: a detached `cmd` helper waits for this process to exit,
//!   runs `FDE-<v>-x64-setup.exe /S` (per-user NSIS, no elevation) and starts
//!   the app again; the shell exits right after answering the command.
//! - Windows portable: the same helper `move /Y`s the new exe over the running
//!   one and relaunches it.
//! - Linux AppImage: the new file is copied next to `$APPIMAGE`, made
//!   executable and renamed over it (the running image keeps its old inode
//!   mounted), then relaunched.
//! - Linux deb: opened with `xdg-open`, which hands it to the package installer.
//! - macOS: the DMG is opened; the user drags FDE to Applications. Ad-hoc
//!   signed builds cannot be replaced in place reliably (Gatekeeper
//!   re-quarantines the copy), so this stays manual until code signing lands.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::assets::{AssetKind, InstallContext};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallOutcome {
    pub installed: bool,
    pub restart_required: bool,
    pub detail: String,
    /// The shell should exit once the result reached the webview.
    pub exit_app: bool,
    /// Executable to start right before exiting (AppImage relaunch).
    pub relaunch: Option<PathBuf>,
}

pub fn install(
    kind: AssetKind,
    downloaded: &Path,
    context: &InstallContext,
    helper_dir: &Path,
) -> Result<InstallOutcome, String> {
    let current_exe = std::env::current_exe().map_err(|e| format!("current exe: {e}"))?;
    let pid = std::process::id();
    match kind {
        AssetKind::WindowsInstaller => {
            let script = installer_script(
                &downloaded.to_string_lossy(),
                &current_exe.to_string_lossy(),
                pid,
            );
            run_helper_script(helper_dir, "fde-update-install.cmd", &script)?;
            Ok(InstallOutcome {
                installed: true,
                restart_required: true,
                detail: "Installer started. FDE closes now and reopens when the update has been applied.".into(),
                exit_app: true,
                relaunch: None,
            })
        }
        AssetKind::WindowsPortable => {
            // The portable build ships as a zip (bare exes get blocked by Windows); pull the
            // executable out next to the download and swap that in.
            let new_exe = extract_portable_exe(downloaded)?;
            let script = portable_script(
                &new_exe.to_string_lossy(),
                &current_exe.to_string_lossy(),
                pid,
            );
            run_helper_script(helper_dir, "fde-update-portable.cmd", &script)?;
            Ok(InstallOutcome {
                installed: true,
                restart_required: true,
                detail: "FDE closes now; the new version replaces the executable and starts again."
                    .into(),
                exit_app: true,
                relaunch: None,
            })
        }
        AssetKind::LinuxAppImage => {
            let target = context
                .appimage
                .as_deref()
                .map(PathBuf::from)
                .ok_or("APPIMAGE is not set; cannot locate the running AppImage")?;
            replace_file_in_place(downloaded, &target)?;
            log::info!(
                "updates: replaced {} with the new AppImage",
                target.display()
            );
            Ok(InstallOutcome {
                installed: true,
                restart_required: true,
                detail: format!("Updated {}. FDE restarts now.", target.display()),
                exit_app: true,
                relaunch: Some(target),
            })
        }
        AssetKind::LinuxDeb => {
            open_with("xdg-open", downloaded)?;
            Ok(InstallOutcome {
                installed: true,
                restart_required: true,
                detail: format!(
                    "Opened {} in the package installer. Restart FDE once it finishes.",
                    file_name(downloaded)
                ),
                exit_app: false,
                relaunch: None,
            })
        }
        AssetKind::MacDmg => {
            open_with("open", downloaded)?;
            Ok(InstallOutcome {
                installed: true,
                restart_required: true,
                detail: "Opened the disk image. Drag FDE to Applications to replace the current version, then relaunch it.".into(),
                exit_app: false,
                relaunch: None,
            })
        }
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// `cmd` batch script: wait for `pid` to exit, run the silent installer, start
/// the (upgraded, same-path) executable again.
pub fn installer_script(installer: &str, exe: &str, pid: u32) -> String {
    format!(
        "@echo off\r\n{}start \"\" /wait \"{installer}\" /S\r\nstart \"\" \"{exe}\"\r\n",
        wait_for_pid_block(pid)
    )
}

/// `cmd` batch script: wait for `pid` to exit, replace the exe, relaunch.

/// Extracts the portable zip beside itself and returns the path of the executable inside it.
pub fn extract_portable_exe(archive: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let destination = archive.with_extension("extracted");
    let _ = std::fs::remove_dir_all(&destination);
    crate::sidecar::archive::extract_bundle(archive, &destination)?;
    find_exe(&destination).ok_or_else(|| format!("no .exe found in {}", archive.display()))
}

fn find_exe(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut nested = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            nested.push(path);
        } else if path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("exe"))
            .unwrap_or(false)
        {
            return Some(path);
        }
    }
    nested.into_iter().find_map(|sub| find_exe(&sub))
}

pub fn portable_script(new_exe: &str, target_exe: &str, pid: u32) -> String {
    format!(
        "@echo off\r\n{}move /Y \"{new_exe}\" \"{target_exe}\" || exit /b 1\r\nstart \"\" \"{target_exe}\"\r\n",
        wait_for_pid_block(pid)
    )
}

fn wait_for_pid_block(pid: u32) -> String {
    format!(
        ":wait\r\ntasklist /FI \"PID eq {pid}\" 2>nul | find \" {pid} \" >nul\r\nif not errorlevel 1 (\r\n  timeout /t 1 /nobreak >nul\r\n  goto wait\r\n)\r\n"
    )
}

fn run_helper_script(dir: &Path, name: &str, script: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, script).map_err(|e| format!("write {}: {e}", path.display()))?;
    log::info!("updates: starting helper {}", path.display());
    let mut command = Command::new("cmd");
    command
        .arg("/C")
        .arg(&path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    command
        .spawn()
        .map_err(|e| format!("could not start the update helper: {e}"))?;
    Ok(())
}

/// Copies `source` next to `target`, marks it executable and renames it over
/// `target` so the swap is atomic on the same filesystem.
pub fn replace_file_in_place(source: &Path, target: &Path) -> Result<(), String> {
    let dir = target
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", target.display()))?;
    let staged = dir.join(format!(".{}.new-{}", file_name(target), std::process::id()));
    std::fs::copy(source, &staged).map_err(|e| format!("copy to {}: {e}", staged.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("chmod {}: {e}", staged.display()))?;
    }
    if let Err(error) = std::fs::rename(&staged, target) {
        let _ = std::fs::remove_file(&staged);
        return Err(format!("replace {}: {error}", target.display()));
    }
    let _ = std::fs::remove_file(source);
    Ok(())
}

fn open_with(program: &str, path: &Path) -> Result<(), String> {
    log::info!("updates: {program} {}", path.display());
    Command::new(program)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not run {program}: {e}"))?;
    Ok(())
}

/// Starts `path` detached from this process (used right before exiting).
pub fn relaunch(path: &Path) -> Result<(), String> {
    log::info!("updates: relaunching {}", path.display());
    Command::new(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("relaunch {}: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_script_waits_then_runs_silent_setup_and_restarts() {
        let script = installer_script(
            r"C:\cache\FDE-1.0.0-x64-setup.exe",
            r"C:\Apps\FDE\fde.exe",
            4242,
        );
        assert!(script.starts_with("@echo off\r\n:wait\r\n"));
        assert!(script.contains("tasklist /FI \"PID eq 4242\" 2>nul | find \" 4242 \" >nul"));
        assert!(script.contains("goto wait"));
        assert!(script.contains("start \"\" /wait \"C:\\cache\\FDE-1.0.0-x64-setup.exe\" /S\r\n"));
        assert!(script.ends_with("start \"\" \"C:\\Apps\\FDE\\fde.exe\"\r\n"));
        let wait_index = script.find(":wait").unwrap();
        let setup_index = script.find("/S").unwrap();
        assert!(
            wait_index < setup_index,
            "the installer runs only after the app exited"
        );
    }

    #[test]
    fn portable_script_moves_over_the_exe_and_relaunches() {
        let script = portable_script(
            r"C:\cache\FDE-1.0.0-x64-portable.exe",
            r"D:\Tools\fde.exe",
            7,
        );
        assert!(script.contains("find \" 7 \""));
        assert!(script.contains(
            "move /Y \"C:\\cache\\FDE-1.0.0-x64-portable.exe\" \"D:\\Tools\\fde.exe\" || exit /b 1\r\n"
        ));
        assert!(script.ends_with("start \"\" \"D:\\Tools\\fde.exe\"\r\n"));
    }

    #[test]
    fn replaces_file_atomically_and_marks_executable() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("FDE.AppImage");
        let source = dir.path().join("downloads").join("FDE-2.AppImage");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&target, b"old").unwrap();
        std::fs::write(&source, b"new").unwrap();
        replace_file_in_place(&source, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert!(!source.exists(), "the download is consumed");
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            2,
            "no staging file left behind"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&target).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }
        let error = replace_file_in_place(&dir.path().join("missing"), &target).unwrap_err();
        assert!(error.contains("copy to"), "{error}");
        assert_eq!(
            std::fs::read(&target).unwrap(),
            b"new",
            "target untouched on failure"
        );
    }
}
