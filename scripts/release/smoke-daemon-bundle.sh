#!/usr/bin/env bash
# Smoke-tests a daemon bundle tarball on the current host: extracts it into a
# temp dir, starts the daemon through bin/fde, waits for `daemon status` to
# report running, fetches the web UI over HTTP, then stops the daemon.
#
# Usage: scripts/release/smoke-daemon-bundle.sh <bundle.tar.gz> [port]
set -euo pipefail

bundle="${1:?usage: $0 <bundle.tar.gz> [port]}"
port="${2:-6798}"
listen="0.0.0.0:${port}"

work="$(mktemp -d "${TMPDIR:-/tmp}/fde-bundle-smoke.XXXXXX")"
home="${work}/home"
mkdir -p "${home}"

cleanup() {
  "${work}/bundle/bin/fde" daemon stop --home "${home}" --json >/dev/null 2>&1 || true
  rm -rf "${work}"
}
trap cleanup EXIT

mkdir -p "${work}/bundle"
tar -xzf "${bundle}" --strip-components=1 -C "${work}/bundle"
fde="${work}/bundle/bin/fde"

echo "manifest: $(tr -d '\n ' < "${work}/bundle/manifest.json")"
echo "fde --version: $("${fde}" --version)"

"${fde}" daemon start --listen "${listen}" --no-relay --web-ui --home "${home}"

for _ in $(seq 1 60); do
  status="$("${fde}" daemon status --home "${home}" --json 2>/dev/null || true)"
  if printf '%s' "${status}" | grep -q '"localDaemon": *"running"'; then
    break
  fi
  sleep 1
done
if ! printf '%s' "${status}" | grep -q '"localDaemon": *"running"'; then
  echo "daemon did not reach running state:" >&2
  printf '%s\n' "${status}" >&2
  cat "${home}/daemon.log" >&2 || true
  exit 1
fi
echo "daemon status: running (listen ${listen})"

html="$(curl -fsS "http://127.0.0.1:${port}/")"
if ! printf '%s' "${html}" | grep -qi '<html'; then
  echo "web UI did not return HTML:" >&2
  printf '%s\n' "${html}" | head -c 500 >&2
  exit 1
fi
echo "web UI: OK ($(printf '%s' "${html}" | wc -c) bytes of HTML)"

"${fde}" daemon stop --home "${home}" --json
echo "smoke test passed"
