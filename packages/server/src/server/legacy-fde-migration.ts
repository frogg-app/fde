import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeProjectDirSync } from "./agent/providers/claude/project-dir.js";

// COMPAT(fdeRename): the product was called FDE before 0.8. Its home was ~/.fde and its
// environment variables used the FDE_ prefix. This module moves an FDE home into place for
// Frogg on first start and reports FDE_ settings that no longer apply. Remove after 2027-06-01.

const LEGACY_HOME_DIR_NAME = ".fde";
const LEGACY_ENV_PREFIX = "FDE_";
const PENDING_MARKER = ".fde-migration-pending";
const STAGING_SUFFIX = ".migrating";
const LEGACY_PID_FILE = "fde.pid";
const PID_LOCK_STALE_MS = 5 * 60_000;
// Bulky or content-addressed trees that never hold daemon metadata paths.
const SKIPPED_TOP_LEVEL = new Set(["worktrees", "models", "tts-cache", "uploads"]);
const REWRITTEN_EXTENSIONS = new Set([".json", ".jsonl"]);
const MAX_REWRITE_BYTES = 16 * 1024 * 1024;
// Persisted JSON keys renamed along with the product.
const RENAMED_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['"isFdeOwnedWorktree"', '"isFroggOwnedWorktree"'],
];

export type LegacyFdeHomeMigration =
  | { status: "not-needed" }
  | { status: "migrated"; from: string; to: string; worktreesRepaired: number }
  | { status: "skipped"; reason: string };

export interface LegacyFdeMigrationOptions {
  userHome?: string;
  claudeConfigDir?: string;
  log?: (message: string) => void;
}

/**
 * Moves ~/.fde to `targetHome` when the target is absent (or an empty directory) and no
 * FDE daemon still holds the old home. Safe to call on every start: once ~/.fde is gone it
 * only finishes a migration that a crash interrupted.
 */
export function migrateLegacyFdeHome(
  targetHome: string,
  options: LegacyFdeMigrationOptions = {},
): LegacyFdeHomeMigration {
  const userHome = options.userHome ?? os.homedir();
  const legacyHome = path.join(userHome, LEGACY_HOME_DIR_NAME);
  const staging = `${targetHome}${STAGING_SUFFIX}`;
  const log = options.log ?? (() => undefined);

  if (fs.existsSync(path.join(targetHome, PENDING_MARKER))) {
    return finishMigration(legacyHome, targetHome, options, log);
  }
  if (fs.existsSync(staging) && !fs.existsSync(legacyHome)) {
    fs.renameSync(staging, targetHome);
    return finishMigration(legacyHome, targetHome, options, log);
  }
  if (!isDirectory(legacyHome)) {
    return { status: "not-needed" };
  }
  if (fs.existsSync(targetHome) && !isEmptyDirectory(targetHome)) {
    return {
      status: "skipped",
      reason: `${targetHome} already exists; ${legacyHome} was left in place`,
    };
  }
  if (isLegacyDaemonRunning(legacyHome)) {
    return {
      status: "skipped",
      reason: `an FDE daemon is still running from ${legacyHome}; stop it and start again`,
    };
  }

  log(`Migrating ${legacyHome} to ${targetHome}`);
  if (fs.existsSync(targetHome)) fs.rmdirSync(targetHome);
  try {
    fs.renameSync(legacyHome, staging);
  } catch (error) {
    return {
      status: "skipped",
      reason: `could not move ${legacyHome}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  fs.writeFileSync(path.join(staging, PENDING_MARKER), `${legacyHome}\n`);
  fs.rmSync(path.join(staging, LEGACY_PID_FILE), { force: true });
  rewriteMetadata(staging, legacyHome, targetHome);
  fs.renameSync(staging, targetHome);
  return finishMigration(legacyHome, targetHome, options, log);
}

/** Steps that need the final path to exist. Each one is idempotent. */
function finishMigration(
  legacyHome: string,
  targetHome: string,
  options: LegacyFdeMigrationOptions,
  log: (message: string) => void,
): LegacyFdeHomeMigration {
  rewriteMetadata(targetHome, legacyHome, targetHome);
  renameAgentProjectDirs(path.join(targetHome, "agents"), legacyHome, targetHome);
  const worktrees = listWorktrees(path.join(targetHome, "worktrees"));
  let worktreesRepaired = 0;
  for (const worktree of worktrees) {
    try {
      execFileSync("git", ["-C", worktree, "worktree", "repair"], { stdio: "ignore" });
      worktreesRepaired += 1;
    } catch {
      log(`Could not repair git worktree ${worktree}; run "git worktree repair" inside it`);
    }
    moveClaudeProjectDir(
      worktree.replace(targetHome, legacyHome),
      worktree,
      options.claudeConfigDir,
    );
  }
  fs.rmSync(path.join(targetHome, PENDING_MARKER), { force: true });
  log(`Migrated ${legacyHome} to ${targetHome} (${worktreesRepaired} worktrees repaired)`);
  return { status: "migrated", from: legacyHome, to: targetHome, worktreesRepaired };
}

function rewriteMetadata(root: string, legacyHome: string, targetHome: string): void {
  const replacements = [
    ...pathReplacements(legacyHome, targetHome),
    ...RENAMED_KEYS.map(([from, to]) => ({ pattern: new RegExp(from, "g"), to })),
  ];
  for (const file of walkMetadataFiles(root)) {
    const original = fs.readFileSync(file, "utf8");
    let next = original;
    for (const { pattern, to } of replacements) next = next.replace(pattern, to);
    if (next !== original) fs.writeFileSync(file, next);
  }
}

/** Matches the legacy home as written raw and JSON-escaped, only at a path boundary. */
function pathReplacements(legacyHome: string, targetHome: string) {
  const forms = [
    [legacyHome, targetHome],
    [JSON.stringify(legacyHome).slice(1, -1), JSON.stringify(targetHome).slice(1, -1)],
  ];
  const unique = new Map(forms.map(([from, to]) => [from, to]));
  return [...unique].map(([from, to]) => ({
    pattern: new RegExp(`${escapeRegExp(from)}(?=[\\\\/"]|$)`, "gm"),
    to,
  }));
}

function* walkMetadataFiles(root: string, depth = 0): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (depth === 0 && SKIPPED_TOP_LEVEL.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkMetadataFiles(full, depth + 1);
    } else if (
      entry.isFile() &&
      REWRITTEN_EXTENSIONS.has(path.extname(entry.name)) &&
      fs.statSync(full).size <= MAX_REWRITE_BYTES
    ) {
      yield full;
    }
  }
}

