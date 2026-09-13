#!/usr/bin/env bash
# Frogg daemon installer for Linux and macOS hosts.
#
#   installer="$(mktemp)" && curl -fsSL https://frogg.app/install.sh -o "${installer}" && bash "${installer}"; rm -f "${installer}"
#
# Installs a self-contained daemon bundle (Node runtime + daemon + CLI) into a
# versioned directory, links `frogg` and `frogg` into a bin directory, and
# registers a systemd user service (Linux) or launchd agent (macOS) that keeps
# the daemon running. The service inherits the PATH of the shell that ran the
# installer, so agent CLIs visible here are visible to the daemon.
# Non-interactive and idempotent: re-running upgrades in place and restarts
# the service. Later upgrades can also run on the host itself with
# `frogg daemon self-update` (or from a connected client), which uses the same
# layout: versions/<v>, the `current` link, and the `previous` marker it
# rolls back to when a new version fails to come up.
#
# Environment overrides:
#   FROGG_VERSION       release to install (default: latest GitHub release)
#   FROGG_INSTALL_DIR   install root (default: ~/.local/share/frogg)
#   FROGG_BIN_DIR       where frogg/frogg are linked (default: ~/.local/bin)
#   FROGG_RELEASE_BASE  release download base (default: GitHub releases)
#   FROGG_BUNDLE_URL    download this exact bundle URL (plus its .sha256 sidecar)
#                     instead of resolving one from FROGG_RELEASE_BASE
#   FROGG_BUNDLE_FILE   install from a local bundle tarball instead of downloading
#   FROGG_NO_SERVICE=1  skip service installation
#   FROGG_NO_MODIFY_PATH=1  leave shell startup files unchanged
#   FROGG_LISTEN        daemon listen address for the service (default: 0.0.0.0:9999)
#   FROGG_HOME          daemon state directory for the service (default: ~/.frogg)
#   FROGG_HEALTH_TIMEOUT seconds to verify the running version (default: 30)
set -euo pipefail

# BEGIN BRAND DEFAULTS — replaced only in generated distribution scripts.
BRAND_ID='frogg'
BRAND_NAME='Frogg'
BRAND_FULL_NAME='Frogg'
BRAND_APPLICATION_ID='app.frogg.frogg'
BRAND_ENV_PREFIX='FROGG'
BRAND_CLI='frogg'
BRAND_HOME='.frogg'
BRAND_SERVICE='frogg-daemon'
BRAND_LAUNCHD='app.frogg.frogg-daemon'
BRAND_DAEMON_PREFIX='frogg-daemon'
BRAND_ARTIFACT_PREFIX='Frogg'
BRAND_LEGACY_ARTIFACT_CUTOFF='0.2.16'
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
FROGG_RELEASE_BASE="${FROGG_RELEASE_BASE:-${BRAND_RELEASE_BASE}}"
FROGG_LISTEN="${FROGG_LISTEN:-0.0.0.0:${BRAND_PORT}}"
FROGG_VERSION="${FROGG_VERSION:-}"
FROGG_BUNDLE_FILE="${FROGG_BUNDLE_FILE:-}"
FROGG_BUNDLE_URL="${FROGG_BUNDLE_URL:-}"
FROGG_NO_SERVICE="${FROGG_NO_SERVICE:-0}"
FROGG_NO_MODIFY_PATH="${FROGG_NO_MODIFY_PATH:-0}"
FROGG_HOME="${FROGG_HOME:-}"

SERVICE_NAME="${BRAND_SERVICE}"
LAUNCHD_LABEL="${BRAND_LAUNCHD}"

log() { printf '[%s] %s\n' "${BRAND_CLI}" "$*"; }
die() { printf '[%s] error: %s\n' "${BRAND_CLI}" "$*" >&2; exit 1; }

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
  api="$(printf '%s' "${FROGG_RELEASE_BASE}" |
    sed -n 's#^https://github.com/\([^/]*\)/\([^/]*\)/releases/*$#https://api.github.com/repos/\1/\2/releases?per_page=1#p')"
  [ -n "${api}" ] || die "could not resolve the latest release from ${FROGG_RELEASE_BASE}/latest"
  local body
  body="$(curl -fsSL "${api}")" || die "could not resolve the latest release from ${api}"
  tag="$(printf '%s\n' "${body}" | tr ',{' '\n\n' |
    sed -n 's/^ *"tag_name" *: *"\([^"]*\)" *$/\1/p' | sed -n '1p')"
  FROGG_VERSION="${tag#v}"
  [ -n "${FROGG_VERSION}" ] || die "could not parse a version from ${api}"
}

