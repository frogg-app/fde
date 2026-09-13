#[path = "../../../packages/branding/native/build.rs"]
mod branding_build;
fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let generated = branding_build::prepare(root.clone());
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-env-changed=TAURI_ENV_PLATFORM");
    println!(
        "cargo:rerun-if-changed={}",
        root.join("apps/ui/dist/brand-build.json").display()
    );
    let mut overlay: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(generated.join("tauri.conf.json")).unwrap())
            .unwrap();
    let extra = std::env::var("TAURI_CONFIG")
        .map(|value| serde_json::from_str::<serde_json::Value>(&value).expect("TAURI_CONFIG JSON"))
        .unwrap_or(serde_json::json!({}));
    // The CLI reads its configuration before Cargo starts. Child-process environment
    // changes cannot repair an unbranded configuration already loaded by that CLI.
    if std::env::var_os("TAURI_ENV_PLATFORM").is_some() {
        let brand: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(generated.join("brand.json")).unwrap())
                .unwrap();
        assert!(brand["legacyFrogg"] == true || extra["identifier"] == overlay["identifier"],
            "Custom Tauri builds require the prepared overlay. Use npm run build:desktop or npm run dev:desktop.");
    }
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        let stamp = std::fs::read_to_string(root.join("apps/ui/dist/brand-build.json"))
            .ok()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok());
        let fingerprint = std::fs::read_to_string(generated.join("fingerprint")).unwrap();
        assert!(stamp.as_ref().and_then(|s| s["configFingerprint"].as_str()) == Some(fingerprint.trim()),
            "Desktop web assets are missing or belong to another build. Use npm run build:desktop to rebuild them.");
    }
    for key in ["identifier", "productName", "mainBinaryName", "version"] {
        if let Some(value) = extra.get(key) {
            assert_eq!(
                value, &overlay[key],
                "Tauri configuration differs from the selected brand: {key}"
            );
        }
    }
    assert_eq!(
        std::env::var("CARGO_PKG_VERSION").unwrap(),
        overlay["version"].as_str().unwrap(),
        "Native versions differ. Run npm run version:sync-internal."
    );
    merge(&mut overlay, extra);
    let value = serde_json::to_string(&overlay).unwrap();
    std::env::set_var("TAURI_CONFIG", &value);
    println!("cargo:rustc-env=TAURI_CONFIG={value}");
    println!("cargo:rerun-if-changed=bridge.js");
    tauri_build::build()
}
fn merge(target: &mut serde_json::Value, source: serde_json::Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge(
                target.entry(key).or_insert(serde_json::Value::Null),
                value.clone(),
            );
        }
    } else {
        *target = source;
    }
}
