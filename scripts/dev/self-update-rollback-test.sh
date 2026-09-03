#!/usr/bin/env bash
# End-to-end check of `fde daemon self-update` and its rollback on one host,
# without touching any real install: a scratch FDE_INSTALL_DIR and PASEO_HOME,
# a daemon started by hand (FDE_NO_SERVICE=1, so the unmanaged stop/start path
# is exercised), and a local HTTP server standing in for the GitHub release.
#
# From a good bundle it derives two more: a "broken" one (bin/fde exits 1) one
# patch level up, and a good one two patch levels up. It then proves that
#   1. updating to the broken bundle ends in `rolled_back` with the original
#      daemon answering again, and
#   2. updating to the good bundle ends in `applied` with the new version
#      answering on /api/identity.
#
# Usage: scripts/dev/self-update-rollback-test.sh <good-bundle.tar.gz> [daemon-port] [http-port]
# Set TMPDIR to keep the scratch tree somewhere specific.
set -euo pipefail

bundle="${1:?usage: $0 <good-bundle.tar.gz> [daemon-port] [http-port]}"
port="${2:-9993}"
http_port="${3:-9994}"
listen="0.0.0.0:${port}"
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

work="$(mktemp -d "${TMPDIR:-/tmp}/fde-self-update-test.XXXXXX")"
install_dir="${work}/install"
home_dir="${work}/home"
serve_dir="${work}/release"
mkdir -p "${install_dir}" "${home_dir}" "${serve_dir}" "${work}/bin"

http_pid=""
cleanup() {
  if [ -x "${install_dir}/current/bin/fde" ]; then
    "${install_dir}/current/bin/fde" daemon stop --home "${home_dir}" --force --json >/dev/null 2>&1 || true
  fi
  if [ -n "${http_pid}" ]; then kill "${http_pid}" >/dev/null 2>&1 || true; fi
  rm -rf "${work}"
}
trap cleanup EXIT

log() { printf '\n[self-update-test] %s\n' "$*"; }
fail() { printf '[self-update-test] FAIL: %s\n' "$*" >&2; exit 1; }

sha256_of() { sha256sum "$1" | awk '{print $1}'; }

read_manifest_field() {
  sed -n "s/.*\"$2\": *\"\([^\"]*\)\".*/\1/p" "$1" | head -n1
}

# derive_bundle <src-tree> <version> <broken:0|1> -> writes serve_dir/download/v<version>/<asset>{,.sha256}
derive_bundle() {
  local src="$1" version="$2" broken="$3"
  local name="fde-daemon-${version}-${platform_arch}"
  local staging="${work}/derive/${name}"
  rm -rf "${staging}"
  mkdir -p "$(dirname "${staging}")"
  cp -a "${src}" "${staging}"
  sed -i "s/\"version\": *\"${base_version}\"/\"version\": \"${version}\"/" "${staging}/manifest.json"
  # The daemon reports @fde/server's package version on /api/identity.
  sed -i "s/\"version\": *\"${base_version}\"/\"version\": \"${version}\"/" \
    "${staging}/daemon/packages/server/package.json" "${staging}/daemon/apps/cli/package.json"
  if [ "${broken}" = "1" ]; then
    printf '#!/bin/sh\necho "broken bundle: refusing to start" >&2\nexit 1\n' > "${staging}/bin/fde"
    chmod +x "${staging}/bin/fde"
  fi
  local out_dir="${serve_dir}/download/v${version}"
  mkdir -p "${out_dir}"
  tar -C "$(dirname "${staging}")" -czf "${out_dir}/${name}.tar.gz" "${name}"
  printf '%s  %s.tar.gz\n' "$(sha256_of "${out_dir}/${name}.tar.gz")" "${name}" > "${out_dir}/${name}.tar.gz.sha256"
  rm -rf "${staging}"
  echo "${out_dir}/${name}.tar.gz"
}

identity_version() {
  curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/identity" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'
}

wait_for_version() {
  local expected="$1"
  for _ in $(seq 1 60); do
    if [ "$(identity_version)" = "${expected}" ]; then return 0; fi
    sleep 1
  done
  return 1
}

bump_patch() {
  local v="$1" by="$2"
  echo "${v%.*}.$(( ${v##*.} + by ))"
}

