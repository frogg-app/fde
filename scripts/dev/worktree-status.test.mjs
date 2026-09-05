import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { collect, globToRegExp, isNoise, listWorktrees, parseArgs } from "./worktree-status.mjs";

function git(directory, ...args) {
  execFileSync("git", ["-C", directory, ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "worktree-status-"));
  const main = path.join(root, "main");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "test@example.com");
  git(main, "config", "user.name", "Test");
  writeFileSync(path.join(main, "README.md"), "base\n");
  git(main, "add", "-A");
  git(main, "commit", "-qm", "base");
  return { root, main };
}

test("noise patterns cover generated output and local service state", () => {
  for (const file of [
    "node_modules",
    "apps/ui/node_modules/react/index.js",
    "packages/relay/.wrangler/state/v3/cache/metadata.sqlite-shm",
    "apps/cli/dist/index.js",
    "apps/cli/.plugin-scaffold-1iJvZE/index.ts",
    "packages/server/tsconfig.tsbuildinfo",
  ]) {
    assert.equal(isNoise(file), true, file);
  }
  for (const file of ["apps/ui/src/companion/host.tsx", "scripts/dev/worktree-status.mjs"]) {
    assert.equal(isNoise(file), false, file);
  }
});

test("arguments split into filters, base and json", () => {
  assert.deepEqual(parseArgs(["companion/*", "--base", "main", "--json"]), {
    filters: ["companion/*"],
    base: "main",
    json: true,
    help: false,
  });
  assert.deepEqual(parseArgs([]), { filters: [], base: null, json: false, help: false });
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/u);
});

test("glob filters match path segments", () => {
  assert.equal(globToRegExp("companion/*").test("/home/x/companion/protocol"), true);
  assert.equal(globToRegExp("companion/*").test("/home/x/other/protocol"), false);
});

test("reports commits ahead and uncommitted work without the noise", (t) => {
  const { root, main } = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const feature = path.join(root, "feature");
  git(main, "worktree", "add", "-q", "-b", "feature", feature, "main");
  writeFileSync(path.join(feature, "work.txt"), "one\n");
  git(feature, "add", "-A");
  git(feature, "commit", "-qm", "do the work");
  writeFileSync(path.join(feature, "README.md"), "changed\n");
  writeFileSync(path.join(feature, "scratch.txt"), "new\n");
  mkdirSync(path.join(feature, "dist"));
  writeFileSync(path.join(feature, "dist", "bundle.js"), "generated\n");

  const worktrees = listWorktrees(main);
  assert.deepEqual(
    worktrees.map((worktree) => worktree.branch),
    ["main", "feature"],
  );

  const report = collect(
    worktrees.find((worktree) => worktree.branch === "feature"),
    "main",
  );
  assert.equal(report.ahead, 1);
  assert.equal(report.behind, 0);
  assert.deepEqual(
    report.commits.map((commit) => commit.split(" ").slice(1).join(" ")),
    ["do the work"],
  );
  assert.deepEqual(report.modified, [{ code: "M", file: "README.md" }]);
  assert.deepEqual(report.untracked, ["scratch.txt"]);
  assert.equal(report.hiddenNoise, 1);
});

test("a missing base is reported rather than thrown", (t) => {
  const { root, main } = makeRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const report = collect(listWorktrees(main)[0], "no-such-ref");
  assert.equal(report.baseMissing, true);
  assert.equal(report.ahead, 0);
});
