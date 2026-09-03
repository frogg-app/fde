//! Bundle archive extraction (`.tar.gz` on unix, `.zip` on Windows) into a
//! directory, dropping the archive's single top-level directory the way
//! `tar --strip-components=1` does. Every entry path is checked before it
//! touches the filesystem: no absolute paths, no `..`, no drive prefixes.
//!
//! [`extract_zip_preserving_paths`] is the exception: the Windows release zips
//! are not sidecar bundles and keep their own layout (see its doc comment).

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

/// Maps an archive entry name to a relative path under the extraction root,
/// with the first component removed. `None` means "skip" (the top-level
/// directory entry itself); `Err` means the archive is hostile.
pub fn stripped_relative_path(entry: &str) -> Result<Option<PathBuf>, String> {
    let parts = checked_parts(entry)?;
    if parts.len() < 2 {
        return Ok(None);
    }
    Ok(Some(parts[1..].iter().collect()))
}

/// Like [`stripped_relative_path`] but keeps the first component, so an entry at
/// the archive root is a file to write rather than the directory to drop. `None`
/// means "skip" (a bare directory entry).
pub fn checked_relative_path(entry: &str) -> Result<Option<PathBuf>, String> {
    let parts = checked_parts(entry)?;
    if parts.is_empty() {
        return Ok(None);
    }
    Ok(Some(parts.iter().collect()))
}

/// The entry's path components, rejecting anything that could escape the
/// extraction root: absolute paths, `..`, drive prefixes.
fn checked_parts(entry: &str) -> Result<Vec<std::ffi::OsString>, String> {
    let normalized = entry.replace('\\', "/");
    let mut parts = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_os_string()),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!("archive entry has an absolute path: {entry}"));
            }
            Component::ParentDir => {
                return Err(format!(
                    "archive entry escapes the bundle directory: {entry}"
                ));
            }
        }
    }
    if parts
        .iter()
        .any(|part| part.to_string_lossy().contains(':'))
    {
        return Err(format!("archive entry has a drive prefix: {entry}"));
    }
    Ok(parts)
}

fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("open {}: {e}", archive.display()))?;
    let decoder = flate2::read::GzDecoder::new(io::BufReader::new(file));
    let mut tar = tar::Archive::new(decoder);
    tar.set_preserve_permissions(true);
    tar.set_unpack_xattrs(false);
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        let Some(relative) = stripped_relative_path(&name)? else {
            continue;
        };
        let target = destination.join(&relative);
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            // Bundles link only inside themselves (npm workspaces); a link
            // pointing outside would escape the directory.
            let link = entry
                .link_name()
                .map_err(|e| e.to_string())?
                .ok_or("link without target")?;
            let link = link.to_string_lossy().into_owned();
            let resolved = relative.parent().unwrap_or(Path::new("")).join(&link);
            if resolved.components().fold(0i32, |depth, c| match c {
                Component::Normal(_) => depth + 1,
                Component::ParentDir => depth - 1,
                _ => depth,
            }) < 0
                || Path::new(&link).is_absolute()
            {
                return Err(format!(
                    "archive link escapes the bundle directory: {name} -> {link}"
                ));
            }
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry
            .unpack(&target)
            .map_err(|e| format!("unpack {name}: {e}"))?;
    }
    Ok(())
}

fn extract_zip(archive: &Path, destination: &Path, strip_top_level: bool) -> Result<(), String> {
    let file = File::open(archive).map_err(|e| format!("open {}: {e}", archive.display()))?;
    let mut zip = zip::ZipArchive::new(io::BufReader::new(file)).map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let relative = if strip_top_level {
            stripped_relative_path(&name)?
        } else {
            checked_relative_path(&name)?
        };
        let Some(relative) = relative else {
            continue;
        };
        let target = destination.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out =
            File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        io::copy(&mut entry, &mut out).map_err(|e| format!("unpack {name}: {e}"))?;
    }
    Ok(())
}

/// Extracts `archive` into `destination` (created if missing). The format is
/// chosen by extension.
pub fn extract_bundle(archive: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let name = archive.to_string_lossy();
    if name.ends_with(".zip") {
        extract_zip(archive, destination, true)
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        extract_tar_gz(archive, destination)
    } else {
        Err(format!("unsupported bundle archive: {name}"))
    }
}

/// Extracts a zip into `destination` keeping every entry path as the archive
/// has it. The Windows release zips are not sidecar bundles: the installer zip
/// holds `FDE-<v>-x64-setup.exe` at the root, because that is the only layout
/// `tauri-plugin-updater` finds an installer in, so stripping the first
/// component the way [`extract_bundle`] does would drop the file. Entry paths
/// are checked exactly as strictly.
pub fn extract_zip_preserving_paths(archive: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    extract_zip(archive, destination, false)
}

