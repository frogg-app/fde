/** Pure shared naming contract: Node release tools, application code, and Rust generation. */
export const legacyArtifactCutoff = "0.2.16";

/** @param {string} version */
export function isLegacyArtifactVersion(version) {
  const parts = version.split(/[+-]/)[0].split(".").map(Number);
  const cutoff = legacyArtifactCutoff.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== cutoff[i]) return parts[i] < cutoff[i];
  }
  return false;
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} platform @param {string} arch */
export function legacyDaemonArtifactName(brand, version, platform, arch) {
  return `${brand.daemonArtifactPrefix}-${version}-${platform}-${arch}.${platform === "win" ? "zip" : "tar.gz"}`;
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} platform @param {string} arch */
export function daemonArtifactName(brand, version, platform, arch) {
  if (!brand.legacyFde || isLegacyArtifactVersion(version))
    return legacyDaemonArtifactName(brand, version, platform, arch);
  const publicPlatform = platform === "darwin" ? "mac" : platform;
  const publicArch = arch === "x64" && platform !== "win" ? "x86_64" : arch;
  return `${brand.artifactPrefix}-${version}-${publicPlatform}-${publicArch}-daemon.${platform === "win" ? "zip" : "tar.gz"}`;
}

/** @param {string} suffix */
export function legacyDesktopSuffix(suffix) {
  return suffix.replace(/^linux-x86_64\.deb/, "amd64.deb").replace(/^(win|linux|mac)-/, "");
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} suffix */
export function desktopArtifactName(brand, version, suffix) {
  const resolved =
    brand.legacyFde && isLegacyArtifactVersion(version) ? legacyDesktopSuffix(suffix) : suffix;
  return `${brand.artifactPrefix}-${version}-${resolved}`;
}

export const desktopArtifactSuffixes = [
  "win-x64-setup.zip",
  "win-x64-portable.zip",
  "linux-x86_64.AppImage",
  "linux-x86_64.deb",
  "mac-aarch64.dmg",
  "mac-x86_64.dmg",
  "mac-aarch64.app.tar.gz",
  "mac-x86_64.app.tar.gz",
];