resolve_latest_version() {
  [ -n "${FROGG_RELEASE_BASE}" ] || die "No release source configured; supply ${BRAND_ENV_PREFIX}_BUNDLE_FILE or ${BRAND_ENV_PREFIX}_BUNDLE_URL"
  need curl
  local effective candidate
  effective="$(curl -fsSL -o /dev/null -w '%{url_effective}' "${FROGG_RELEASE_BASE}/latest")" ||
    die "could not resolve the latest release from ${FROGG_RELEASE_BASE}/latest"
  candidate="${effective##*/}"
  candidate="${candidate#v}"
  case "${candidate}" in
    [0-9]*)
      FROGG_VERSION="${candidate}"
      return
      ;;
  esac
  resolve_latest_prerelease_version
}

# Sets BUNDLE_PATH to a verified tarball, downloading it when needed.
# Historical Frogg releases use the old filenames; new releases also publish aliases
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
  if [ -n "${FROGG_BUNDLE_FILE}" ]; then
    [ -f "${FROGG_BUNDLE_FILE}" ] || die "FROGG_BUNDLE_FILE does not exist: ${FROGG_BUNDLE_FILE}"
    BUNDLE_PATH="${FROGG_BUNDLE_FILE}"
    if [ -f "${FROGG_BUNDLE_FILE}.sha256" ]; then
      verify_bundle "${BUNDLE_PATH}" "${FROGG_BUNDLE_FILE}.sha256"
    fi
    return
  fi

  need curl
  local url
  if [ -n "${FROGG_BUNDLE_URL}" ]; then
    url="${FROGG_BUNDLE_URL}"
    name="${url##*/}"
  else
    [ -n "${FROGG_VERSION}" ] || resolve_latest_version
    name="${BRAND_DAEMON_PREFIX}-${FROGG_VERSION}-${PLATFORM}-${ARCH}.tar.gz"
    if [ "$BRAND_LEGACY" = true ] && ! brand_legacy_artifact_version "$FROGG_VERSION"; then
      public_platform="$PLATFORM"
      public_arch="$ARCH"
      [ "$public_platform" = "darwin" ] && public_platform="mac"
      [ "$public_arch" = "x64" ] && public_arch="x86_64"
      name="${BRAND_ARTIFACT_PREFIX}-${FROGG_VERSION}-${public_platform}-${public_arch}-daemon.tar.gz"
    fi
    url="${FROGG_RELEASE_BASE}/download/v${FROGG_VERSION}/${name}"
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

# Reads the bundle version from its manifest so FROGG_BUNDLE_FILE installs land
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
  versions_dir="${FROGG_INSTALL_DIR}/versions"
  target="${versions_dir}/${BUNDLE_VERSION}"
  mkdir -p "${versions_dir}" "${FROGG_BIN_DIR}"

  if [ -x "${target}/bin/${BRAND_CLI}" ] && [ -f "${target}/manifest.json" ]; then
    validate_bundle_identity "${target}"
    log "version ${BUNDLE_VERSION} already present at ${target}"
  else
    staging="$(mktemp -d "${versions_dir}/.staging.${BUNDLE_VERSION}.XXXXXX")"
    tar -xzf "${BUNDLE_PATH}" --strip-components=1 -C "${staging}"
    [ -x "${staging}/bin/${BRAND_CLI}" ] || die "bundle is missing bin/frogg"
    validate_bundle_identity "${staging}"
    rm -rf "${target}"
    mv "${staging}" "${target}"
    log "installed version ${BUNDLE_VERSION} to ${target}"
  fi

  # Atomic `current` swap: rename a fresh symlink over the old one.
  ln -sfn "versions/${BUNDLE_VERSION}" "${FROGG_INSTALL_DIR}/current.new"
  if mv -T "${FROGG_INSTALL_DIR}/current.new" "${FROGG_INSTALL_DIR}/current" 2>/dev/null; then
    :
  else
    rm -f "${FROGG_INSTALL_DIR}/current.new"
    ln -sfn "versions/${BUNDLE_VERSION}" "${FROGG_INSTALL_DIR}/current"
  fi

  # The rollback target for `${BRAND_CLI} daemon self-update`; only changes on a real
  # version switch so a re-run never points previous at the current version.
  if [ -n "${PREVIOUS_VERSION}" ] && [ "${PREVIOUS_VERSION}" != "${BUNDLE_VERSION}" ]; then
    printf '%s\n' "${PREVIOUS_VERSION}" > "${FROGG_INSTALL_DIR}/previous"
  fi

  for name in "${BRAND_COMMANDS[@]}"; do
    if [ -e "${FROGG_BIN_DIR}/${name}" ] || [ -L "${FROGG_BIN_DIR}/${name}" ]; then
      [ "$(readlink "${FROGG_BIN_DIR}/${name}" 2>/dev/null || true)" = "${FROGG_INSTALL_DIR}/current/bin/${name}" ] || die "command ${name} already belongs to another installation"
    fi
    ln -sfn "${FROGG_INSTALL_DIR}/current/bin/${name}" "${FROGG_BIN_DIR}/${name}"
    log "linked ${FROGG_BIN_DIR}/${name}"
  done
  printf '%s:%s\n' "${BRAND_ID}" "${BRAND_APPLICATION_ID}" > "${FROGG_INSTALL_DIR}/.brand-identity"

}

