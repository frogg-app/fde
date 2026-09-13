import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { claudeProjectDirSync } from "./agent/providers/claude/project-dir.js";
import {
  findLegacyFdeSettings,
  formatLegacyFdeSettings,
  migrateLegacyFdeHome,
} from "./legacy-fde-migration.js";

const roots: string[] = [];
function scratch(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "legacy-fde-")));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

function encodeAgentDir(cwd: string): string {
  return cwd.slice(1).replace(/[\\/]+/g, "-");
}

describe.skipIf(process.platform === "win32")("migrateLegacyFdeHome", () => {
  test("moves the home and rewrites paths, keys, agent folders, worktrees and Claude sessions", () => {
    const userHome = scratch();
    const legacyHome = path.join(userHome, ".fde");
    const targetHome = path.join(userHome, ".frogg");
    const claudeConfigDir = path.join(userHome, ".claude");

    const repo = path.join(userHome, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "i",
    );
    const legacyWorktree = path.join(legacyHome, "worktrees", "abc", "quick-gecko");
    mkdirSync(path.dirname(legacyWorktree), { recursive: true });
    git(repo, "worktree", "add", "-q", "-b", "gecko", legacyWorktree);

    writeJson(path.join(legacyHome, "projects", "workspaces.json"), [
      { cwd: legacyWorktree, worktreeRoot: legacyWorktree, isFdeOwnedWorktree: true },
      { cwd: `${legacyHome}-other`, isFdeOwnedWorktree: false },
    ]);
    writeJson(path.join(legacyHome, "agents", encodeAgentDir(legacyWorktree), "a1.json"), {
      id: "a1",
      cwd: legacyWorktree,
    });
    writeFileSync(path.join(legacyHome, "fde.pid"), JSON.stringify({ pid: 999_999_999 }));
    const legacyClaudeDir = claudeProjectDirSync(legacyWorktree, { configDir: claudeConfigDir });
    mkdirSync(legacyClaudeDir, { recursive: true });
    writeFileSync(path.join(legacyClaudeDir, "session.jsonl"), "{}\n");

    const result = migrateLegacyFdeHome(targetHome, { userHome, claudeConfigDir });

    const worktree = path.join(targetHome, "worktrees", "abc", "quick-gecko");
    expect(result).toEqual({
      status: "migrated",
      from: legacyHome,
      to: targetHome,
      worktreesRepaired: 1,
    });
    expect(existsSync(legacyHome)).toBe(false);
    expect(existsSync(path.join(targetHome, "fde.pid"))).toBe(false);
    expect(existsSync(path.join(targetHome, ".fde-migration-pending"))).toBe(false);
    expect(
      JSON.parse(readFileSync(path.join(targetHome, "projects", "workspaces.json"), "utf8")),
    ).toEqual([
      { cwd: worktree, worktreeRoot: worktree, isFroggOwnedWorktree: true },
      { cwd: `${legacyHome}-other`, isFroggOwnedWorktree: false },
    ]);
    const agentFile = path.join(targetHome, "agents", encodeAgentDir(worktree), "a1.json");
    expect(JSON.parse(readFileSync(agentFile, "utf8")).cwd).toBe(worktree);
    expect(git(worktree, "rev-parse", "--abbrev-ref", "HEAD")).toBe("gecko");
    expect(git(repo, "worktree", "list", "--porcelain")).toContain(`worktree ${worktree}`);
    const claudeDir = claudeProjectDirSync(worktree, { configDir: claudeConfigDir });
    expect(existsSync(path.join(claudeDir, "session.jsonl"))).toBe(true);
    expect(existsSync(legacyClaudeDir)).toBe(false);
  });

  test("is not needed without a legacy home", () => {
    const userHome = scratch();
    expect(migrateLegacyFdeHome(path.join(userHome, ".frogg"), { userHome })).toEqual({
      status: "not-needed",
    });
  });

  test("replaces an empty target directory", () => {
    const userHome = scratch();
    writeJson(path.join(userHome, ".fde", "config.json"), {});
    mkdirSync(path.join(userHome, ".frogg"));
    const result = migrateLegacyFdeHome(path.join(userHome, ".frogg"), { userHome });
    expect(result.status).toBe("migrated");
    expect(existsSync(path.join(userHome, ".frogg", "config.json"))).toBe(true);
  });

  test("leaves both homes alone when the target already has data", () => {
    const userHome = scratch();
    writeJson(path.join(userHome, ".fde", "config.json"), {});
    writeJson(path.join(userHome, ".frogg", "config.json"), {});
    const result = migrateLegacyFdeHome(path.join(userHome, ".frogg"), { userHome });
    expect(result.status).toBe("skipped");
    expect(existsSync(path.join(userHome, ".fde", "config.json"))).toBe(true);
  });

  test("waits for a running FDE daemon to stop", () => {
    const userHome = scratch();
    writeJson(path.join(userHome, ".fde", "fde.pid"), { pid: process.ppid });
    const result = migrateLegacyFdeHome(path.join(userHome, ".frogg"), { userHome });
    expect(result).toMatchObject({ status: "skipped" });
    expect(existsSync(path.join(userHome, ".fde"))).toBe(true);
  });

  test("finishes a migration interrupted after the move", () => {
    const userHome = scratch();
    const targetHome = path.join(userHome, ".frogg");
    writeJson(path.join(`${targetHome}.migrating`, "projects", "projects.json"), [
      { root: path.join(userHome, ".fde", "worktrees") },
    ]);
    writeFileSync(path.join(`${targetHome}.migrating`, ".fde-migration-pending"), "");
    const result = migrateLegacyFdeHome(targetHome, { userHome });
    expect(result.status).toBe("migrated");
    expect(
      JSON.parse(readFileSync(path.join(targetHome, "projects", "projects.json"), "utf8")),
    ).toEqual([{ root: path.join(targetHome, "worktrees") }]);
  });
});

describe("findLegacyFdeSettings", () => {
  test("reports FDE_ variables from the environment and an old systemd unit", () => {
    const userHome = scratch();
    const unit = path.join(userHome, ".config", "systemd", "user", "fde-daemon.service");
    mkdirSync(path.dirname(unit), { recursive: true });
    writeFileSync(unit, "[Service]\nEnvironment=FDE_LISTEN=0.0.0.0:9999\nEnvironment=PATH=/bin\n");

    const settings = findLegacyFdeSettings({ FDE_HOME: "/x", FROGG_PORT: "1" }, { userHome });

    expect(settings).toEqual([
      { source: "environment", name: "FDE_HOME", replacement: "FROGG_HOME" },
      { source: unit, name: "FDE_LISTEN", replacement: "FROGG_LISTEN" },
    ]);
    expect(formatLegacyFdeSettings(settings)).toContain("FDE_LISTEN -> FROGG_LISTEN");
    expect(formatLegacyFdeSettings([])).toBeNull();
  });
});