/// Reads a whole file; used by tests and the checksum step.
#[allow(dead_code)]
pub fn read_all(path: &Path) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    File::open(path)?.read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::Write;

    pub(crate) fn make_tar_gz(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for (name, data) in entries {
            // The name is written into the header bytes directly so tests
            // can build hostile entries (`..`) the builder API refuses.
            let mut header = tar::Header::new_gnu();
            let gnu = header.as_gnu_mut().unwrap();
            gnu.name[..name.len()].copy_from_slice(name.as_bytes());
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
    }

    pub(crate) fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap();
    }

    #[test]
    fn keeps_root_entries_when_paths_are_preserved() {
        assert_eq!(
            checked_relative_path("setup.exe").unwrap(),
            Some(PathBuf::from("setup.exe"))
        );
        assert_eq!(
            checked_relative_path("folder/setup.exe").unwrap(),
            Some(PathBuf::from("folder/setup.exe"))
        );
        assert_eq!(checked_relative_path("./").unwrap(), None);
        // A root-level file is dropped by the bundle rule, which is why the
        // Windows zips use the preserving extractor.
        assert_eq!(stripped_relative_path("setup.exe").unwrap(), None);
        assert!(checked_relative_path("../escape.exe").is_err());
        assert!(checked_relative_path("/abs.exe").is_err());
        assert!(checked_relative_path("C:/drive.exe").is_err());

        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("setup.zip");
        make_zip(&archive, &[("FDE-x64-setup.exe", b"MZ")]);
        let out = dir.path().join("out");
        extract_zip_preserving_paths(&archive, &out).unwrap();
        assert_eq!(std::fs::read(out.join("FDE-x64-setup.exe")).unwrap(), b"MZ");
    }

    #[test]
    fn strips_top_level_and_rejects_escapes() {
        assert_eq!(
            stripped_relative_path("bundle/bin/fde").unwrap(),
            Some(PathBuf::from("bin/fde"))
        );
        assert_eq!(stripped_relative_path("bundle/").unwrap(), None);
        assert_eq!(
            stripped_relative_path("./bundle/./a").unwrap(),
            Some(PathBuf::from("a"))
        );
        assert_eq!(
            stripped_relative_path("bundle\\bin\\fde.cmd").unwrap(),
            Some(PathBuf::from("bin/fde.cmd"))
        );
        assert!(stripped_relative_path("bundle/../etc/passwd").is_err());
        assert!(stripped_relative_path("../bundle/x").is_err());
        assert!(stripped_relative_path("/etc/passwd").is_err());
        assert!(stripped_relative_path("bundle/C:/x").is_err());
    }

    #[test]
    fn extracts_tar_gz_with_stripped_root() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("b.tar.gz");
        make_tar_gz(
            &archive,
            &[("b/manifest.json", b"{}"), ("b/bin/fde", b"#!/bin/sh\n")],
        );
        let out = dir.path().join("out");
        extract_bundle(&archive, &out).unwrap();
        assert_eq!(fs::read(out.join("manifest.json")).unwrap(), b"{}");
        assert!(out.join("bin/fde").is_file());
    }

    #[test]
    fn extracts_zip_with_stripped_root() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("b.zip");
        make_zip(
            &archive,
            &[
                ("b/manifest.json", b"{}"),
                ("b/bin/fde.cmd", b"@echo off\r\n"),
            ],
        );
        let out = dir.path().join("out");
        extract_bundle(&archive, &out).unwrap();
        assert!(out.join("manifest.json").is_file());
        assert!(out.join("bin/fde.cmd").is_file());
    }

    #[test]
    fn rejects_traversal_entries_in_both_formats() {
        let dir = tempfile::tempdir().unwrap();
        let tarball = dir.path().join("evil.tar.gz");
        make_tar_gz(&tarball, &[("b/../../evil.txt", b"x")]);
        let error = extract_bundle(&tarball, &dir.path().join("out1")).unwrap_err();
        assert!(error.contains("escapes"), "{error}");
        assert!(!dir.path().join("evil.txt").exists());

        let zipfile = dir.path().join("evil.zip");
        make_zip(&zipfile, &[("b/ok.txt", b"x"), ("/abs.txt", b"x")]);
        let error = extract_bundle(&zipfile, &dir.path().join("out2")).unwrap_err();
        assert!(error.contains("absolute"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_pointing_outside() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("link.tar.gz");
        let file = File::create(&archive).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(tar::EntryType::Symlink);
        header.set_size(0);
        header.set_cksum();
        builder
            .append_link(&mut header, "b/node_modules/x", "../../../outside")
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap();
        let error = extract_bundle(&archive, &dir.path().join("out")).unwrap_err();
        assert!(error.contains("link escapes"), "{error}");
    }
}
