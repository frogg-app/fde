//! Desktop-managed attachment storage under the app data dir. Mirrors
//! Electron's `features/attachments.ts`: ids are `[A-Za-z0-9_-]+`, extensions
//! are `.[a-z0-9]{1,16}`, and reads/deletes must stay inside the directory.

use std::fs;
use std::path::{Component, Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};

pub const DIRNAME: &str = "desktop-attachments";

pub struct AttachmentStore {
    dir: PathBuf,
}

fn is_valid_id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}

fn normalize_id(value: Option<&Value>) -> Result<String, String> {
    let Some(raw) = value.and_then(Value::as_str) else {
        return Err("Attachment id is required.".into());
    };
    let id = raw.trim();
    if id.is_empty() || !id.chars().all(is_valid_id_char) {
        return Err(format!("Invalid attachment id: {raw}"));
    }
    Ok(id.to_string())
}

fn normalize_extension(value: Option<&Value>) -> Result<String, String> {
    let raw = match value {
        None | Some(Value::Null) => return Ok(".bin".into()),
        Some(Value::String(s)) if s.is_empty() => return Ok(".bin".into()),
        Some(Value::String(s)) => s,
        Some(_) => return Err("Attachment extension must be a string.".into()),
    };
    let lowered = raw.trim().to_ascii_lowercase();
    let extension = if lowered.starts_with('.') { lowered } else { format!(".{lowered}") };
    let body = &extension[1..];
    if body.is_empty() || body.len() > 16 || !body.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("Invalid attachment extension: {raw}"));
    }
    Ok(extension)
}

/// Lexical `path.resolve`: absolute, with `.` and `..` folded (no symlink resolution).
fn resolve_lexically(input: &Path) -> PathBuf {
    let absolute = if input.is_absolute() {
        input.to_path_buf()
    } else {
        std::env::current_dir().map(|cwd| cwd.join(input)).unwrap_or_else(|_| input.to_path_buf())
    };
    let mut resolved = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

fn file_result(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(json!({ "path": path.to_string_lossy(), "byteSize": metadata.len() }))
}

fn bytes_from_value(value: Option<&Value>) -> Result<Vec<u8>, String> {
    let to_byte = |v: &Value| v.as_u64().filter(|n| *n <= 255).map(|n| n as u8);
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| to_byte(item).ok_or_else(|| "Attachment byte payload is required.".to_string()))
            .collect(),
        // `JSON.stringify(new Uint8Array(...))` yields `{"0":..,"1":..}`.
        Some(Value::Object(map)) => {
            let mut indexed: Vec<(usize, u8)> = map
                .iter()
                .map(|(key, item)| {
                    let index = key.parse::<usize>().map_err(|_| "Attachment byte payload is required.".to_string())?;
                    let byte = to_byte(item).ok_or_else(|| "Attachment byte payload is required.".to_string())?;
                    Ok((index, byte))
                })
                .collect::<Result<_, String>>()?;
            indexed.sort_by_key(|(index, _)| *index);
            Ok(indexed.into_iter().map(|(_, byte)| byte).collect())
        }
        _ => Err("Attachment byte payload is required.".into()),
    }
}

