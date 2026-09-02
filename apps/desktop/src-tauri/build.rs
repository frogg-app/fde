fn main() {
    println!("cargo:rerun-if-changed=bridge.js");
    tauri_build::build()
}
