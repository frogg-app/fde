#[path = "../../packages/branding/native/build.rs"]
mod branding_build;
fn main() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    branding_build::prepare(root);
}
