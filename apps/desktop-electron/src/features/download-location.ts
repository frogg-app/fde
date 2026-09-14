import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Session } from "electron";

import type { DesktopSettings } from "../settings/desktop-settings.js";

type DownloadPreferences = DesktopSettings["downloads"];

// will-download must pick a save path synchronously, so the handler reads this
// snapshot instead of awaiting the settings store.
let preferences: DownloadPreferences | null = null;
const installedSessions = new WeakSet<Session>();

export function setDownloadPreferences(next: DownloadPreferences): void {
  preferences = next;
}

/** Returns the save path, or null to let Electron show its Save As dialog. */
export function resolveDownloadSavePath(
  current: DownloadPreferences | null,
  fileName: string,
  exists: (candidate: string) => boolean = existsSync,
  isDirectory: (candidate: string) => boolean = isExistingDirectory,
): string | null {
  if (!current || current.mode !== "directory") return null;
  const directory = current.directory ?? current.defaultDirectory;
  if (!directory || !isDirectory(directory)) return null;

  const safeName = path.basename(fileName).trim() || "download";
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;
  let candidate = path.join(directory, safeName);
  for (let suffix = 1; exists(candidate); suffix += 1) {
    candidate = path.join(directory, `${base} (${suffix})${ext}`);
  }
  return candidate;
}

export function installDownloadLocation(appSession: Session): void {
  if (installedSessions.has(appSession)) return;
  installedSessions.add(appSession);
  appSession.on("will-download", (_event, item) => {
    const savePath = resolveDownloadSavePath(preferences, item.getFilename());
    if (savePath) item.setSavePath(savePath);
  });
}

function isExistingDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
