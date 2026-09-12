import type { Brand } from "./schema.js";

export function daemonArtifactName(
  brand: Brand,
  version: string,
  platform: string,
  arch: string,
): string {
  return `${brand.daemonArtifactPrefix}-${version}-${platform}-${arch}.${platform === "win" ? "zip" : "tar.gz"}`;
}
export function desktopArtifactName(brand: Brand, version: string, suffix: string): string {
  return `${brand.artifactPrefix}-${version}-${suffix}`;
}
