import type { Brand } from "@fde/branding/schema";

// Kept identical to deploy/probe.sh.in; a regression test guards template drift.
export const PROBE_TEMPLATE =
  'set +e\nesc() { printf \'%s\' "$1" | sed -e \'s/\\\\/\\\\\\\\/g\' -e \'s/"/\\\\"/g\' | tr -d \'\\n\\r\'; }\nos=$(uname -s 2>/dev/null); arch=$(uname -m 2>/dev/null)\ndocker=false\nif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then docker=true; fi\nsystemd=false\nif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then systemd=true; fi\ncurl=false\nif command -v curl >/dev/null 2>&1; then curl=true; fi\ninstalled=false; version=""\nroot="${@ENV_PREFIX@_INSTALL_DIR:-$HOME/.local/share/@ID@}"\nif [ -x "$root/current/bin/@CLI@" ]; then\n  if [ "@LEGACY@" = true ] || [ "$(cat "$root/.brand-identity" 2>/dev/null)" = \'@ID@:@APPLICATION_ID@\' ]; then installed=true; fi\n  if [ -f "$root/current/manifest.json" ]; then\n    version=$(sed -n \'s/.*"version": *"\\([^"]*\\)".*/\\1/p\' "$root/current/manifest.json" | head -n 1)\n  fi\nelif [ "@LEGACY@" = true ] && command -v @CLI@ >/dev/null 2>&1; then\n  installed=true\n  version=$(@CLI@ --version 2>/dev/null | head -n 1)\nfi\ncontainer=false\nif [ "$docker" = true ] && docker container inspect "${@ENV_PREFIX@_CONTAINER:-@SERVICE@}" >/dev/null 2>&1; then\n  owner=$(docker inspect --format \'{{ index .Config.Labels "app.brand.application-id" }}\' "${@ENV_PREFIX@_CONTAINER:-@SERVICE@}" 2>/dev/null)\n  if [ "$owner" = \'@APPLICATION_ID@\' ] || { [ "@LEGACY@" = true ] && [ -z "$owner" ]; }; then container=true; fi\nfi\nprintf \'FDE_PROBE {"os":"%s","arch":"%s","hasDocker":%s,"hasSystemdUser":%s,"hasCurl":%s,"hasFde":{"installed":%s,"version":"%s"},"hasDockerContainer":%s,"homeDir":"%s"}\\n\' \\\n  "$(esc "$os")" "$(esc "$arch")" "$docker" "$systemd" "$curl" "$installed" "$(esc "$version")" "$container" "$(esc "$HOME")"\n';
export function buildProbeScript(
  brand: Pick<
    Brand,
    "id" | "envPrefix" | "cliName" | "serviceName" | "applicationId" | "legacyFde"
  >,
): string {
  const fields: Record<string, string> = {
    ID: brand.id,
    ENV_PREFIX: brand.envPrefix,
    CLI: brand.cliName,
    SERVICE: brand.serviceName,
    APPLICATION_ID: brand.applicationId,
    LEGACY: String(brand.legacyFde),
  };
  return PROBE_TEMPLATE.replace(
    /@(ID|ENV_PREFIX|CLI|SERVICE|APPLICATION_ID|LEGACY)@/gu,
    (_match, key: string) => fields[key],
  );
}
export function parseProbeOutput(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/u)
    .toReversed()
    .find((entry) => entry.trim().startsWith("FDE_PROBE "));
  if (!line) throw new Error("The probe printed no result; the remote shell may not be POSIX sh.");
  const raw: unknown = JSON.parse(line.trim().slice("FDE_PROBE ".length));
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The probe result could not be parsed.");
  const value = raw as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? value[key] : "");
  const hasFde =
    value.hasFde && typeof value.hasFde === "object"
      ? (value.hasFde as Record<string, unknown>)
      : {};
  const version =
    typeof hasFde.version === "string" ? hasFde.version.trim().replace(/^v+/u, "") : "";
  return {
    os: text("os"),
    arch: text("arch"),
    homeDir: text("homeDir"),
    hasDocker: value.hasDocker === true,
    hasSystemdUser: value.hasSystemdUser === true,
    hasCurl: value.hasCurl === true,
    hasDockerContainer: value.hasDockerContainer === true,
    hasFde: {
      installed: hasFde.installed === true,
      ...(version ? { version } : {}),
    },
  };
}
