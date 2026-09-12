#!/usr/bin/env bash
# Standalone installer for the Linux x64 Companion preview artifact.
# Uses separate application/state directories and does not install a service.
set -euo pipefail

preview_tag=companion-preview-20260912-3
archive=fde-daemon-0.2.14-linux-x64.tar.gz
archive_sha=e6716325076276afbdd49b82deabba61b01bb709e32b36855b5ae43869905f92
release_url="https://github.com/frogg-app/fde/releases/download/${preview_tag}"
install_dir="${FDE_COMPANION_INSTALL_DIR:-${HOME}/.local/share/fde-${preview_tag}}"
state_dir="${FDE_COMPANION_STATE_DIR:-${HOME}/.fde-${preview_tag}}"
listen="${FDE_COMPANION_LISTEN:-0.0.0.0:6800}"

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
if [[ ! -x "${install_dir}/bundle/bin/fde" ]]; then
  if [[ -n "${FDE_COMPANION_BUNDLE_FILE:-}" ]]; then
    cp "$FDE_COMPANION_BUNDLE_FILE" "${work_dir}/${archive}"
  else
    curl -fL --retry 3 "${release_url}/${archive}" -o "${work_dir}/${archive}"
  fi
  (cd "$work_dir" && printf '%s  %s\n' "$archive_sha" "$archive" | sha256sum -c -)
  tar -xzf "${work_dir}/${archive}" -C "$work_dir"
  mv "${work_dir}/fde-daemon-0.2.14-linux-x64" "${install_dir}/bundle"
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
fde="${install_dir}/bundle/bin/fde"
relay_option=--relay
if [[ "${FDE_COMPANION_RELAY:-1}" == 0 ]]; then relay_option=--no-relay; fi
"$fde" start --home "$state_dir" --listen "$listen" "$relay_option" --web-ui
printf '\nCompanion preview installed. Provider login and speech models are required.\n'
printf 'Status: %q status --home %q\n' "$fde" "$state_dir"
printf 'Stop:   %q stop --home %q\n' "$fde" "$state_dir"
printf 'Pair:   %q auth pair --home %q\n' "$fde" "$state_dir"
if [[ "${FDE_COMPANION_NO_PAIR:-0}" != 1 ]]; then
  "$fde" auth pair --home "$state_dir"
fi