/** Agent records live in folders named after their cwd; move them to the new cwd's name. */
function renameAgentProjectDirs(agentsRoot: string, legacyHome: string, targetHome: string): void {
  const legacyPrefix = encodeAgentDirPrefix(legacyHome);
  const targetPrefix = encodeAgentDirPrefix(targetHome);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(agentsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isPrefixAtBoundary(entry.name, legacyPrefix)) continue;
    const from = path.join(agentsRoot, entry.name);
    const to = path.join(agentsRoot, targetPrefix + entry.name.slice(legacyPrefix.length));
    mergeDirectory(from, to);
  }
}

function encodeAgentDirPrefix(home: string): string {
  const { root } = path.win32.parse(home);
  const sanitizedRoot = root.replace(/[:\\/]+/g, "-").replace(/^-+|-+$/g, "");
  const rest = home.slice(root.length).replace(/[\\/]+/g, "-");
  return sanitizedRoot ? `${sanitizedRoot}-${rest}` : rest;
}

function isPrefixAtBoundary(name: string, prefix: string): boolean {
  return name === prefix || name.startsWith(`${prefix}-`);
}

/** Linked git worktrees sit at worktrees/<project>/<name> and carry a `.git` file. */
function listWorktrees(worktreesRoot: string): string[] {
  const found: string[] = [];
  for (const group of safeReaddir(worktreesRoot)) {
    const groupPath = path.join(worktreesRoot, group);
    for (const name of safeReaddir(groupPath)) {
      const candidate = path.join(groupPath, name);
      if (isFile(path.join(candidate, ".git"))) found.push(candidate);
    }
  }
  return found;
}

/** Claude Code keys sessions by cwd, so resuming an agent needs its transcripts moved too. */
function moveClaudeProjectDir(legacyCwd: string, cwd: string, configDir?: string): void {
  const from = claudeProjectDirSync(legacyCwd, { configDir });
  const to = claudeProjectDirSync(cwd, { configDir });
  if (from !== to && isDirectory(from)) mergeDirectory(from, to);
}

function mergeDirectory(from: string, to: string): void {
  if (!fs.existsSync(to)) {
    fs.renameSync(from, to);
    return;
  }
  for (const name of safeReaddir(from)) {
    const source = path.join(from, name);
    const destination = path.join(to, name);
    if (fs.existsSync(destination)) continue;
    fs.renameSync(source, destination);
  }
  if (safeReaddir(from).length === 0) fs.rmdirSync(from);
}

function isLegacyDaemonRunning(legacyHome: string): boolean {
  const pidPath = path.join(legacyHome, LEGACY_PID_FILE);
  try {
    const stat = fs.statSync(pidPath);
    if (stat.mtimeMs < Date.now() - PID_LOCK_STALE_MS) return false;
    const { pid } = JSON.parse(fs.readFileSync(pidPath, "utf8")) as { pid?: unknown };
    if (typeof pid !== "number" || pid === process.pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export interface LegacyFdeSetting {
  source: string;
  name: string;
  replacement: string;
}

/**
 * FDE_ variables are no longer read. Reports them from the environment and from service
 * definitions left by an FDE install so the user can rename them.
 */
export function findLegacyFdeSettings(
  env: NodeJS.ProcessEnv = process.env,
  options: { userHome?: string } = {},
): LegacyFdeSetting[] {
  const settings: LegacyFdeSetting[] = [];
  for (const name of Object.keys(env).sort()) {
    if (name.startsWith(LEGACY_ENV_PREFIX) && env[name] !== undefined) {
      settings.push({ source: "environment", name, replacement: toFroggName(name) });
    }
  }
  const userHome = options.userHome ?? os.homedir();
  const serviceFiles = [
    path.join(userHome, ".config", "systemd", "user", "fde-daemon.service"),
    path.join(userHome, "Library", "LaunchAgents", "app.frogg.fde-daemon.plist"),
  ];
  for (const file of serviceFiles) {
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const names = new Set(contents.match(/\bFDE_[A-Z0-9_]+/g) ?? []);
    for (const name of [...names].sort()) {
      settings.push({ source: file, name, replacement: toFroggName(name) });
    }
  }
  return settings;
}

export function formatLegacyFdeSettings(settings: LegacyFdeSetting[]): string | null {
  if (settings.length === 0) return null;
  const lines = settings.map(
    (setting) => `  ${setting.name} -> ${setting.replacement} (${setting.source})`,
  );
  return [
    "FDE settings are no longer read. Rename them and remove the old FDE service:",
    ...lines,
  ].join("\n");
}

function toFroggName(name: string): string {
  return `FROGG_${name.slice(LEGACY_ENV_PREFIX.length)}`;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target: string): boolean {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function isEmptyDirectory(target: string): boolean {
  return isDirectory(target) && safeReaddir(target).length === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
