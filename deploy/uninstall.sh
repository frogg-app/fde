#!/usr/bin/env bash
# Removes an FDE daemon installation made by deploy/install.sh: stops and
# unregisters the service, removes the bin links and the install directory.
# Daemon state under ~/.fde is kept unless FDE_PURGE=1.
#
# Environment overrides mirror install.sh: FDE_INSTALL_DIR, FDE_BIN_DIR,
# FDE_HOME (daemon state directory; default ~/.fde).
set -euo pipefail

# BEGIN BRAND DEFAULTS — replaced only in generated distribution scripts.
BRAND_ID='fde'
BRAND_NAME='FDE'
BRAND_FULL_NAME='Frogg Development Environment'
BRAND_APPLICATION_ID='app.frogg.fde'
BRAND_ENV_PREFIX='FDE'
BRAND_CLI='fde'
BRAND_HOME='.fde'
BRAND_SERVICE='fde-daemon'
BRAND_LAUNCHD='app.frogg.fde-daemon'
BRAND_DAEMON_PREFIX='fde-daemon'
BRAND_PORT='9999'
BRAND_RELEASE_BASE='https://github.com/frogg-app/fde/releases'
BRAND_DOCKER_IMAGE='froggapp/fde'
BRAND_LEGACY='true'
BRAND_COMMANDS=(fde paseo)
# END BRAND DEFAULTS

# Environment names inside this script remain implementation details. Only the
# selected product's public overrides are imported for a custom distribution.
if [ "${BRAND_LEGACY}" != "true" ]; then
  for suffix in INSTALL_DIR BIN_DIR RELEASE_BASE LISTEN VERSION BUNDLE_FILE BUNDLE_URL NO_SERVICE NO_MODIFY_PATH HOME PURGE IMAGE PORT BIND WORKSPACE PASSWORD CONTAINER NO_PULL UPDATE HEALTH_TIMEOUT; do
    key="${BRAND_ENV_PREFIX}_${suffix}"
    printf -v "FDE_${suffix}" '%s' "${!key-}"
  done
fi

FDE_INSTALL_DIR="${FDE_INSTALL_DIR:-${HOME}/.local/share/${BRAND_ID}}"
FDE_BIN_DIR="${FDE_BIN_DIR:-${HOME}/.local/bin}"
if [ "${BRAND_LEGACY}" = "true" ]; then FDE_HOME="${FDE_HOME:-${PASEO_HOME:-${HOME}/${BRAND_HOME}}}"; else FDE_HOME="${FDE_HOME:-${HOME}/${BRAND_HOME}}"; fi
FDE_PURGE="${FDE_PURGE:-0}"

SERVICE_NAME="${BRAND_SERVICE}"
LAUNCHD_LABEL="${BRAND_LAUNCHD}"

log() { printf '[%s] %s\n' "${BRAND_CLI}" "$*"; }

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

validate_install_owner() {
  if [ -f "${FDE_INSTALL_DIR}/.brand-identity" ]; then
    [ "$(cat "${FDE_INSTALL_DIR}/.brand-identity")" = "${BRAND_ID}:${BRAND_APPLICATION_ID}" ] || die "install directory belongs to another product"
  elif [ -e "${FDE_INSTALL_DIR}/current/manifest.json" ]; then
    validate_bundle_identity "${FDE_INSTALL_DIR}/current"
  elif [ "${BRAND_LEGACY}" != "true" ] && [ -d "${FDE_INSTALL_DIR}" ] && [ -n "$(ls -A "${FDE_INSTALL_DIR}")" ]; then
    die "install directory has no product ownership metadata"
  fi
}
validate_bundle_identity() {
  local bundle="$1"
  [ -x "${bundle}/node/bin/node" ] || die "bundle has no Node runtime for identity validation"
  "${bundle}/node/bin/node" - "${bundle}/manifest.json" "${BRAND_ID}" "${BRAND_APPLICATION_ID}" "${BRAND_LEGACY}" <<'JS'
const fs = require('node:fs');
const [file, id, applicationId, legacy] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
if (metadata.brand ? metadata.brand.id !== id || metadata.brand.applicationId !== applicationId : legacy !== 'true') {
  console.error('Bundle belongs to another product'); process.exit(1);
}
JS
}

remove_systemd_service() {
  local unit="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user/${SERVICE_NAME}.service"
  if systemctl --user list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    systemctl --user disable --now "${SERVICE_NAME}" >/dev/null 2>&1 || true
  fi
  if [ -f "${unit}" ]; then
    rm -f "${unit}"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    log "removed ${unit}"
  fi
}

remove_launchd_agent() {
  local plist="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
  if [ -f "${plist}" ]; then
    launchctl bootout "gui/$(id -u)" "${plist}" >/dev/null 2>&1 || true
    rm -f "${plist}"
    log "removed ${plist}"
  fi
}

stop_daemon() {
  if [ -x "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}" ]; then
    "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon stop --home "${FDE_HOME}" >/dev/null 2>&1 || true
  fi
}

main() {
  validate_install_owner
  case "$(uname -s)" in
    Linux) remove_systemd_service ;;
    Darwin) remove_launchd_agent ;;
  esac
  stop_daemon

  for name in "${BRAND_COMMANDS[@]}"; do
    if [ -L "${FDE_BIN_DIR}/${name}" ] && [ "$(readlink "${FDE_BIN_DIR}/${name}")" = "${FDE_INSTALL_DIR}/current/bin/${name}" ]; then
      rm -f "${FDE_BIN_DIR}/${name}"
      log "removed ${FDE_BIN_DIR}/${name}"
    fi
  done

  if [ -d "${FDE_INSTALL_DIR}" ]; then
    rm -rf "${FDE_INSTALL_DIR}"
    log "removed ${FDE_INSTALL_DIR}"
  fi

  if [ "${FDE_PURGE}" = "1" ] && [ -d "${FDE_HOME}" ]; then
    rm -rf "${FDE_HOME}"
    log "removed daemon state ${FDE_HOME}"
  else
    log "daemon state in ${FDE_HOME} was kept (set FDE_PURGE=1 to remove it)"
  fi
  log "${BRAND_NAME} uninstalled"
}

main "$@"
