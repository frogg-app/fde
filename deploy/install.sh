#!/usr/bin/env bash
# FDE daemon installer for Linux and macOS hosts.
#
#   curl -fsSL https://frogg.de/install.sh | bash
#
# Installs a self-contained daemon bundle (Node runtime + daemon + CLI) into a
# versioned directory, links `fde` and `paseo` into a bin directory, and
# registers a systemd user service (Linux) or launchd agent (macOS) that keeps
# the daemon running. The service inherits the PATH of the shell that ran the
# installer, so agent CLIs visible here are visible to the daemon.
# Non-interactive and idempotent: re-running upgrades in place and restarts
# the service.
#
# Environment overrides:
#   FDE_VERSION       release to install (default: latest GitHub release)
#   FDE_INSTALL_DIR   install root (default: ~/.local/share/fde)
#   FDE_BIN_DIR       where fde/paseo are linked (default: ~/.local/bin)
#   FDE_RELEASE_BASE  release download base (default: GitHub releases)
#   FDE_BUNDLE_URL    download this exact bundle URL (plus its .sha256 sidecar)
#                     instead of resolving one from FDE_RELEASE_BASE
#   FDE_BUNDLE_FILE   install from a local bundle tarball instead of downloading
#   FDE_NO_SERVICE=1  skip service installation
#   FDE_LISTEN        daemon listen address for the service (default: 127.0.0.1:6767)
#   FDE_HOME          daemon state directory for the service (default: ~/.paseo)
set -euo pipefail

FDE_INSTALL_DIR="${FDE_INSTALL_DIR:-${HOME}/.local/share/fde}"
FDE_BIN_DIR="${FDE_BIN_DIR:-${HOME}/.local/bin}"
FDE_RELEASE_BASE="${FDE_RELEASE_BASE:-https://github.com/frogg-app/frogg-de/releases}"
FDE_LISTEN="${FDE_LISTEN:-127.0.0.1:6767}"
FDE_VERSION="${FDE_VERSION:-}"
FDE_BUNDLE_FILE="${FDE_BUNDLE_FILE:-}"
FDE_BUNDLE_URL="${FDE_BUNDLE_URL:-}"
FDE_NO_SERVICE="${FDE_NO_SERVICE:-0}"
FDE_HOME="${FDE_HOME:-}"

SERVICE_NAME="fde-daemon"
LAUNCHD_LABEL="de.frogg.fde-daemon"

log() { printf '[fde] %s\n' "$*"; }
die() { printf '[fde] error: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

detect_platform() {
  case "$(uname -s)" in
    Linux) PLATFORM=linux ;;
    Darwin) PLATFORM=darwin ;;
    *) die "unsupported operating system: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) die "unsupported architecture: $(uname -m)" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

resolve_latest_version() {
  need curl
  local effective
  effective="$(curl -fsSL -o /dev/null -w '%{url_effective}' "${FDE_RELEASE_BASE}/latest")" ||
    die "could not resolve the latest release from ${FDE_RELEASE_BASE}/latest"
  FDE_VERSION="${effective##*/}"
  FDE_VERSION="${FDE_VERSION#v}"
  [ -n "${FDE_VERSION}" ] || die "could not parse a version from ${effective}"
}

# Sets BUNDLE_PATH to a verified tarball, downloading it when needed.
acquire_bundle() {
  local name
  if [ -n "${FDE_BUNDLE_FILE}" ]; then
    [ -f "${FDE_BUNDLE_FILE}" ] || die "FDE_BUNDLE_FILE does not exist: ${FDE_BUNDLE_FILE}"
    BUNDLE_PATH="${FDE_BUNDLE_FILE}"
    if [ -f "${FDE_BUNDLE_FILE}.sha256" ]; then
      verify_bundle "${BUNDLE_PATH}" "${FDE_BUNDLE_FILE}.sha256"
    fi
    return
  fi

  need curl
  local url
  if [ -n "${FDE_BUNDLE_URL}" ]; then
    url="${FDE_BUNDLE_URL}"
    name="${url##*/}"
  else
    [ -n "${FDE_VERSION}" ] || resolve_latest_version
    name="fde-daemon-${FDE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
    url="${FDE_RELEASE_BASE}/download/v${FDE_VERSION}/${name}"
  fi
  BUNDLE_PATH="${WORK_DIR}/${name}"
  log "downloading ${name}"
  curl -fsSL --retry 3 -o "${BUNDLE_PATH}" "${url}" || die "download failed: ${url}"
  curl -fsSL --retry 3 -o "${BUNDLE_PATH}.sha256" "${url}.sha256" ||
    die "checksum download failed for ${name}"
  verify_bundle "${BUNDLE_PATH}" "${BUNDLE_PATH}.sha256"
}

