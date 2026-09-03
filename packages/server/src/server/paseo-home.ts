import { cpSync, existsSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDirectory } from "./private-files.js";

/**
 * Where FDE keeps its state. `FDE_HOME` is the primary environment variable;
 * `PASEO_HOME` keeps working as a fallback for daemons, services, and scripts
 * written before the rename (FDE_HOME wins when both are set).
 *
 * With neither set the home is `~/.fde`. A machine that still has the old
 * `~/.paseo` and no `~/.fde` is migrated once, in place: the directory is
 * renamed (and copied, leaving the original, when a rename crosses devices).
 * On-disk names inside the home are unchanged — `paseo.pid`, `config.json`,
 * `daemon.log`.
 */
export const FDE_HOME_DIR_NAME = ".fde";
export const LEGACY_HOME_DIR_NAME = ".paseo";

export interface HomeMigrationNotice {
  from: string;
  to: string;
  mode: "renamed" | "copied";
}

let migrationNotice: HomeMigrationNotice | null = null;
let migrationAttempted = false;

/** The migration that happened in this process, if any. Reported once, then cleared. */
export function consumeHomeMigrationNotice(): HomeMigrationNotice | null {
  const notice = migrationNotice;
  migrationNotice = null;
  return notice;
}

function expandHomeDir(input: string): string {
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** `FDE_HOME`, then `PASEO_HOME`; undefined when the caller set neither. */
export function resolveConfiguredHome(env: NodeJS.ProcessEnv): string | undefined {
  return nonEmpty(env.FDE_HOME) ?? nonEmpty(env.PASEO_HOME);
}

/**
 * Moves `~/.paseo` to `~/.fde` when the new home does not exist yet. Runs at
 * most once per process and only for the default (unconfigured) home.
 */
function migrateLegacyHome(target: string, legacy: string): void {
  if (migrationAttempted) return;
  migrationAttempted = true;
  if (existsSync(target) || !existsSync(legacy)) return;

  try {
    renameSync(legacy, target);
    migrationNotice = { from: legacy, to: target, mode: "renamed" };
  } catch {
    try {
      cpSync(legacy, target, { recursive: true, preserveTimestamps: true });
      migrationNotice = { from: legacy, to: target, mode: "copied" };
    } catch {
      // Leave the legacy home alone; the new home is created empty below.
      return;
    }
  }

  const notice = migrationNotice;
  if (notice) {
    process.stderr.write(
      notice.mode === "renamed"
        ? `[fde] Moved ${notice.from} to ${notice.to}\n`
        : `[fde] Copied ${notice.from} to ${notice.to} (the original was left in place)\n`,
    );
  }
}

export function resolveFdeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = resolveConfiguredHome(env);
  if (configured) {
    const resolvedConfigured = path.resolve(expandHomeDir(configured));
    ensurePrivateDirectory(resolvedConfigured);
    return resolvedConfigured;
  }

  const resolved = path.resolve(path.join(os.homedir(), FDE_HOME_DIR_NAME));
  migrateLegacyHome(resolved, path.resolve(path.join(os.homedir(), LEGACY_HOME_DIR_NAME)));
  ensurePrivateDirectory(resolved);
  return resolved;
}

/** @deprecated Use {@link resolveFdeHome}; kept because `$PASEO_HOME` still works. */
export const resolvePaseoHome = resolveFdeHome;

/** Test seam: forget that this process already tried the one-time migration. */
export function resetHomeMigrationStateForTests(): void {
  migrationAttempted = false;
  migrationNotice = null;
}
