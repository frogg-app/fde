#!/usr/bin/env bash
# Exercises the public install routes on frogg.app end to end: install the
# daemon, verify it runs, uninstall it, and verify it is gone.
#
# It runs the whole cycle inside a throwaway container. That is not caution for
# its own sake: uninstall.sh calls `systemctl --user disable --now fde-daemon`
# without reference to FDE_INSTALL_DIR, so running it on this host would stop
# the real daemon -- which is the parent of any agent session running under it.
# The container has no systemd and no view of the host's services, so the same
# script that would be destructive here is inert there.
#
# Usage: scripts/release/verify-install-routes.sh [image]
#        FDE_ROUTE_BASE=https://staging.example scripts/release/verify-install-routes.sh
#
# Exits non-zero if any step fails, so it works as a post-deploy smoke test for
# the Worker in deploy/install-worker.
set -euo pipefail

IMAGE="${1:-ubuntu:24.04}"
BASE="${FDE_ROUTE_BASE:-https://frogg.app}"

echo "=== FDE install-route verification ==="
echo "base:  ${BASE}"
echo "image: ${IMAGE}"
echo "date:  $(date -Is)"
echo

# ---------------------------------------------------------------------------
# 1. The routes themselves, from this host.
# ---------------------------------------------------------------------------
echo "--- 1. route reachability ---"
for script in install.sh uninstall.sh install-docker.sh; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/${script}")
  ctype=$(curl -sI "${BASE}/${script}" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r')
  source=$(curl -sI "${BASE}/${script}" | awk -F': ' 'tolower($1)=="x-fde-source"{print $2}' | tr -d '\r')
  # Read the whole body then take line 1: piping curl into `head` makes curl
  # exit 23 when head closes the pipe, which trips pipefail.
  body=$(curl -fsSL "${BASE}/${script}" 2>/dev/null || true)
  first=${body%%$'\n'*}
  printf '%-20s %s  %-34s %s\n' "${script}" "${code}" "${ctype}" "${source}"
  printf '%-20s shebang: %s\n' '' "${first}"
  [ "${code}" = "200" ] || { echo "FAIL: ${script} returned ${code}"; exit 1; }
  case "${first}" in "#!"*) ;; *) echo "FAIL: ${script} is not a shell script"; exit 1 ;; esac
done
echo

echo "--- 2. allowlist holds (non-script paths are not proxied) ---"
for path in nope.sh deploy/install.sh install.sh/extra; do
  printf '  %-24s %s\n' "/${path}" "$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/${path}")"
done
echo

# ---------------------------------------------------------------------------
# 3. A real install/uninstall cycle, isolated in a container.
# ---------------------------------------------------------------------------
echo "--- 3. install + uninstall cycle (container) ---"
docker run --rm -i \
  -e BASE="${BASE}" \
  -e DEBIAN_FRONTEND=noninteractive \
  "${IMAGE}" bash -euo pipefail -s <<'CONTAINER'
echo "[container] $(. /etc/os-release && echo "${PRETTY_NAME}") $(uname -m)"
apt-get update -qq >/dev/null 2>&1
apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
curl_v=$(curl --version); echo "[container] curl $(echo "${curl_v%%$'\n'*}" | cut -d' ' -f2)"
echo

# No service manager in here, so install without one. Everything else is the
# stock path a new user gets.
export FDE_NO_SERVICE=1

echo ">>> curl -fsSL \${BASE}/install.sh | bash"
curl -fsSL "${BASE}/install.sh" | bash
echo "<<< install exit: $?"
echo

echo ">>> installed layout"
ls -l "${HOME}/.local/share/fde" 2>/dev/null || echo "  (no install dir)"
echo "  current -> $(readlink "${HOME}/.local/share/fde/current" 2>/dev/null || echo none)"
ls -l "${HOME}/.local/bin/fde" 2>/dev/null || echo "  (no fde link)"
echo

echo ">>> the installed binary runs"
ver=$("${HOME}/.local/bin/fde" --version 2>&1) || { echo "  FAIL: fde --version failed: ${ver}"; exit 1; }
echo "  ${ver}"
echo

echo ">>> curl -fsSL \${BASE}/uninstall.sh | bash"
curl -fsSL "${BASE}/uninstall.sh" | bash
echo "<<< uninstall exit: $?"
echo

echo ">>> after uninstall"
if [ -e "${HOME}/.local/share/fde" ]; then
  echo "  FAIL: install dir still present:"; ls -l "${HOME}/.local/share/fde"; exit 1
fi
echo "  install dir removed"
if [ -e "${HOME}/.local/bin/fde" ]; then
  echo "  FAIL: fde link still present"; exit 1
fi
echo "  fde link removed"
# Daemon state is deliberately kept unless FDE_PURGE=1.
[ -e "${HOME}/.fde" ] && echo "  ~/.fde kept (expected; FDE_PURGE=1 removes it)" || echo "  ~/.fde absent"
CONTAINER

echo
echo "=== done ==="
