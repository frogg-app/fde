#!/usr/bin/env bash
# FDE daemon installer for Linux and macOS hosts.
#
#   installer="$(mktemp)" && curl -fsSL https://frogg.app/install.sh -o "${installer}" && bash "${installer}"; rm -f "${installer}"
#
# Installs a self-contained daemon bundle (Node runtime + daemon + CLI) into a
# versioned directory, links `fde` and `paseo` into a bin directory, and
# registers a systemd user service (Linux) or launchd agent (macOS) that keeps
# the daemon running. The service inherits the PATH of the shell that ran the
# installer, so agent CLIs visible here are visible to the daemon.
# Non-interactive and idempotent: re-running upgrades in place and restarts
# the service. Later upgrades can also run on the host itself with
# `fde daemon self-update` (or from a connected client), which uses the same
# layout: versions/<v>, the `current` link, and the `previous` marker it
# rolls back to when a new version fails to come up.
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
#   FDE_NO_MODIFY_PATH=1  leave shell startup files unchanged
#   FDE_LISTEN        daemon listen address for the service (default: 0.0.0.0:9999)
#   FDE_HOME          daemon state directory for the service (default: ~/.fde)
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
BRAND_ARTIFACT_PREFIX='FDE'
BRAND_LEGACY_ARTIFACT_CUTOFF='0.2.16'
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
FDE_RELEASE_BASE="${FDE_RELEASE_BASE:-${BRAND_RELEASE_BASE}}"
FDE_LISTEN="${FDE_LISTEN:-0.0.0.0:${BRAND_PORT}}"
FDE_VERSION="${FDE_VERSION:-}"
FDE_BUNDLE_FILE="${FDE_BUNDLE_FILE:-}"
FDE_BUNDLE_URL="${FDE_BUNDLE_URL:-}"
FDE_NO_SERVICE="${FDE_NO_SERVICE:-0}"
FDE_NO_MODIFY_PATH="${FDE_NO_MODIFY_PATH:-0}"
FDE_HOME="${FDE_HOME:-}"

SERVICE_NAME="${BRAND_SERVICE}"
LAUNCHD_LABEL="${BRAND_LAUNCHD}"

log() { printf '[%s] %s\n' "${BRAND_CLI}" "$*"; }
die() { printf '[%s] error: %s\n' "${BRAND_CLI}" "$*" >&2; exit 1; }

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

# Newest release including pre-releases, from the GitHub API. Needed because
# every 0.x release is published as a pre-release and `/releases/latest`
# skips those, redirecting to the releases index instead of a tag.
resolve_latest_prerelease_version() {
  local api tag
  api="$(printf '%s' "${FDE_RELEASE_BASE}" |
    sed -n 's#^https://github.com/\([^/]*\)/\([^/]*\)/releases/*$#https://api.github.com/repos/\1/\2/releases?per_page=1#p')"
  [ -n "${api}" ] || die "could not resolve the latest release from ${FDE_RELEASE_BASE}/latest"
  local body
  body="$(curl -fsSL "${api}")" || die "could not resolve the latest release from ${api}"
  tag="$(printf '%s\n' "${body}" | tr ',{' '\n\n' |
    sed -n 's/^ *"tag_name" *: *"\([^"]*\)" *$/\1/p' | sed -n '1p')"
  FDE_VERSION="${tag#v}"
  [ -n "${FDE_VERSION}" ] || die "could not parse a version from ${api}"
}

resolve_latest_version() {
  [ -n "${FDE_RELEASE_BASE}" ] || die "No release source configured; supply ${BRAND_ENV_PREFIX}_BUNDLE_FILE or ${BRAND_ENV_PREFIX}_BUNDLE_URL"
  need curl
  local effective candidate
  effective="$(curl -fsSL -o /dev/null -w '%{url_effective}' "${FDE_RELEASE_BASE}/latest")" ||
    die "could not resolve the latest release from ${FDE_RELEASE_BASE}/latest"
  candidate="${effective##*/}"
  candidate="${candidate#v}"
  case "${candidate}" in
    [0-9]*)
      FDE_VERSION="${candidate}"
      return
      ;;
  esac
  resolve_latest_prerelease_version
}