prune_old_versions() {
  # A daemon using this install may retain any older runtime, even when this
  # installer has no FROGG_EXECUTION_SERVICE environment setting or shares no home.
  log "retaining installed versions; remove old versions only after stopping all execution"
}

systemd_quote() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g')"; }
xml() { printf '%s' "$1" | sed 's/\&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }
write_systemd_unit() {
  local unit_dir unit kill_mode execution_env stop_command
  kill_mode=mixed
  execution_env=
  stop_command=
  if [ "${FROGG_EXECUTION_SERVICE:-}" = 1 ]; then
    kill_mode=process
    execution_env=Environment=FROGG_EXECUTION_SERVICE=1
    stop_command="ExecStop=$(systemd_quote "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}") daemon stop --force"
  fi
  unit_dir="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
  unit="${unit_dir}/${SERVICE_NAME}.service"
  if [ -f "${unit}" ] && ! grep -Fq "${FROGG_INSTALL_DIR}/current" "${unit}"; then die "service belongs to another installation"; fi
  mkdir -p "${unit_dir}"
  cat > "${unit}" <<EOF
[Unit]
Description=${BRAND_NAME} daemon (${BRAND_FULL_NAME})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(systemd_quote "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}") daemon start --foreground
Environment=FROGG_LISTEN=${FROGG_LISTEN}
Environment=FROGG_WEB_UI_ENABLED=true
Environment=$(systemd_quote "PATH=${FROGG_BIN_DIR}:${PATH}")
Environment=$(systemd_quote "${BRAND_ENV_PREFIX}_INSTALL_DIR=${FROGG_INSTALL_DIR}")
${FROGG_HOME:+Environment=$(systemd_quote "${BRAND_ENV_PREFIX}_HOME=${FROGG_HOME}")}
Restart=on-failure
RestartSec=5
${execution_env}
${stop_command}
KillMode=${kill_mode}
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
    systemctl --user stop "${SERVICE_NAME}"
  fi
  stop_existing_daemon
  systemctl --user start "${SERVICE_NAME}"
  log "started ${SERVICE_NAME} (systemd user service)"
  if [ "$(id -u)" != "0" ]; then
    log "to keep the daemon running after logout: sudo loginctl enable-linger $(id -un)"
  fi
}

start_detached_daemon() {
  stop_existing_daemon
  local log_dir
  log_dir="${FROGG_INSTALL_DIR}/logs"
  mkdir -p "${log_dir}"
  if [ -n "${FROGG_HOME}" ]; then
    nohup env FROGG_LISTEN="${FROGG_LISTEN}" FROGG_WEB_UI_ENABLED=true FROGG_INSTALL_DIR="${FROGG_INSTALL_DIR}" "${BRAND_ENV_PREFIX}_HOME=${FROGG_HOME}" \
      "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon start --foreground >> "${log_dir}/fallback-daemon.log" 2>&1 < /dev/null &
  else
    nohup env FROGG_LISTEN="${FROGG_LISTEN}" FROGG_WEB_UI_ENABLED=true FROGG_INSTALL_DIR="${FROGG_INSTALL_DIR}" \
      "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon start --foreground >> "${log_dir}/fallback-daemon.log" 2>&1 < /dev/null &
  fi
  log "started the daemon for this login; its fallback log is ${log_dir}/fallback-daemon.log"
}

