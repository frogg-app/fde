import { gte, rcompare, valid } from "semver";
import { fetchReleaseDescriptor, parseReleaseDescriptor } from "./release-descriptor.js";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** electron-updater reads this config for download cache metadata even with setFeedURL. */
export function writeElectronUpdateConfig(
  userDataPath: string,
  updateUrl: string,
  cacheName: string,
): string {
  const url = new URL(updateUrl);
  if (url.protocol !== "https:") throw new Error("Electron update URL must use HTTPS.");
  const directory = path.join(userDataPath, "updater");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "app-update.yml");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  // JSON is valid YAML and escapes URLs/cache names without interpolation hazards.
  writeFileSync(
    temporary,
    JSON.stringify({ provider: "generic", url: updateUrl, updaterCacheDirName: cacheName }),
    { mode: 0o600 },
  );
  renameSync(temporary, destination);
  return destination;
}

/** App-only production releases share a branded feed; metadata channels stay Electron-specific. */
export function resolveElectronUpdateUrl(
  override: string | undefined,
  releaseBase: string | null,
): string | null {
  return (
    override?.trim() || (releaseBase ? `${releaseBase.replace(/\/$/, "")}/latest/download` : null)
  );
}

export interface ElectronUpdateFeed {
  url: string;
  channel: "electron-latest" | "electron-beta";
}

async function fetchPublishedReleases(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Release discovery failed (${response.status}).`);
  return response.json();
}

async function resolveLegacyFeed(input: {
  override?: string;
  releaseBase: string | null;
  releaseChannel: "stable" | "beta";
  fetchReleases?: (url: string) => Promise<unknown>;
}): Promise<ElectronUpdateFeed | null> {
  const url = resolveElectronUpdateUrl(input.override, input.releaseBase);
  if (!url) return null;
  if (new URL(url).protocol !== "https:") throw new Error("Electron update URL must use HTTPS.");
  const channel = input.releaseChannel === "beta" ? "electron-beta" : "electron-latest";
  // An explicit generic feed owns its channel routing. Stable releases use GitHub's latest alias.
  if (input.override?.trim() || input.releaseChannel === "stable") return { url, channel };
  const base = new URL(input.releaseBase!);
  const repository = /^\/([^/]+)\/([^/]+)\/releases\/?$/.exec(base.pathname);
  if (base.hostname !== "github.com" || !repository) return { url, channel };
  const releases = await (input.fetchReleases ?? fetchPublishedReleases)(
    `https://api.github.com/repos/${repository[1]}/${repository[2]}/releases?per_page=100`,
  );
  if (!Array.isArray(releases)) throw new Error("Unexpected release discovery response.");
  const candidates = releases
    .flatMap((release: unknown) => {
      if (!release || typeof release !== "object") return [];
      const value = release as Record<string, unknown>;
      if (value.draft !== false || typeof value.tag_name !== "string") return [];
      const version = valid(value.tag_name);
      if (!version) return [];
      return [{ tag: value.tag_name, version }];
    })
    .sort((a, b) => rcompare(a.version, b.version));
  const release = candidates[0];
  if (!release) throw new Error("No published desktop release is available.");
  return {
    url: `${input.releaseBase!.replace(/\/$/, "")}/download/${encodeURIComponent(release.tag)}`,
    channel: release.version.includes("-") ? "electron-beta" : "electron-latest",
  };
}

/** Published JSON selects a version-pinned feed; payload names and hashes come from its manifests. */
export async function resolveElectronUpdateFeed(input: {
  override?: string;
  releaseBase: string | null;
  releaseChannel: "stable" | "beta";
  fetchReleases?: (url: string) => Promise<unknown>;
  currentVersion?: string;
  fetchDescriptor?: (url: string) => Promise<unknown | null>;
}): Promise<ElectronUpdateFeed | null> {
  const legacy = await resolveLegacyFeed(input);
  if (!legacy || input.override?.trim()) return legacy;
  const base = new URL(input.releaseBase!);
  if (base.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/releases\/?$/.test(base.pathname))
    return legacy;
  const raw = await (input.fetchDescriptor ?? fetchReleaseDescriptor)(
    `${legacy.url}/electron-release.json`,
  );
  if (raw === null) return legacy;
  const descriptor = parseReleaseDescriptor(raw);
  if (
    !input.currentVersion ||
    !valid(input.currentVersion) ||
    !gte(input.currentVersion, descriptor.minimumClientVersion)
  ) {
    throw new Error(
      `This release requires a manual upgrade from clients older than ${descriptor.minimumClientVersion}.`,
    );
  }
  if (input.releaseChannel === "stable" && descriptor.channel !== "electron-latest") {
    throw new Error("Stable update feed points to a prerelease.");
  }
  const url = `${input.releaseBase!.replace(/\/$/, "")}/download/v${descriptor.version}`;
  if (input.releaseChannel === "beta" && url !== legacy.url) {
    throw new Error("Release descriptor version does not match the selected release.");
  }
  return { url, channel: descriptor.channel };
}