verify_bundle() {
  local expected actual
  expected="$(awk 'NR==1 {print $1}' "$2")"
  actual="$(sha256_of "$1")"
  [ "${expected}" = "${actual}" ] || die "checksum mismatch for $1 (expected ${expected}, got ${actual})"
  log "checksum verified"
}

# Reads the bundle version from its manifest so FDE_BUNDLE_FILE installs land
# in the right versioned directory.
read_bundle_version() {
  local manifest
  manifest="$(tar -xzOf "${BUNDLE_PATH}" --wildcards '*/manifest.json' 2>/dev/null || tar -xzOf "${BUNDLE_PATH}" '*/manifest.json')"
  BUNDLE_VERSION="$(printf '%s' "${manifest}" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "${BUNDLE_VERSION}" ] || die "bundle manifest has no version"
  local bundle_target
  bundle_target="$(printf '%s' "${manifest}" | sed -n 's/.*"platform": *"\([^"]*\)".*/\1/p' | head -n1)-$(printf '%s' "${manifest}" | sed -n 's/.*"arch": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ "${bundle_target}" = "${PLATFORM}-${ARCH}" ] || die "bundle is for ${bundle_target}, this host is ${PLATFORM}-${ARCH}"
}

install_bundle() {
  local versions_dir target staging
  versions_dir="${FDE_INSTALL_DIR}/versions"
  target="${versions_dir}/${BUNDLE_VERSION}"
  mkdir -p "${versions_dir}" "${FDE_BIN_DIR}"

  if [ -x "${target}/bin/fde" ] && [ -f "${target}/manifest.json" ]; then
    log "version ${BUNDLE_VERSION} already present at ${target}"
  else
    staging="$(mktemp -d "${versions_dir}/.staging.${BUNDLE_VERSION}.XXXXXX")"
    tar -xzf "${BUNDLE_PATH}" --strip-components=1 -C "${staging}"
    [ -x "${staging}/bin/fde" ] || die "bundle is missing bin/fde"
    rm -rf "${target}"
    mv "${staging}" "${target}"
    log "installed version ${BUNDLE_VERSION} to ${target}"
  fi

  # Atomic `current` swap: rename a fresh symlink over the old one.
  ln -sfn "versions/${BUNDLE_VERSION}" "${FDE_INSTALL_DIR}/current.new"
  if mv -T "${FDE_INSTALL_DIR}/current.new" "${FDE_INSTALL_DIR}/current" 2>/dev/null; then
    :
  else
    rm -f "${FDE_INSTALL_DIR}/current.new"
    ln -sfn "versions/${BUNDLE_VERSION}" "${FDE_INSTALL_DIR}/current"
  fi

  ln -sfn "${FDE_INSTALL_DIR}/current/bin/fde" "${FDE_BIN_DIR}/fde"
  ln -sfn "${FDE_INSTALL_DIR}/current/bin/paseo" "${FDE_BIN_DIR}/paseo"
  log "linked ${FDE_BIN_DIR}/fde and ${FDE_BIN_DIR}/paseo"
}

prune_old_versions() {
  local dir name
  for dir in "${FDE_INSTALL_DIR}"/versions/*/; do
    [ -d "${dir}" ] || continue
    name="$(basename "${dir}")"
    if [ "${name}" != "${BUNDLE_VERSION}" ] && [ "${name}" != "${PREVIOUS_VERSION}" ]; then
      rm -rf "${dir}"
      log "removed old version ${name}"
    fi
  done
}

write_systemd_unit() {
  local unit_dir unit
  unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
  unit="${unit_dir}/${SERVICE_NAME}.service"
  mkdir -p "${unit_dir}"
  cat > "${unit}" <<EOF
[Unit]
Description=FDE daemon (Frogg Development Environment)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${FDE_INSTALL_DIR}/current/bin/fde daemon start --foreground
Environment=PASEO_LISTEN=${FDE_LISTEN}
Environment=PASEO_WEB_UI_ENABLED=true
Environment=PATH=${FDE_BIN_DIR}:${PATH}
${FDE_HOME:+Environment=PASEO_HOME=${FDE_HOME}}
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
  log "wrote ${unit}"
}

install_systemd_service() {
  write_systemd_unit
  if ! systemctl --user daemon-reload >/dev/null 2>&1; then
    log "systemctl --user is not available in this session; enable the service later with:"
    log "  systemctl --user enable --now ${SERVICE_NAME}"
    return
  fi
  systemctl --user enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
  if systemctl --user is-active --quiet "${SERVICE_NAME}"; then
    systemctl --user restart "${SERVICE_NAME}"
    log "restarted ${SERVICE_NAME} (systemd user service)"
  else
    systemctl --user start "${SERVICE_NAME}"
    log "started ${SERVICE_NAME} (systemd user service)"
  fi
  if [ "$(id -u)" != "0" ]; then
    log "to keep the daemon running after logout: sudo loginctl enable-linger $(id -un)"
  fi
}

write_launchd_plist() {
  local plist log_dir
  plist="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
  log_dir="${FDE_INSTALL_DIR}/logs"
  mkdir -p "${HOME}/Library/LaunchAgents" "${log_dir}"
  cat > "${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${FDE_INSTALL_DIR}/current/bin/fde</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PASEO_LISTEN</key><string>${FDE_LISTEN}</string>
    <key>PASEO_WEB_UI_ENABLED</key><string>true</string>
    <key>PATH</key><string>${FDE_BIN_DIR}:${PATH}</string>
${FDE_HOME:+    <key>PASEO_HOME</key><string>${FDE_HOME}</string>}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log_dir}/launchd.log</string>
  <key>StandardErrorPath</key><string>${log_dir}/launchd.log</string>
</dict>
</plist>
EOF
  log "wrote ${plist}"
  LAUNCHD_PLIST="${plist}"
}

install_launchd_agent() {
  write_launchd_plist
  local domain
  domain="gui/$(id -u)"
  launchctl bootout "${domain}" "${LAUNCHD_PLIST}" >/dev/null 2>&1 || true
  launchctl bootstrap "${domain}" "${LAUNCHD_PLIST}" || die "launchctl bootstrap failed"
  log "started ${LAUNCHD_LABEL} (launchd agent)"
}

print_next_steps() {
  local host port
  host="${FDE_LISTEN%:*}"
  port="${FDE_LISTEN##*:}"
  echo
  log "FDE daemon ${BUNDLE_VERSION} installed."
  if [ "${FDE_NO_SERVICE}" = "1" ]; then
    log "no service installed; start the daemon with: fde daemon start --listen ${FDE_LISTEN} --web-ui"
  else
    log "web UI: http://${host}:${port}/"
    if [ "${host}" = "127.0.0.1" ] || [ "${host}" = "localhost" ]; then
      log "the daemon listens on loopback; reach it through an SSH tunnel or re-run with FDE_LISTEN=0.0.0.0:${port}"
    else
      log "the daemon is network-reachable; set a password with: fde daemon set-password"
    fi
  fi
  log "pair a client:     fde daemon pair"
  log "check status:      fde daemon status"
  case ":${PATH}:" in
    *":${FDE_BIN_DIR}:"*) ;;
    *) log "add ${FDE_BIN_DIR} to your PATH to use fde directly" ;;
  esac
}

main() {
  need tar
  need uname
  detect_platform
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/fde-install.XXXXXX")"
  trap 'rm -rf "${WORK_DIR}"' EXIT

  PREVIOUS_VERSION=""
  if [ -L "${FDE_INSTALL_DIR}/current" ]; then
    PREVIOUS_VERSION="$(basename "$(readlink "${FDE_INSTALL_DIR}/current")")"
  fi

  acquire_bundle
  read_bundle_version
  install_bundle
  prune_old_versions

  if [ "${FDE_NO_SERVICE}" != "1" ]; then
    case "${PLATFORM}" in
      linux) install_systemd_service ;;
      darwin) install_launchd_agent ;;
    esac
  fi
  print_next_steps
}

main "$@"