# Sets BUNDLE_PATH to a verified tarball, downloading it when needed.
# Historical FDE releases use the old filenames; new releases also publish aliases
# so existing installations can update without changing their download contract.
brand_legacy_artifact_version() {
  [[ "$1" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)([-+]|$) ]] || return 1
  local major=$((10#${BASH_REMATCH[1]})) minor=$((10#${BASH_REMATCH[2]})) patch=$((10#${BASH_REMATCH[3]}))
  local cutoff_major cutoff_minor cutoff_patch
  IFS=. read -r cutoff_major cutoff_minor cutoff_patch <<< "$BRAND_LEGACY_ARTIFACT_CUTOFF"
  (( major < cutoff_major || (major == cutoff_major && minor < cutoff_minor) ||
     (major == cutoff_major && minor == cutoff_minor && patch < cutoff_patch) ))
}

acquire_bundle() {
  local name public_platform public_arch
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
    name="${BRAND_DAEMON_PREFIX}-${FDE_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
    if [ "$BRAND_LEGACY" = true ] && ! brand_legacy_artifact_version "$FDE_VERSION"; then
      public_platform="$PLATFORM"
      public_arch="$ARCH"
      [ "$public_platform" = "darwin" ] && public_platform="mac"
      [ "$public_arch" = "x64" ] && public_arch="x86_64"
      name="${BRAND_ARTIFACT_PREFIX}-${FDE_VERSION}-${public_platform}-${public_arch}-daemon.tar.gz"
    fi
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
  # Only the bundle's top-level manifest.json: the web UI ships its own PWA manifest.json deeper
  # in the tree, and a wildcard match would pick that one up.
  local manifest_entry
  manifest_entry="$(tar -tzf "${BUNDLE_PATH}" | grep -E '^[^/]+/manifest\.json$' | head -n1)"
  [ -n "${manifest_entry}" ] || die "bundle has no top-level manifest.json"
  manifest="$(tar -xzOf "${BUNDLE_PATH}" "${manifest_entry}")"
  BUNDLE_VERSION="$(printf '%s' "${manifest}" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n1)"
  [[ "${BUNDLE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$ ]] || die "bundle manifest has no valid version"
  local bundle_target
  bundle_target="$(printf '%s' "${manifest}" | sed -n 's/.*"platform": *"\([^"]*\)".*/\1/p' | head -n1)-$(printf '%s' "${manifest}" | sed -n 's/.*"arch": *"\([^"]*\)".*/\1/p' | head -n1)"
  [ "${bundle_target}" = "${PLATFORM}-${ARCH}" ] || die "bundle is for ${bundle_target}, this host is ${PLATFORM}-${ARCH}"
}

install_bundle() {
  local versions_dir target staging
  versions_dir="${FDE_INSTALL_DIR}/versions"
  target="${versions_dir}/${BUNDLE_VERSION}"
  mkdir -p "${versions_dir}" "${FDE_BIN_DIR}"

  if [ -x "${target}/bin/${BRAND_CLI}" ] && [ -f "${target}/manifest.json" ]; then
    validate_bundle_identity "${target}"
    log "version ${BUNDLE_VERSION} already present at ${target}"
  else
    staging="$(mktemp -d "${versions_dir}/.staging.${BUNDLE_VERSION}.XXXXXX")"
    tar -xzf "${BUNDLE_PATH}" --strip-components=1 -C "${staging}"
    [ -x "${staging}/bin/${BRAND_CLI}" ] || die "bundle is missing bin/fde"
    validate_bundle_identity "${staging}"
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

  # The rollback target for `${BRAND_CLI} daemon self-update`; only changes on a real
  # version switch so a re-run never points previous at the current version.
  if [ -n "${PREVIOUS_VERSION}" ] && [ "${PREVIOUS_VERSION}" != "${BUNDLE_VERSION}" ]; then
    printf '%s\n' "${PREVIOUS_VERSION}" > "${FDE_INSTALL_DIR}/previous"
  fi

  for name in "${BRAND_COMMANDS[@]}"; do
    if [ -e "${FDE_BIN_DIR}/${name}" ] || [ -L "${FDE_BIN_DIR}/${name}" ]; then
      [ "$(readlink "${FDE_BIN_DIR}/${name}" 2>/dev/null || true)" = "${FDE_INSTALL_DIR}/current/bin/${name}" ] || die "command ${name} already belongs to another installation"
    fi
    ln -sfn "${FDE_INSTALL_DIR}/current/bin/${name}" "${FDE_BIN_DIR}/${name}"
    log "linked ${FDE_BIN_DIR}/${name}"
  done
  printf '%s:%s\n' "${BRAND_ID}" "${BRAND_APPLICATION_ID}" > "${FDE_INSTALL_DIR}/.brand-identity"

}

prune_old_versions() {
  local dir name
  for dir in "${FDE_INSTALL_DIR}"/versions/*/; do
    [ -d "${dir}" ] || continue
    name="$(basename "${dir}")"
    if [ "${name}" != "${BUNDLE_VERSION}" ] && [ "${name}" != "${PREVIOUS_VERSION}" ]; then
      validate_bundle_identity "${dir}"
      rm -rf "${dir}"
      log "removed old version ${name}"
    fi
  done
}

systemd_quote() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')"; }
xml() { printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }
write_systemd_unit() {
  local unit_dir unit
  unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
  unit="${unit_dir}/${SERVICE_NAME}.service"
  if [ -f "${unit}" ] && ! grep -Fq "${FDE_INSTALL_DIR}/current" "${unit}"; then die "service belongs to another installation"; fi
  mkdir -p "${unit_dir}"
  cat > "${unit}" <<EOF
[Unit]
Description=${BRAND_NAME} daemon (${BRAND_FULL_NAME})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(systemd_quote "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}") daemon start --foreground
Environment=PASEO_LISTEN=${FDE_LISTEN}
Environment=PASEO_WEB_UI_ENABLED=true
Environment=$(systemd_quote "PATH=${FDE_BIN_DIR}:${PATH}")
Environment=$(systemd_quote "${BRAND_ENV_PREFIX}_INSTALL_DIR=${FDE_INSTALL_DIR}")
${FDE_HOME:+Environment=$(systemd_quote "${BRAND_ENV_PREFIX}_HOME=${FDE_HOME}")}
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
    start_detached_daemon
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

start_detached_daemon() {
  local log_dir
  log_dir="${FDE_INSTALL_DIR}/logs"
  mkdir -p "${log_dir}"
  if [ -n "${FDE_HOME}" ]; then
    nohup env PASEO_LISTEN="${FDE_LISTEN}" PASEO_WEB_UI_ENABLED=true FDE_INSTALL_DIR="${FDE_INSTALL_DIR}" "${BRAND_ENV_PREFIX}_HOME=${FDE_HOME}" \
      "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon start --foreground >> "${log_dir}/fallback-daemon.log" 2>&1 < /dev/null &
  else
    nohup env PASEO_LISTEN="${FDE_LISTEN}" PASEO_WEB_UI_ENABLED=true FDE_INSTALL_DIR="${FDE_INSTALL_DIR}" \
      "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon start --foreground >> "${log_dir}/fallback-daemon.log" 2>&1 < /dev/null &
  fi
  log "started the daemon for this login; its fallback log is ${log_dir}/fallback-daemon.log"
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
    <string>$(xml "${FDE_INSTALL_DIR}/current/bin/${BRAND_CLI}")</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PASEO_LISTEN</key><string>${FDE_LISTEN}</string>
    <key>PASEO_WEB_UI_ENABLED</key><string>true</string>
    <key>PATH</key><string>$(xml "${FDE_BIN_DIR}:${PATH}")</string>
    <key>FDE_INSTALL_DIR</key><string>$(xml "${FDE_INSTALL_DIR}")</string>
${FDE_HOME:+    <key>${BRAND_ENV_PREFIX}_HOME</key><string>$(xml "${FDE_HOME}")</string>}
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

# Keep this inline: install.sh also runs standalone through curl | bash.
configure_shell_path() {
  local shell_name quoted_bin path_line file login_file
  local files=()
  # Single quotes protect custom paths from expansion when the shell starts.
  quoted_bin="'$(printf '%s' "${FDE_BIN_DIR}" | sed "s/'/'\\\\''/g")'"
  path_line="case \":\${PATH}:\" in *:${quoted_bin}:*) ;; *) export PATH=${quoted_bin}:\"\${PATH}\" ;; esac"
  shell_name="${SHELL:-}"
  shell_name="${shell_name##*/}"
  PATH_COMMAND="export PATH=${quoted_bin}:\"\$PATH\""
  case "${shell_name}" in
    bash)
      files=("${HOME}/.bashrc")
      # Bash reads only the first existing login profile.
      login_file="${HOME}/.profile"
      for file in "${HOME}/.bash_profile" "${HOME}/.bash_login"; do
        if [ -f "${file}" ]; then login_file="${file}"; break; fi
      done
      files+=("${login_file}")
      ;;
    zsh) files=("${ZDOTDIR:-${HOME}}/.zshrc" "${ZDOTDIR:-${HOME}}/.zprofile") ;;
    fish)
      # Fish single quotes also interpret backslashes, unlike POSIX shells.
      quoted_bin="'$(printf '%s' "${FDE_BIN_DIR}" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g")'"
      path_line="contains -- ${quoted_bin} \$PATH; or set -gx PATH ${quoted_bin} \$PATH"
      PATH_COMMAND="${path_line}"
      files=("${XDG_CONFIG_HOME:-${HOME}/.config}/fish/config.fish")
      ;;
    sh|dash|ksh) files=("${HOME}/.profile") ;;
    *) log "shell ${SHELL:-unknown} is not supported for automatic PATH setup"; return ;;
  esac
  [ "${FDE_NO_MODIFY_PATH}" != "1" ] || return 0
  for file in "${files[@]}"; do
    if [ -f "${file}" ] && grep -Fqx -- "${path_line}" "${file}"; then continue; fi
    if mkdir -p "$(dirname "${file}")" && printf '\n# FDE CLI\n%s\n' "${path_line}" >> "${file}"; then
      log "configured PATH in ${file}"
    else
      log "could not update ${file}; configure PATH manually"
    fi
  done
}

