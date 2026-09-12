#[path = "../../../packages/branding/native/build.rs"]
mod branding_build;
fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap();
    let generated = branding_build::prepare(root);
    let mut overlay: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(generated.join("tauri.conf.json")).unwrap())
            .unwrap();
    // Preserve command-line build overrides, but never permit an identity mismatch.
    if let Ok(extra) = std::env::var("TAURI_CONFIG") {
        let extra: serde_json::Value = serde_json::from_str(&extra).expect("TAURI_CONFIG JSON");
        if let Some(id) = extra.get("identifier") {
            assert_eq!(
                id, &overlay["identifier"],
                "Tauri configuration and selected brand differ"
            );
        }
        merge(&mut overlay, extra);
    }
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
