import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareVersionStrings } from "./semver.js";

/**
 * The versioned install directory deploy/install.sh lays out:
 *
 *   <installDir>/versions/<v>/{bin,daemon,node,manifest.json}
 *   <installDir>/current      -> versions/<v>   (symlink; junction on Windows)
 *   <installDir>/previous     version `current` pointed to before the last flip
 *   <installDir>/last-update.json, self-update.log, tmp/
 *
 * Everything here is synchronous and small: the supervisor calls it between
 * a service stop and start, where clarity beats throughput.
 */
export const DEFAULT_KEEP_VERSIONS = 3;
export const LAST_UPDATE_FILE = "last-update.json";
export const SELF_UPDATE_LOG_FILE = "self-update.log";
const PREVIOUS_MARKER = "previous";
const CURRENT_LINK = "current";

export interface LastUpdateRecord {
  from: string | null;
  to: string;
  status: "applied" | "rolled_back" | "failed";
  reason: string | null;
  at: string;
}

export function resolveInstallDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.FDE_INSTALL_DIR?.trim();
  if (explicit) return explicit;
  if (process.platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "fde");
  }
  return path.join(os.homedir(), ".local", "share", "fde");
}

export function versionsDir(installDir: string): string {
  return path.join(installDir, "versions");
}

export function versionRoot(installDir: string, version: string): string {
  return path.join(versionsDir(installDir), version);
}

export function currentLinkPath(installDir: string): string {
  return path.join(installDir, CURRENT_LINK);
}

export function isVersionInstalled(installDir: string, version: string): boolean {
  const root = versionRoot(installDir, version);
  return existsSync(path.join(root, "manifest.json")) && existsSync(path.join(root, "bin"));
}

/** The version `current` points at, or null when this is not a versioned install. */
export function readCurrentVersion(installDir: string): string | null {
  const link = currentLinkPath(installDir);
  try {
    const stat = lstatSync(link);
    if (!stat.isSymbolicLink() && !stat.isDirectory()) return null;
    const target = readlinkSync(link);
    const name = path.basename(target.replace(/[\\/]+$/, ""));
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export function readPreviousVersion(installDir: string): string | null {
  try {
    const value = readFileSync(path.join(installDir, PREVIOUS_MARKER), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writePreviousVersion(installDir: string, version: string | null): void {
  const marker = path.join(installDir, PREVIOUS_MARKER);
  if (version === null) {
    rmSync(marker, { force: true });
    return;
  }
  writeFileSync(marker, `${version}\n`);
}

/**
 * Atomically repoints `current`: a fresh link is renamed over the old one so a
 * running `fde` always resolves a complete tree. Windows junctions cannot be
 * renamed over, so there the old link is removed first.
 */
export function setCurrentVersion(installDir: string, version: string): void {
  if (!isVersionInstalled(installDir, version)) {
    throw new Error(`version ${version} is not installed under ${versionsDir(installDir)}`);
  }
  const link = currentLinkPath(installDir);
  if (process.platform === "win32") {
    rmSync(link, { recursive: false, force: true });
    symlinkSync(versionRoot(installDir, version), link, "junction");
    return;
  }
  const fresh = `${link}.new`;
  rmSync(fresh, { force: true });
  symlinkSync(path.join("versions", version), fresh);
  renameSync(fresh, link);
}

export function listInstalledVersions(installDir: string): string[] {
  const dir = versionsDir(installDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((name) => isVersionInstalled(installDir, name))
    .sort((a, b) => compareVersionStrings(b, a));
}

/**
 * Keeps the newest `keep` versions plus every protected one (current,
 * previous, the one being installed) and removes the rest.
 */
export function pruneVersions(
  installDir: string,
  options: { keep?: number; protect: (string | null)[] },
): string[] {
  const keep = options.keep ?? DEFAULT_KEEP_VERSIONS;
  const protectedVersions = new Set(options.protect.filter((v): v is string => v !== null));
  const installed = listInstalledVersions(installDir);
  const removed: string[] = [];
  installed.forEach((version, index) => {
    if (index < keep || protectedVersions.has(version)) return;
    rmSync(versionRoot(installDir, version), { recursive: true, force: true });
    removed.push(version);
  });
  return removed;
}

export function readLastUpdate(installDir: string): LastUpdateRecord | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(installDir, LAST_UPDATE_FILE), "utf8"),
    ) as Partial<LastUpdateRecord>;
    if (
      typeof parsed.to !== "string" ||
      typeof parsed.at !== "string" ||
      (parsed.status !== "applied" && parsed.status !== "rolled_back" && parsed.status !== "failed")
    ) {
      return null;
    }
    return {
      from: typeof parsed.from === "string" ? parsed.from : null,
      to: parsed.to,
      status: parsed.status,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function writeLastUpdate(installDir: string, record: LastUpdateRecord): void {
  mkdirSync(installDir, { recursive: true });
  const target = path.join(installDir, LAST_UPDATE_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, target);
}

export function appendSelfUpdateLog(installDir: string, line: string): void {
  mkdirSync(installDir, { recursive: true });
  appendFileSync(
    path.join(installDir, SELF_UPDATE_LOG_FILE),
    `${new Date().toISOString()} ${line}\n`,
  );
}

export function tempDir(installDir: string): string {
  const dir = path.join(installDir, "tmp");
  mkdirSync(dir, { recursive: true });
  return dir;
}
