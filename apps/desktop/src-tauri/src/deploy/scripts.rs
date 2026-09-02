//! The deploy scripts, embedded at build time from `deploy/` at the repo
//! root so the app ships exactly the scripts the docs describe. Each one is
//! piped into `bash -s` on the remote host; nothing is copied there first.

pub const INSTALL_SH: &str = include_str!("../../../../../deploy/install.sh");
pub const INSTALL_DOCKER_SH: &str = include_str!("../../../../../deploy/install-docker.sh");
pub const UNINSTALL_SH: &str = include_str!("../../../../../deploy/uninstall.sh");

/// The Docker path has no uninstall script in `deploy/`: removing the
/// container is the whole job, and the state directory is kept like
/// `uninstall.sh` keeps `~/.paseo`.
pub const UNINSTALL_DOCKER_SH: &str = r#"#!/usr/bin/env bash
set -euo pipefail
FDE_CONTAINER="${FDE_CONTAINER:-fde-daemon}"
log() { printf '[fde] %s\n' "$*"; }
command -v docker >/dev/null 2>&1 || { log "docker is not installed"; exit 1; }
if docker container inspect "${FDE_CONTAINER}" >/dev/null 2>&1; then
  docker rm -f "${FDE_CONTAINER}" >/dev/null
  log "removed container ${FDE_CONTAINER}"
else
  log "no container named ${FDE_CONTAINER}"
fi
log "daemon state in ${FDE_HOME:-${HOME}/.fde} was kept"
log "FDE container uninstalled"
"#;

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
        assert!(INSTALL_SH.contains("FDE_BUNDLE_URL"));
        assert!(INSTALL_SH.contains("FDE_RELEASE_BASE"));
        assert!(INSTALL_SH.contains("FDE_LISTEN"));
        assert!(INSTALL_DOCKER_SH.contains("FDE_BIND"));
        assert!(INSTALL_DOCKER_SH.contains("FDE_PORT"));
    }
}
