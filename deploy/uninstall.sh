#!/usr/bin/env bash
# Removes an FDE daemon installation made by deploy/install.sh: stops and
# unregisters the service, removes the bin links and the install directory.
# Daemon state under ~/.paseo is kept unless FDE_PURGE=1.
#
# Environment overrides mirror install.sh: FDE_INSTALL_DIR, FDE_BIN_DIR,
# FDE_HOME (daemon state directory; default ~/.paseo).
set -euo pipefail

FDE_INSTALL_DIR="${FDE_INSTALL_DIR:-${HOME}/.local/share/fde}"
FDE_BIN_DIR="${FDE_BIN_DIR:-${HOME}/.local/bin}"
FDE_HOME="${FDE_HOME:-${PASEO_HOME:-${HOME}/.paseo}}"
FDE_PURGE="${FDE_PURGE:-0}"

SERVICE_NAME="fde-daemon"
LAUNCHD_LABEL="de.frogg.fde-daemon"

log() { printf '[fde] %s\n' "$*"; }

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
  if [ -x "${FDE_INSTALL_DIR}/current/bin/fde" ]; then
    "${FDE_INSTALL_DIR}/current/bin/fde" daemon stop --home "${FDE_HOME}" >/dev/null 2>&1 || true
  fi
}

main() {
  case "$(uname -s)" in
    Linux) remove_systemd_service ;;
    Darwin) remove_launchd_agent ;;
  esac
  stop_daemon

  for name in fde paseo; do
    if [ -L "${FDE_BIN_DIR}/${name}" ]; then
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
  log "FDE uninstalled"
}

main "$@"