print_next_steps() {
  local host port
  host="${FDE_LISTEN%:*}"
  port="${FDE_LISTEN##*:}"
  echo
  log "${BRAND_NAME} daemon ${BUNDLE_VERSION} installed."
  if [ "${FDE_NO_SERVICE}" = "1" ]; then
    log "no service installed; start the daemon with: ${BRAND_CLI} daemon start --listen ${FDE_LISTEN} --web-ui"
  else
    if [ "${host}" = "127.0.0.1" ] || [ "${host}" = "localhost" ]; then
      log "web UI: http://${host}:${port}/"
      log "the daemon listens on loopback; reach it through an SSH tunnel or re-run with FDE_LISTEN=0.0.0.0:${port}"
    else
      if [ "${host}" = "0.0.0.0" ] || [ "${host}" = "::" ]; then
        log "web UI: http://<this-hosts-network-address>:${port}/"
      else
        log "web UI: http://${host}:${port}/"
      fi
      log "the daemon is network-reachable; set a password with: ${BRAND_CLI} daemon set-password"
    fi
  fi
  log "pair a client:     ${BRAND_CLI} daemon pair"
  log "check status:      ${BRAND_CLI} daemon status"
  log "update later:      ${BRAND_CLI} daemon self-update   (rolls back by itself if the new version fails)"
  case ":${PATH}:" in
    *":${FDE_BIN_DIR}:"*) ;;
    *)
      log "to use ${BRAND_CLI} in this terminal, run:"
      log "  ${PATH_COMMAND}"
      ;;
  esac
}

main() {
  need tar
  need uname
  detect_platform
  validate_install_owner
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
  configure_shell_path

  if [ "${FDE_NO_SERVICE}" != "1" ]; then
    case "${PLATFORM}" in
      linux) install_systemd_service ;;
      darwin) install_launchd_agent ;;
    esac
  fi
  print_next_steps
}

main "$@"
