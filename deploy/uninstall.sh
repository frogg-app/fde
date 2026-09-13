#!/usr/bin/env bash
# Removes a Frogg daemon installation made by deploy/install.sh: stops and
# unregisters the service, removes the bin links and the install directory.
# Daemon state under ~/.frogg is kept unless FROGG_PURGE=1.
#
# Environment overrides mirror install.sh: FROGG_INSTALL_DIR, FROGG_BIN_DIR,
# FROGG_HOME (daemon state directory; default ~/.frogg).
set -euo pipefail

# BEGIN BRAND DEFAULTS — replaced only in generated distribution scripts.
BRAND_ID='frogg'
BRAND_NAME='Frogg'
BRAND_FULL_NAME='Frogg'
BRAND_APPLICATION_ID='app.frogg.frogg'
BRAND_ENV_PREFIX='Frogg'
BRAND_CLI='frogg'
BRAND_HOME='.frogg'
BRAND_SERVICE='frogg-daemon'
BRAND_LAUNCHD='app.frogg.frogg-daemon'
BRAND_DAEMON_PREFIX='frogg-daemon'
BRAND_PORT='9999'
BRAND_RELEASE_BASE='https://github.com/frogg-app/frogg/releases'
BRAND_DOCKER_IMAGE='froggapp/frogg'
BRAND_LEGACY='true'
BRAND_COMMANDS=(frogg frogg)
# END BRAND DEFAULTS

# Environment names inside this script remain implementation details. Only the
# selected product's public overrides are imported for a custom distribution.
if [ "${BRAND_LEGACY}" != "true" ]; then
  for suffix in INSTALL_DIR BIN_DIR RELEASE_BASE LISTEN VERSION BUNDLE_FILE BUNDLE_URL NO_SERVICE NO_MODIFY_PATH HOME PURGE IMAGE PORT BIND WORKSPACE PASSWORD CONTAINER NO_PULL UPDATE HEALTH_TIMEOUT; do
    key="${BRAND_ENV_PREFIX}_${suffix}"
    printf -v "FROGG_${suffix}" '%s' "${!key-}"
  done
fi

FROGG_INSTALL_DIR="${FROGG_INSTALL_DIR:-${HOME}/.local/share/${BRAND_ID}}"
FROGG_BIN_DIR="${FROGG_BIN_DIR:-${HOME}/.local/bin}"
if [ "${BRAND_LEGACY}" = "true" ]; then FROGG_HOME="${FROGG_HOME:-${FROGG_HOME:-${HOME}/${BRAND_HOME}}}"; else FROGG_HOME="${FROGG_HOME:-${HOME}/${BRAND_HOME}}"; fi
FROGG_PURGE="${FROGG_PURGE:-0}"

SERVICE_NAME="${BRAND_SERVICE}"
LAUNCHD_LABEL="${BRAND_LAUNCHD}"

log() { printf '[%s] %s\n' "${BRAND_CLI}" "$*"; }

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

validate_install_owner() {
  if [ -f "${FROGG_INSTALL_DIR}/.brand-identity" ]; then
    [ "$(cat "${FROGG_INSTALL_DIR}/.brand-identity")" = "${BRAND_ID}:${BRAND_APPLICATION_ID}" ] || die "install directory belongs to another product"
  elif [ -e "${FROGG_INSTALL_DIR}/current/manifest.json" ]; then
    validate_bundle_identity "${FROGG_INSTALL_DIR}/current"
  elif [ "${BRAND_LEGACY}" != "true" ] && [ -d "${FROGG_INSTALL_DIR}" ] && [ -n "$(ls -A "${FROGG_INSTALL_DIR}")" ]; then
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
  if [ -x "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}" ]; then
    "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon stop --home "${FROGG_HOME}" >/dev/null 2>&1 || true
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
    if [ -L "${FROGG_BIN_DIR}/${name}" ] && [ "$(readlink "${FROGG_BIN_DIR}/${name}")" = "${FROGG_INSTALL_DIR}/current/bin/${name}" ]; then
      rm -f "${FROGG_BIN_DIR}/${name}"
      log "removed ${FROGG_BIN_DIR}/${name}"
    fi
  done

  if [ -d "${FROGG_INSTALL_DIR}" ]; then
    rm -rf "${FROGG_INSTALL_DIR}"
    log "removed ${FROGG_INSTALL_DIR}"
  fi

  if [ "${FROGG_PURGE}" = "1" ] && [ -d "${FROGG_HOME}" ]; then
    rm -rf "${FROGG_HOME}"
    log "removed daemon state ${FROGG_HOME}"
  else
    log "daemon state in ${FROGG_HOME} was kept (set FROGG_PURGE=1 to remove it)"
  fi
  log "${BRAND_NAME} uninstalled"
}

main "$@"
