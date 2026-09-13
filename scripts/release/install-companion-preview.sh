#!/usr/bin/env bash
# Standalone installer for the Linux x64 Companion preview artifact.
# Uses separate application/state directories and does not install a service.
set -euo pipefail

preview_tag=companion-preview-20260912-4
archive=Frogg-0.4.1-linux-x86_64-daemon.tar.gz
archive_sha=63772676fdc990ea2e122f2693123866b91dabbd8846064fa7e7d8ce26344b29
release_url="https://github.com/frogg-app/frogg/releases/download/${preview_tag}"
install_dir="${FROGG_COMPANION_INSTALL_DIR:-${HOME}/.local/share/frogg-${preview_tag}}"
state_dir="${FROGG_COMPANION_STATE_DIR:-${HOME}/.frogg-${preview_tag}}"
listen="${FROGG_COMPANION_LISTEN:-0.0.0.0:6801}"

if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'This preview bundle requires Linux x86_64.' >&2
  exit 1
fi
for required in curl tar sha256sum; do
  command -v "$required" >/dev/null || { echo "Missing command: $required" >&2; exit 1; }
done
mkdir -p "$install_dir" "$state_dir"
work_dir="$(mktemp -d "${install_dir}/.install.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
if [[ ! -x "${install_dir}/bundle/bin/frogg" ]]; then
  if [[ -n "${FROGG_COMPANION_BUNDLE_FILE:-}" ]]; then
    cp "$FROGG_COMPANION_BUNDLE_FILE" "${work_dir}/${archive}"
  else
    curl -fL --retry 3 "${release_url}/${archive}" -o "${work_dir}/${archive}"
  fi
  (cd "$work_dir" && printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c -)
  tar -xzf "${work_dir}/${archive}" -C "$work_dir"
  mv "${work_dir}/frogg-daemon-0.4.1-linux-x64" "${install_dir}/bundle"
fi
if [[ ! -e "${state_dir}/config.json" ]]; then
  cat > "${state_dir}/config.json" <<'JSON'
{
  "features": {
    "voice": { "enabled": true },
    "companion": { "enabled": true, "backend": "subscription" }
  }
}
JSON
fi
frogg="${install_dir}/bundle/bin/frogg"
relay_option=--relay
if [[ "${FROGG_COMPANION_RELAY:-1}" == 0 ]]; then relay_option=--no-relay; fi
"$frogg" start --home "$state_dir" --listen "$listen" "$relay_option" --web-ui
printf '\nCompanion preview installed. Provider login and speech models are required.\n'
printf 'Status: %q status --home %q\n' "$frogg" "$state_dir"
printf 'Stop:   %q stop --home %q\n' "$frogg" "$state_dir"
printf 'Pair:   %q auth pair --home %q\n' "$frogg" "$state_dir"
if [[ "${FROGG_COMPANION_NO_PAIR:-0}" != 1 ]]; then
  "$frogg" auth pair --home "$state_dir"
fi
