//! The deploy scripts, embedded at build time from `deploy/` at the repo
//! root so the app ships exactly the scripts the docs describe. Each one is
//! piped into `bash -s` on the remote host; nothing is copied there first.

pub const INSTALL_SH: &str = include_str!(concat!(env!("OUT_DIR"), "/install.sh"));
pub const INSTALL_DOCKER_SH: &str = include_str!(concat!(env!("OUT_DIR"), "/install-docker.sh"));
pub const UNINSTALL_SH: &str = include_str!(concat!(env!("OUT_DIR"), "/uninstall.sh"));

/// The Docker path has no uninstall script in `deploy/`: removing the
/// container is the whole job, and the state directory is kept like
/// `uninstall.sh` keeps `~/.frogg`.
pub const UNINSTALL_DOCKER_SH: &str =
    include_str!(concat!(env!("OUT_DIR"), "/uninstall-docker.sh"));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_scripts_are_the_bash_installers() {
        for script in [
            INSTALL_SH,
            INSTALL_DOCKER_SH,
            UNINSTALL_SH,
            UNINSTALL_DOCKER_SH,
        ] {
            assert!(script.starts_with("#!/usr/bin/env bash\n"));
        }
        assert!(INSTALL_SH.contains("FROGG_BUNDLE_URL"));
        assert!(INSTALL_SH.contains("FROGG_RELEASE_BASE"));
        assert!(INSTALL_SH.contains("FROGG_LISTEN"));
        assert!(INSTALL_DOCKER_SH.contains("FROGG_BIND"));
        assert!(INSTALL_DOCKER_SH.contains("FROGG_PORT"));
    }
}
