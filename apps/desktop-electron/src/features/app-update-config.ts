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