log "installing ${bundle} into ${install_dir} (no service)"
FDE_INSTALL_DIR="${install_dir}" FDE_BIN_DIR="${work}/bin" FDE_NO_SERVICE=1 FDE_BUNDLE_FILE="${bundle}" \
  bash "${repo_root}/deploy/install.sh" | sed 's/^/  /'
base_version="$(read_manifest_field "${install_dir}/current/manifest.json" version)"
platform_arch="$(read_manifest_field "${install_dir}/current/manifest.json" platform)-$(read_manifest_field "${install_dir}/current/manifest.json" arch)"
broken_version="$(bump_patch "${base_version}" 1)"
good_version="$(bump_patch "${base_version}" 2)"
[ "$(readlink "${install_dir}/current")" = "versions/${base_version}" ] || fail "current does not point at ${base_version}"

log "deriving a broken ${broken_version} and a good ${good_version} bundle from ${base_version}"
derive_bundle "${install_dir}/versions/${base_version}" "${broken_version}" 1 >/dev/null
derive_bundle "${install_dir}/versions/${base_version}" "${good_version}" 0 >/dev/null
(cd "${serve_dir}" && python3 -m http.server --bind 127.0.0.1 "${http_port}" >"${work}/http.log" 2>&1) &
http_pid=$!
sleep 1

export FDE_INSTALL_DIR="${install_dir}" PASEO_HOME="${home_dir}" PASEO_LISTEN="${listen}"
export FDE_RELEASE_BASE="http://127.0.0.1:${http_port}"
fde="${install_dir}/current/bin/fde"

log "starting daemon ${base_version} on ${listen}"
"${fde}" daemon start --listen "${listen}" --home "${home_dir}" --no-relay
wait_for_version "${base_version}" || fail "daemon ${base_version} did not answer on /api/identity"
echo "  /api/identity reports ${base_version}"

log "self-update to the broken ${broken_version}: expecting an automatic rollback"
set +e
"${fde}" daemon self-update --to "${broken_version}" --home "${home_dir}" --json --verify-timeout 30000 | tee "${work}/broken.jsonl" | sed 's/^/  /'
broken_exit="${PIPESTATUS[0]}"
set -e
grep -q '"status":"rolled_back"' "${work}/broken.jsonl" || fail "expected rolled_back, exit ${broken_exit}"
[ "${broken_exit}" = "2" ] || fail "expected exit code 2 for rolled_back, got ${broken_exit}"
[ "$(readlink "${install_dir}/current")" = "versions/${base_version}" ] || fail "current was not restored to ${base_version}"
wait_for_version "${base_version}" || fail "daemon ${base_version} is not answering after the rollback"
echo "  current -> $(readlink "${install_dir}/current"), /api/identity reports $(identity_version)"
echo "  last-update.json: $(tr -d '\n' < "${install_dir}/last-update.json")"
[ -d "${install_dir}/versions/${broken_version}" ] || fail "the failed version should stay on disk for inspection"

log "self-update to the good ${good_version}: expecting it to apply"
"${fde}" daemon self-update --to "${good_version}" --home "${home_dir}" --json --verify-timeout 30000 | tee "${work}/good.jsonl" | sed 's/^/  /'
grep -q '"status":"applied"' "${work}/good.jsonl" || fail "expected applied"
[ "$(readlink "${install_dir}/current")" = "versions/${good_version}" ] || fail "current does not point at ${good_version}"
[ "$(cat "${install_dir}/previous")" = "${base_version}" ] || fail "previous marker should be ${base_version}"
wait_for_version "${good_version}" || fail "daemon ${good_version} is not answering"
echo "  current -> $(readlink "${install_dir}/current"), previous = $(cat "${install_dir}/previous"), /api/identity reports $(identity_version)"
echo "  last-update.json: $(tr -d '\n' < "${install_dir}/last-update.json")"

log "re-running the same update is a no-op"
"${install_dir}/current/bin/fde" daemon self-update --to "${good_version}" --home "${home_dir}" --json | grep -q '"status":"up_to_date"' || fail "expected up_to_date on re-run"

log "self-update.log:"
sed 's/^/  /' "${install_dir}/self-update.log"
log "PASS: rollback from broken ${broken_version} and apply of ${good_version} both verified"
