//! An owned launcher follows the sidecar's current marker across upgrades.
use crate::{
    branding,
    sidecar::{bundle::BundleStore, Sidecar},
};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

fn bin_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(if cfg!(windows) {
        app.path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("bin")
    } else {
        home.join(".local/bin")
    })
}
fn command_path(dir: &Path) -> PathBuf {
    dir.join(format!(
        "{}{}",
        branding::CLI_NAME,
        if cfg!(windows) { ".cmd" } else { "" }
    ))
}
fn owner() -> String {
    format!("distribution:{}", branding::APPLICATION_ID)
}
fn owned(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|s| s.is_file() && !s.file_type().is_symlink())
        && fs::read_to_string(path)
            .is_ok_and(|s| s.lines().take(2).any(|line| line.ends_with(&owner())))
}
fn write_owned(path: &Path, content: &str) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok() && !owned(path) {
        return Err(format!(
            "Cannot replace an existing command owned by another installation: {}",
            path.display()
        ));
    }
    fs::create_dir_all(path.parent().ok_or("CLI path has no parent")?)
        .map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn sh(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn ps(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn install_to(store: &BundleStore, dir: &Path, home: &Path) -> Result<PathBuf, String> {
    store
        .installed()
        .ok_or("Install the local daemon bundle before installing the CLI.")?;
    let command = command_path(dir);
    let root = store.root().to_string_lossy();
    let marker = owner();
    if cfg!(windows) {
        let script = command.with_extension("ps1");
        if fs::symlink_metadata(&command).is_ok() && !owned(&command) {
            return Err(format!(
                "Cannot replace existing command: {}",
                command.display()
            ));
        }
        let content = format!(
            r#"# {marker}
$ErrorActionPreference = 'Stop'
$root = {root}
$version = (Get-Content -LiteralPath (Join-Path $root 'current') -Raw).Trim()
if ($version -notmatch '^[0-9][0-9A-Za-z.+-]*$') {{ throw 'Invalid daemon version marker' }}
$bundle = Join-Path $root $version
$manifest = Get-Content -LiteralPath (Join-Path $bundle 'manifest.json') -Raw | ConvertFrom-Json
if (-not (( $manifest.brand.id -eq {id} -and $manifest.brand.applicationId -eq {app_id}) -or ({legacy} -and -not $manifest.brand))) {{ throw 'Daemon bundle belongs to another product' }}
[Environment]::SetEnvironmentVariable({home_key}, {home}, 'Process')
& (Join-Path $bundle 'node/node.exe') (Join-Path $bundle 'daemon/apps/cli/dist/index.js') @args
exit $LASTEXITCODE
"#,
            legacy = if branding::LEGACY_FDE {
                "$true"
            } else {
                "$false"
            },
            root = ps(&root),
            id = ps(branding::ID),
            app_id = ps(branding::APPLICATION_ID),
            home_key = ps(&branding::env_key("HOME")),
            home = ps(&home.to_string_lossy())
        );
        write_owned(&script, &content)?;
        // %~dp0 resolves beside the launcher, including paths containing spaces.
        write_owned(&command, &format!("@rem {marker}\r\n@powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0{}.ps1\" %*\r\n@exit /b %errorlevel%\r\n", branding::CLI_NAME))?;
    } else {
        let bootstrap = dir.join(format!(".{}-desktop-cli.mjs", branding::CLI_NAME));
        let identity = branding::identity();
        let content = format!(
            r#"// {marker}
import fs from 'node:fs';
import path from 'node:path';
import {{ pathToFileURL }} from 'node:url';
const expected = {identity};
const bundle = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
if (!(manifest.brand?.id === expected.id && manifest.brand?.applicationId === expected.applicationId) && !({legacy} && !manifest.brand)) throw new Error('Daemon bundle belongs to another product');
const entry = path.join(bundle, 'daemon/apps/cli/dist/index.js');
process.argv = [process.execPath, entry, ...process.argv.slice(3)];
await import(pathToFileURL(entry).href);
"#,
            legacy = branding::LEGACY_FDE
        );
        if fs::symlink_metadata(&command).is_ok() && !owned(&command) {
            return Err(format!(
                "Cannot replace existing command: {}",
                command.display()
            ));
        }
        write_owned(&bootstrap, &content)?;
        write_owned(
            &command,
            &format!(
                r#"#!/usr/bin/env bash
# {marker}
set -euo pipefail
root={root}
version=$(cat "$root/current")
[[ "$version" =~ ^[0-9][0-9A-Za-z.+-]*$ ]] || {{ echo 'Invalid daemon version marker' >&2; exit 1; }}
export {home_key}={home}
exec "$root/$version/node/bin/node" {bootstrap} "$root/$version" "$@"
"#,
                root = sh(&root),
                home_key = branding::env_key("HOME"),
                home = sh(&home.to_string_lossy()),
                bootstrap = sh(&bootstrap.to_string_lossy())
            ),
        )?;
    }
    Ok(command)
}
pub fn status<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let command = command_path(&bin_dir(app)?);
    Ok(json!({ "installed": owned(&command), "path": command }))
}
pub fn install<R: Runtime>(app: &AppHandle<R>) -> Result<Value, String> {
    let dir = bin_dir(app)?;
    let sidecar = app.state::<Sidecar>();
    let command = install_to(&sidecar.store, &dir, &crate::sidecar::fde_home(app))?;
    #[cfg(windows)]
    {
        let script = format!("$dir={}; $p=[Environment]::GetEnvironmentVariable('Path','User'); if (($p -split ';') -notcontains $dir) {{ [Environment]::SetEnvironmentVariable('Path',($p.TrimEnd(';')+';'+$dir),'User') }}", ps(&dir.to_string_lossy()));
        let result = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &script])
            .status()
            .map_err(|e| e.to_string())?;
        if !result.success() {
            return Err(format!(
                "CLI installed at {}, but adding its directory to PATH failed",
                command.display()
            ));
        }
    }
    Ok(json!({ "installed": true, "path": command }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::bundle::write_fake_bundle;
    #[test]
    fn installs_owned_launcher_and_refuses_another_command() {
        let temp = tempfile::tempdir().unwrap();
        let store = BundleStore::new(temp.path().join("app data"));
        let bin = temp.path().join("bin dir");
        assert!(install_to(&store, &bin, temp.path()).is_err());
        write_fake_bundle(&store.version_dir("1.2.3"), "1.2.3");
        store.set_current("1.2.3").unwrap();
        let command = install_to(&store, &bin, temp.path()).unwrap();
        assert!(owned(&command));
        assert!(install_to(&store, &bin, temp.path()).is_ok());
        fs::write(&command, "another product").unwrap();
        assert!(install_to(&store, &bin, temp.path()).is_err());
        assert_eq!(fs::read_to_string(command).unwrap(), "another product");
    }
}
