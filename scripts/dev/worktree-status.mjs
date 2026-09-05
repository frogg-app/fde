#!/usr/bin/env node
// What every worktree is holding, in one screen. Written for recovering after a session
// restart kills background agents mid-run: for each worktree it answers "what did it commit
// that is not on the base branch" and "what is still uncommitted".
//
//   node scripts/dev/worktree-status.mjs                 every worktree
//   node scripts/dev/worktree-status.mjs 'companion/*'   only matching paths
//   node scripts/dev/worktree-status.mjs --base main     compare against an explicit ref
//   node scripts/dev/worktree-status.mjs --json          machine-readable
//
// Exits non-zero only when git itself fails, never because work is outstanding, so it is safe
// in a pipeline.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Paths that are churn rather than work: generated output, dependency trees and local service
// state. `.wrangler` matters most - it is tracked, so it shows up as modified on every worktree
// that ran the relay and buries the real diff.
const NOISE = [
  /(^|\/)node_modules(\/|$)/u,
  /(^|\/)\.wrangler(\/|$)/u,
  /(^|\/)dist(\/|$)/u,
  /(^|\/)build(\/|$)/u,
  /(^|\/)target(\/|$)/u,
  /(^|\/)release(\/|$)/u,
  /(^|\/)coverage(\/|$)/u,
  /(^|\/)test-results(\/|$)/u,
  /(^|\/)\.expo(\/|$)/u,
  /(^|\/)\.dev(\/|$)/u,
  /(^|\/)\.tmp(\/|$)/u,
  /(^|\/)\.plugin-scaffold-/u,
  /\.tsbuildinfo$/u,
  /\.log$/u,
];

const USAGE = `usage: node scripts/dev/worktree-status.mjs [path-filter...] [--base <ref>] [--json]

  path-filter   substring or glob matched against the worktree path
  --base <ref>  compare against this ref (default: the branch upstream, else main)
  --json        emit the same report as JSON`;

const NUL = String.fromCharCode(0);

export function isNoise(file) {
  return NOISE.some((pattern) => pattern.test(file));
}

function git(directory, args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(directory, args) {
  try {
    return git(directory, args).trim();
  } catch {
    return null;
  }
}

export function parseArgs(argv) {
  const filters = [];
  let base = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { filters, base, json, help: true };
    if (arg === "--json") json = true;
    else if (arg === "--base") {
      index += 1;
      base = argv[index];
    } else if (arg.startsWith("--base=")) base = arg.slice("--base=".length);
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else filters.push(arg);
  }
  if (base !== null && (base === undefined || base.length === 0)) {
    throw new Error("--base needs a ref");
  }
  return { filters, base, json, help: false };
}

export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  const body = escaped
    .split("**")
    .map((part) => part.split("*").join("[^/]*"))
    .join(".*");
  return new RegExp(body, "u");
}

function matchesFilter(worktreePath, filters) {
  if (filters.length === 0) return true;
  return filters.some(
    (filter) => worktreePath.includes(filter) || globToRegExp(filter).test(worktreePath),
  );
}

export function listWorktrees(directory) {
  const worktrees = [];
  let current = null;
  for (const line of git(directory, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null, detached: false };
      worktrees.push(current);
    } else if (line.startsWith("branch ") && current !== null) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (line === "detached" && current !== null) {
      current.detached = true;
    }
  }
  return worktrees;
}

function resolveBase(worktree, requested) {
  if (requested !== null) return requested;
  const upstream = tryGit(worktree.path, [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream !== null && upstream.length > 0) return upstream;
  return "main";
}

export function collect(worktree, requestedBase) {
  const base = resolveBase(worktree, requestedBase);
  const counts = tryGit(worktree.path, ["rev-list", "--left-right", "--count", `${base}...HEAD`]);
  const [behind, ahead] = counts === null ? [0, 0] : counts.split(/\s+/u).map(Number);
  const commits =
    counts === null
      ? []
      : git(worktree.path, ["log", "--format=%h %s", `${base}..HEAD`])
          .split("\n")
          .filter((line) => line.length > 0);

  const modified = [];
  const untracked = [];
  let hiddenNoise = 0;
  const status = git(worktree.path, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]);
  for (const entry of status.split(NUL)) {
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (isNoise(file)) {
      hiddenNoise += 1;
      continue;
    }
    if (code === "??") untracked.push(file);
    else modified.push({ code: code.trim(), file });
  }

  return {
    path: worktree.path,
    branch: worktree.detached ? "(detached)" : (worktree.branch ?? "(no branch)"),
    base,
    baseMissing: counts === null,
    ahead,
    behind,
    commits,
    modified,
    untracked,
    hiddenNoise,
  };
}

function print(report) {
  const dirty = report.modified.length + report.untracked.length > 0;
  const flags = [
    report.ahead > 0 ? "AHEAD" : null,
    dirty ? "UNCOMMITTED" : null,
    report.baseMissing ? "BASE-MISSING" : null,
  ].filter((flag) => flag !== null);
  console.log(`${report.path}  [${flags.length > 0 ? flags.join(" ") : "clean"}]`);
  console.log(
    `  branch ${report.branch}  base ${report.base}  ahead ${report.ahead}  behind ${report.behind}`,
  );
  for (const commit of report.commits) console.log(`    + ${commit}`);
  if (report.modified.length > 0) {
    console.log(`  modified (${report.modified.length}):`);
    for (const change of report.modified)
      console.log(`    ${change.code.padEnd(2)} ${change.file}`);
  }
  if (report.untracked.length > 0) {
    console.log(`  untracked (${report.untracked.length}):`);
    for (const file of report.untracked) console.log(`    ?  ${file}`);
  }
  if (report.hiddenNoise > 0) {
    console.log(`  (${report.hiddenNoise} generated/state paths hidden)`);
  }
  console.log("");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const worktrees = listWorktrees(process.cwd()).filter((worktree) =>
    matchesFilter(worktree.path, options.filters),
  );
  const reports = worktrees.map((worktree) => collect(worktree, options.base));

  if (options.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }
  if (reports.length === 0) {
    console.log("No worktrees matched.");
    return;
  }
  for (const report of reports) print(report);
  const outstanding = reports.filter(
    (report) => report.ahead > 0 || report.modified.length + report.untracked.length > 0,
  );
  const names = outstanding.map((report) => report.branch).join(", ");
  console.log(
    `${reports.length} worktree(s), ${outstanding.length} with outstanding work${names.length > 0 ? `: ${names}` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`worktree-status: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