write_launchd_plist() {
  local plist log_dir
  plist="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
  log_dir="${FROGG_INSTALL_DIR}/logs"
  mkdir -p "${HOME}/Library/LaunchAgents" "${log_dir}"
  cat > "${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}")</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FROGG_LISTEN</key><string>${FROGG_LISTEN}</string>
    <key>FROGG_WEB_UI_ENABLED</key><string>true</string>
    <key>PATH</key><string>$(xml "${FROGG_BIN_DIR}:${PATH}")</string>
    <key>FROGG_INSTALL_DIR</key><string>$(xml "${FROGG_INSTALL_DIR}")</string>
${FROGG_HOME:+    <key>${BRAND_ENV_PREFIX}_HOME</key><string>$(xml "${FROGG_HOME}")</string>}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
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
  stop_existing_daemon
  launchctl bootstrap "${domain}" "${LAUNCHD_PLIST}" || die "launchctl bootstrap failed"
  log "started ${LAUNCHD_LABEL} (launchd agent)"
}

stop_existing_daemon() {
  "${FROGG_INSTALL_DIR}/current/bin/${BRAND_CLI}" daemon stop --home "${FROGG_HOME:-${HOME}/${BRAND_HOME}}" ||
    die "could not stop the existing daemon; the new version has not been started"
}

# Inline because the downloaded installer must work without repository files.
verify_running_daemon() {
  "${FROGG_INSTALL_DIR}/current/node/bin/node" - "${FROGG_LISTEN}" "${BUNDLE_VERSION}" "${BRAND_ID}" "${BRAND_APPLICATION_ID}" "${BRAND_LEGACY}" "${FROGG_HEALTH_TIMEOUT:-30}" <<'JS' || die "the new daemon could not be verified; inspect ${FROGG_HOME:-${HOME}/${BRAND_HOME}}/daemon.log and the service logs"
const http = require('node:http');
const [listen, expected, brandId, applicationId, legacy, seconds] = process.argv.slice(2);
const timeout = Number(seconds) * 1000;
if (!Number.isFinite(timeout) || timeout <= 0) {
  console.error('Health timeout must be a positive number of seconds'); process.exit(1);
}
const target = listen.replace(/^tcp:\/\//, '');
const socketPath = target.startsWith('/') ? target : null;
const address = target.replace(/^0\.0\.0\.0:/, '127.0.0.1:').replace(/^\[?::\]?:/, '[::1]:');
const deadline = Date.now() + timeout;
function get(route) {
  return new Promise((resolve, reject) => {
    const options = socketPath ? { socketPath, path: route } : new URL(`http://${address}${route}`);
    const request = http.get(options, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) request.destroy(new Error(`${route}: response is too large`));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error(`${route}: HTTP ${response.statusCode}`);
          resolve({ body: JSON.parse(body), headers: response.headers });
        } catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error(`${route}: timed out`)), Math.max(1, Math.min(1500, deadline - Date.now())));
    request.once('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}
(async function verify() {
  let reason = 'daemon did not answer';
  while (Date.now() < deadline) {
    try {
      const identity = await get('/api/identity');
      const version = identity.headers['x-frogg-gateway-version'] ?? identity.body.version;
      const owner = identity.body.brand;
      const owned = owner ? owner.id === brandId && owner.applicationId === applicationId : legacy === 'true' && identity.body.product === 'frogg';
      if (!owned) throw new Error('another product is listening on the daemon address');
      if (version !== expected) throw new Error(`daemon reports version ${version ?? 'unknown'}, expected ${expected}`);
      const health = await get('/api/health');
      if (health.body.status !== 'ok') throw new Error('daemon health check did not report ok');
      return;
    } catch (error) { reason = error.message; }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(0, deadline - Date.now()))));
  }
  console.error(`Daemon activation failed: ${reason}. Check the service and daemon logs, then rerun the installer.`);
  process.exitCode = 1;
})();
JS
  log "verified running daemon ${BUNDLE_VERSION}"
}

