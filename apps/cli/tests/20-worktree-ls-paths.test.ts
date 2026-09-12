#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveFdeHomePath, resolveFdeWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalFdeHome = process.env.FDE_HOME;

try {
  {
    console.log("Test 1: resolves explicit FDE_HOME when set");
    process.env.FDE_HOME = "/tmp/fde-explicit-home";

    assert.strictEqual(resolveFdeHomePath(), "/tmp/fde-explicit-home");
    assert.strictEqual(resolveFdeWorktreesDir(), "/tmp/fde-explicit-home/worktrees");
    console.log("\u2713 explicit FDE_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.fde when FDE_HOME is unset");
    delete process.env.FDE_HOME;

    assert.strictEqual(resolveFdeHomePath(), join(homedir(), ".fde"));
    assert.strictEqual(resolveFdeWorktreesDir(), join(homedir(), ".fde", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalFdeHome === undefined) {
    delete process.env.FDE_HOME;
  } else {
    process.env.FDE_HOME = originalFdeHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
