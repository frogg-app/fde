//! Shared Cargo build input preparation. Node is a build dependency only.
use std::{env, fs, path::PathBuf, process::Command};

pub fn prepare(root: PathBuf) -> PathBuf {
    println!("cargo:rerun-if-env-changed=FDE_BRAND_DIR");
    println!("cargo:rerun-if-env-changed=FDE_EMBED_DAEMON_ARCHIVE");
    for input in [
        "package.json",
        "deploy",
        "brands",
        "scripts/dev/branding",
        "scripts/dev/brand.mts",
        "packages/branding/src",
        "packages/branding/native",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(input).display());
    }
    if let Ok(selected) = env::var("FDE_BRAND_DIR") {
        let selected = PathBuf::from(selected);
        println!(
            "cargo:rerun-if-changed={}",
            if selected.is_absolute() {
                selected
            } else {
                root.join(selected)
            }
            .display()
        );
    }
    let output = Command::new("node")
        .args(["--import", "tsx", "scripts/dev/brand.mts", "prepare"])
        .current_dir(&root)
        .output()
        .expect("Brand preparation needs Node and npm ci in the source checkout");
    assert!(
        output.status.success(),
        "Brand preparation failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let generated = root.join(".generated/branding");
    let destination = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo OUT_DIR"));
    fs::copy(generated.join("brand.rs"), destination.join("brand.rs"))
        .expect("Prepared Rust branding");
    for name in [
        "install.sh",
        "uninstall.sh",
        "install-docker.sh",
        "uninstall-docker.sh",
        "probe.sh",
    ] {
        fs::copy(
            generated.join("scripts").join(name),
            PathBuf::from(env::var("OUT_DIR").unwrap()).join(name),
        )
        .expect("generated installer script");
    }
    generated
}