# Keep this inline: install.sh also runs standalone through curl | bash.
configure_shell_path() {
  local shell_name quoted_bin path_line file login_file
  local files=()
  # Single quotes protect custom paths from expansion when the shell starts.
  quoted_bin="'$(printf '%s' "${FROGG_BIN_DIR}" | sed "s/'/'\\\\''/g")'"
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
      quoted_bin="'$(printf '%s' "${FROGG_BIN_DIR}" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g")'"
      path_line="contains -- ${quoted_bin} \$PATH; or set -gx PATH ${quoted_bin} \$PATH"
      PATH_COMMAND="${path_line}"
      files=("${XDG_CONFIG_HOME:-${HOME}/.config}/fish/config.fish")
      ;;
    sh|dash|ksh) files=("${HOME}/.profile") ;;
    *) log "shell ${SHELL:-unknown} is not supported for automatic PATH setup"; return ;;
  esac
  [ "${FROGG_NO_MODIFY_PATH}" != "1" ] || return 0
  for file in "${files[@]}"; do
    if [ -f "${file}" ] && grep -Fqx -- "${path_line}" "${file}"; then continue; fi
    if mkdir -p "$(dirname "${file}")" && printf '\n# Frogg CLI\n%s\n' "${path_line}" >> "${file}"; then
      log "configured PATH in ${file}"
    else
      log "could not update ${file}; configure PATH manually"
    fi
  done
}

# Use the bundled runtime so this also works on macOS without hostname -I.
web_ui_urls() {
  "${FROGG_INSTALL_DIR}/current/node/bin/node" - "${FROGG_LISTEN}" <<'JS'
const { networkInterfaces } = require('node:os');
const listen = process.argv[2].replace(/^tcp:\/\//, '');
if (listen.startsWith('/')) process.exit(0);
const separator = listen.lastIndexOf(':');
const host = listen.slice(0, separator).replace(/^\[|\]$/g, '');
const port = listen.slice(separator + 1);
let addresses = [host];
if (host === '0.0.0.0' || host === '::') {
  addresses = Object.values(networkInterfaces()).flat()
    .filter((entry) => !entry.internal && (host === '::' || entry.family === 'IPv4'))
    .filter((entry) => !entry.scopeid)
    .map((entry) => entry.address);
}
for (const address of new Set(addresses)) {
  const authority = address.includes(':') ? `[${address}]` : address;
  process.stdout.write(`http://${authority}:${port}/\n`);
}
JS
}

print_next_steps() {
  local host port urls url listen
  listen="${FROGG_LISTEN#tcp://}"
  host="${listen%:*}"
  port="${FROGG_LISTEN##*:}"
  echo
  log "${BRAND_NAME} daemon ${BUNDLE_VERSION} installed."
  if [ "${FROGG_NO_SERVICE}" = "1" ]; then
    log "no service installed; start the daemon with: ${BRAND_CLI} daemon start --listen ${FROGG_LISTEN} --web-ui"
  else
    urls="$(web_ui_urls)"
    if [ -n "${urls}" ]; then
      while IFS= read -r url; do
        log "web UI: ${url}"
      done <<< "${urls}"
    elif [[ "${listen}" = /* ]]; then
      log "web UI: listening on Unix socket ${listen}; use a proxy or TCP listener for browser access"
    else
      log "web UI: no network address detected; check the host's network configuration"
    fi
    if [ "${host}" = "127.0.0.1" ] || [ "${host}" = "localhost" ] || [ "${host}" = "[::1]" ] || [ "${host}" = "::1" ]; then
      log "the daemon listens on loopback; reach it through an SSH tunnel or re-run with FROGG_LISTEN=0.0.0.0:${port}"
    elif [[ "${listen}" != /* ]]; then
      log "the daemon is network-reachable; set a password with: ${BRAND_CLI} daemon set-password"
    fi
  fi
  log "pair a client:     ${BRAND_CLI} daemon pair"
  log "check status:      ${BRAND_CLI} daemon status"
  log "update later:      ${BRAND_CLI} daemon self-update   (rolls back by itself if the new version fails)"
  case ":${PATH}:" in
    *":${FROGG_BIN_DIR}:"*) ;;
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
  WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/frogg-install.XXXXXX")"
  trap 'rm -rf "${WORK_DIR}"' EXIT

  PREVIOUS_VERSION=""
  if [ -L "${FROGG_INSTALL_DIR}/current" ]; then
    PREVIOUS_VERSION="$(basename "$(readlink "${FROGG_INSTALL_DIR}/current")")"
  fi

  acquire_bundle
  read_bundle_version
  install_bundle
  prune_old_versions
  configure_shell_path

  if [ "${FROGG_NO_SERVICE}" != "1" ]; then
    case "${PLATFORM}" in
      linux) install_systemd_service ;;
      darwin) install_launchd_agent ;;
    esac
    verify_running_daemon
  fi
  print_next_steps
}

main "$@"
