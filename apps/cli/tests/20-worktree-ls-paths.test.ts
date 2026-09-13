#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveFroggHomePath, resolveFroggWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalFroggHome = process.env.FROGG_HOME;

try {
  {
    console.log("Test 1: resolves explicit FROGG_HOME when set");
    process.env.FROGG_HOME = "/tmp/frogg-explicit-home";

    assert.strictEqual(resolveFroggHomePath(), "/tmp/frogg-explicit-home");
    assert.strictEqual(resolveFroggWorktreesDir(), "/tmp/frogg-explicit-home/worktrees");
    console.log("\u2713 explicit FROGG_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.frogg when FROGG_HOME is unset");
    delete process.env.FROGG_HOME;

    assert.strictEqual(resolveFroggHomePath(), join(homedir(), ".frogg"));
    assert.strictEqual(resolveFroggWorktreesDir(), join(homedir(), ".frogg", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalFroggHome === undefined) {
    delete process.env.FROGG_HOME;
  } else {
    process.env.FROGG_HOME = originalFroggHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
