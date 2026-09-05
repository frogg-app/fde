// Shared change detection for the staged-typecheck hook and `verify --changed`. One place
// decides what "changed" means and which workspaces a file set belongs to.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);

function gitLines(args) {
  return execFileSync("git", args, { cwd: repoRoot })
    .toString()
    .split("\n")
    .filter((line) => line.length > 0);
}

export function stagedFiles() {
  return gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
}

export function changedFiles(base) {
  const tracked = gitLines(["diff", "--name-only", "--diff-filter=ACMR", base]);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set([...tracked, ...untracked])];
}

export function defaultBase() {
  const candidates = ["origin/main", "main"];
  for (const candidate of candidates) {
    try {
      return gitLines(["merge-base", "HEAD", candidate])[0];
    } catch {
      continue;
    }
  }
  return "HEAD";
}

export function workspacesFor(files) {
  const names = new Set();
  for (const file of files) {
    const match = /^(apps|packages)\/([^/]+)\//u.exec(file);
    if (!match) continue;
    const manifest = path.join(repoRoot, match[1], match[2], "package.json");
    if (!existsSync(manifest)) continue;
    names.add(JSON.parse(readFileSync(manifest, "utf8")).name);
  }
  return names;
}

const workspaceDirs = new Map();
for (const group of ["apps", "packages"]) {
  for (const entry of readdirSync(path.join(repoRoot, group))) {
    const manifest = path.join(repoRoot, group, entry, "package.json");
    if (!existsSync(manifest)) continue;
    workspaceDirs.set(JSON.parse(readFileSync(manifest, "utf8")).name, path.join(group, entry));
  }
}

export function hasScript(workspace, script) {
  const dir = workspaceDirs.get(workspace);
  if (dir === undefined) return false;
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"));
  return Boolean(pkg.scripts?.[script]);
}