impl AttachmentStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn ensure_dir(&self) -> Result<&Path, String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        Ok(&self.dir)
    }

    fn managed_path(&self, args: &Value) -> Result<PathBuf, String> {
        let dir = self.ensure_dir()?;
        let id = normalize_id(args.get("attachmentId"))?;
        let extension = normalize_extension(args.get("extension"))?;
        Ok(dir.join(format!("{id}{extension}")))
    }

    fn resolve_managed_path(&self, value: Option<&Value>) -> Result<PathBuf, String> {
        let raw = value.and_then(Value::as_str).map(str::trim).unwrap_or_default();
        if raw.is_empty() {
            return Err("Attachment path is required.".into());
        }
        let dir = resolve_lexically(&self.dir);
        let resolved = resolve_lexically(Path::new(raw));
        if resolved == dir || !resolved.starts_with(&dir) {
            return Err("Attachment path must stay within desktop-managed storage.".into());
        }
        Ok(resolved)
    }

    pub fn write_base64(&self, args: &Value) -> Result<Value, String> {
        let base64 = args.get("base64").and_then(Value::as_str).map(str::trim).unwrap_or_default();
        if base64.is_empty() {
            return Err("Attachment base64 payload is required.".into());
        }
        let bytes = BASE64.decode(base64).map_err(|e| format!("Invalid base64 payload: {e}"))?;
        let target = self.managed_path(args)?;
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
        file_result(&target)
    }

    pub fn write_bytes(&self, args: &Value) -> Result<Value, String> {
        let bytes = bytes_from_value(args.get("bytes"))?;
        let target = self.managed_path(args)?;
        fs::write(&target, bytes).map_err(|e| e.to_string())?;
        file_result(&target)
    }

    pub fn copy_file(&self, args: &Value) -> Result<Value, String> {
        let source = args.get("sourcePath").and_then(Value::as_str).map(str::trim).unwrap_or_default();
        if source.is_empty() {
            return Err("Attachment source path is required.".into());
        }
        let source = resolve_lexically(Path::new(source));
        let target = self.managed_path(args)?;
        if source != target {
            fs::copy(&source, &target).map_err(|e| e.to_string())?;
        }
        file_result(&target)
    }

    pub fn read_base64(&self, args: &Value) -> Result<Value, String> {
        let path = self.resolve_managed_path(args.get("path"))?;
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        Ok(Value::String(BASE64.encode(bytes)))
    }

    pub fn delete_file(&self, args: &Value) -> Result<Value, String> {
        let path = self.resolve_managed_path(args.get("path"))?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(json!(true)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!(true)),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn garbage_collect(&self, args: &Value) -> Result<Value, String> {
        let dir = self.ensure_dir()?;
        let referenced: Vec<String> = args
            .get("referencedIds")
            .and_then(Value::as_array)
            .map(|ids| {
                ids.iter()
                    .filter_map(Value::as_str)
                    .map(str::trim)
                    .filter(|id| !id.is_empty() && id.chars().all(is_valid_id_char))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        let mut deleted = 0u64;
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            if referenced.iter().any(|id| *id == stem) {
                continue;
            }
            fs::remove_file(&path).map_err(|e| e.to_string())?;
            deleted += 1;
        }
        Ok(json!(deleted))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, AttachmentStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = AttachmentStore::new(dir.path().join(DIRNAME));
        (dir, store)
    }

    #[test]
    fn writes_base64_and_reads_it_back() {
        let (_dir, store) = store();
        let result = store
            .write_base64(&json!({ "attachmentId": "abc-1", "base64": BASE64.encode(b"hello"), "extension": "PNG" }))
            .unwrap();
        let path = result["path"].as_str().unwrap();
        assert!(path.ends_with("abc-1.png"));
        assert_eq!(result["byteSize"], 5);
        let read = store.read_base64(&json!({ "path": path })).unwrap();
        assert_eq!(read, Value::String(BASE64.encode(b"hello")));
        assert_eq!(store.delete_file(&json!({ "path": path })).unwrap(), json!(true));
        assert!(!Path::new(path).exists());
        assert_eq!(store.delete_file(&json!({ "path": path })).unwrap(), json!(true), "delete is idempotent");
    }

    #[test]
    fn writes_bytes_from_array_and_from_object_form() {
        let (_dir, store) = store();
        let array = store.write_bytes(&json!({ "attachmentId": "a", "bytes": [1, 2, 3] })).unwrap();
        assert_eq!(array["byteSize"], 3);
        assert!(array["path"].as_str().unwrap().ends_with("a.bin"));
        let object = store
            .write_bytes(&json!({ "attachmentId": "b", "bytes": { "1": 9, "0": 8 }, "extension": ".jpg" }))
            .unwrap();
        assert_eq!(fs::read(object["path"].as_str().unwrap()).unwrap(), vec![8, 9]);
        assert!(store.write_bytes(&json!({ "attachmentId": "c", "bytes": "nope" })).is_err());
        assert!(store.write_bytes(&json!({ "attachmentId": "c", "bytes": [300] })).is_err());
    }

    #[test]
    fn rejects_ids_that_could_escape_the_directory() {
        let (_dir, store) = store();
        for bad in ["../x", "a/b", "..", "a b", "", " ", "a\\b", "c:x"] {
            let error = store
                .write_bytes(&json!({ "attachmentId": bad, "bytes": [1] }))
                .expect_err(&format!("id {bad:?} must be rejected"));
            assert!(error.contains("attachment id"), "{error}");
        }
        assert!(store.write_bytes(&json!({ "bytes": [1] })).is_err());
        assert!(store.write_bytes(&json!({ "attachmentId": 5, "bytes": [1] })).is_err());
    }

    #[test]
    fn rejects_bad_extensions() {
        let (_dir, store) = store();
        for bad in ["../png", "a.b", "png/", "abcdefghijklmnopq"] {
            assert!(store.write_bytes(&json!({ "attachmentId": "a", "bytes": [1], "extension": bad })).is_err());
        }
        assert!(store.write_bytes(&json!({ "attachmentId": "a", "bytes": [1], "extension": 3 })).is_err());
        let ok = store.write_bytes(&json!({ "attachmentId": "a", "bytes": [1], "extension": null })).unwrap();
        assert!(ok["path"].as_str().unwrap().ends_with("a.bin"));
    }

    #[test]
    fn reads_and_deletes_only_inside_managed_storage() {
        let (dir, store) = store();
        let outside = dir.path().join("secret.txt");
        fs::write(&outside, b"secret").unwrap();
        store.ensure_dir().unwrap();

        let escape = store.dir.join("..").join("secret.txt");
        assert!(store.read_base64(&json!({ "path": escape.to_string_lossy() })).is_err());
        assert!(store.read_base64(&json!({ "path": outside.to_string_lossy() })).is_err());
        assert!(store.delete_file(&json!({ "path": outside.to_string_lossy() })).is_err());
        assert!(store.delete_file(&json!({ "path": store.dir.to_string_lossy() })).is_err());
        assert!(store.read_base64(&json!({ "path": "" })).is_err());
        assert!(store.read_base64(&json!({})).is_err());

        // A sibling directory sharing the prefix is outside too.
        let sibling = dir.path().join(format!("{DIRNAME}-other")).join("x.bin");
        fs::create_dir_all(sibling.parent().unwrap()).unwrap();
        fs::write(&sibling, b"x").unwrap();
        assert!(store.read_base64(&json!({ "path": sibling.to_string_lossy() })).is_err());
        assert!(outside.exists() && sibling.exists());
    }

    #[test]
    fn copies_files_into_managed_storage() {
        let (dir, store) = store();
        let source = dir.path().join("source.txt");
        fs::write(&source, b"copy me").unwrap();
        let result = store
            .copy_file(&json!({ "attachmentId": "copied", "sourcePath": source.to_string_lossy(), "extension": "txt" }))
            .unwrap();
        assert_eq!(result["byteSize"], 7);
        assert!(source.exists());
        assert!(store.copy_file(&json!({ "attachmentId": "copied" })).is_err());
    }

    #[test]
    fn garbage_collect_keeps_referenced_ids() {
        let (_dir, store) = store();
        store.write_bytes(&json!({ "attachmentId": "keep", "bytes": [1], "extension": "png" })).unwrap();
        store.write_bytes(&json!({ "attachmentId": "drop", "bytes": [1] })).unwrap();
        store.write_bytes(&json!({ "attachmentId": "drop2", "bytes": [1], "extension": "jpg" })).unwrap();
        fs::create_dir_all(store.dir.join("subdir")).unwrap();
        let deleted = store.garbage_collect(&json!({ "referencedIds": ["keep", "../keep", 5] })).unwrap();
        assert_eq!(deleted, json!(2));
        assert!(store.dir.join("keep.png").exists());
        assert!(!store.dir.join("drop.bin").exists());
        assert!(store.dir.join("subdir").exists());
        assert_eq!(store.garbage_collect(&json!({})).unwrap(), json!(1));
    }
}
