import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";

/** Commands moved under `fde agent`; look them up there. */
function agentCommand(name: string) {
  const agent = createCli().commands.find((command) => command.name() === "agent");
  return agent?.commands.find((command) => command.name() === name);
}

describe("canonical CLI surface", () => {
  it("lists namespaces separately from plain commands", () => {
    // `helpInformation()` renders commander's own sections only; the groups
    // section is appended via addHelpText, so assert the split by checking that
    // namespaces are absent from the flat list and lifecycle verbs are present.
    const help = createCli().helpInformation();
    for (const name of ["start", "stop", "restart", "status", "update", "onboard"]) {
      expect(help).toContain(name);
    }
    for (const name of ["agent", "auth", "workspace", "project", "plugin", "schedule"]) {
      expect(help).not.toContain(`  ${name} `);
    }
    expect(help).not.toContain("worktree");
  });

  it("keeps agent commands in one place instead of duplicating them at the root", () => {
    const cli = createCli();
    const rootNames = cli.commands.filter((c) => !("_hidden" in c)).map((c) => c.name());
    // These used to exist at the root and under `fde agent` simultaneously.
    for (const name of ["ls", "run", "send", "inspect", "wait", "archive", "attach", "logs"]) {
      expect(rootNames).not.toContain(name);
      expect(agentCommand(name), `agent ${name} should exist`).toBeDefined();
    }
  });

  it("drops commands the client owns", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).not.toContain("clone");
    expect(names).not.toContain("import");
    expect(names).not.toContain("speech");
    expect(agentCommand("import")).toBeUndefined();
    expect(agentCommand("open")).toBeUndefined();
  });

  it("nests heartbeats under agent, where they are scoped", () => {
    const cli = createCli();
    expect(cli.commands.map((command) => command.name())).not.toContain("heartbeat");
    expect(agentCommand("heartbeat")).toBeDefined();
  });

  it("keeps hooks working but out of the help output", () => {
    const cli = createCli();
    // The agent hook installer shells out to it, so it must still parse.
    expect(cli.commands.find((command) => command.name() === "hooks")).toBeDefined();
    expect(cli.helpInformation()).not.toContain("hooks");
  });

  it("puts pairing and access under auth rather than the root", () => {
    const cli = createCli();
    const auth = cli.commands.find((command) => command.name() === "auth");
    expect(auth?.commands.map((command) => command.name()).sort()).toEqual([
      "claim-status",
      "pair",
      "reset-claim",
      "set-password",
      "trust-lan",
    ]);
    expect(cli.commands.map((command) => command.name())).not.toContain("pair");
  });

  it("promotes daemon lifecycle to the root, with no daemon namespace left", () => {
    const cli = createCli();
    const names = cli.commands.map((command) => command.name());
    expect(names).not.toContain("daemon");
    // `self-update` said the same thing twice; it is just `update` now.
    expect(names).toContain("update");
    expect(names).not.toContain("self-update");

    const reload = cli.commands.find((command) => command.name() === "reload");
    expect(reload?.helpInformation()).toContain("--host <host>");
    expect(reload?.helpInformation()).toContain("--json");
  });

  it("names explicit workspace creation without exposing older syntax", () => {
    const help = agentCommand("run")?.helpInformation();
    expect(help).toContain("--new-workspace <local|worktree>");
    expect(help).not.toContain("--isolation");
    expect(help).not.toContain("--worktree <name>");
  });

  it("offers the worktree creation options on run", () => {
    const help = agentCommand("run")?.helpInformation();
    expect(help).toContain("--worktree-mode <mode>");
    expect(help).toContain("--worktree-slug <slug>");
    expect(help).toContain("--new-branch <name>");
    expect(help).toContain("--branch <name>");
    expect(help).toContain("--pr-number <n>");
    expect(help).toContain("--forge <forge>");
  });

  it("uses background for execution and reserves detach for ownership", () => {
    const run = agentCommand("run");
    expect(run?.helpInformation()).toContain("--background");
    expect(run?.helpInformation()).not.toContain("--detach");
  });

  it("offers thinking configuration when running, updating, and scheduling agents", () => {
    const cli = createCli();
    const run = agentCommand("run");
    const update = agentCommand("update");
    const schedule = cli.commands.find((command) => command.name() === "schedule");
    const scheduleCreate = schedule?.commands.find((command) => command.name() === "create");

    expect(run?.helpInformation()).toContain("--thinking <id>");
    expect(update?.helpInformation()).toContain("--thinking <id>");
    expect(scheduleCreate?.helpInformation()).toContain("--thinking <id>");
  });

  it("offers the complete local plugin lifecycle", () => {
    const plugin = createCli().commands.find((command) => command.name() === "plugin");

    expect(plugin?.commands.map((command) => command.name())).toEqual([
      "init",
      "ls",
      "logs",
      "install",
      "status",
      "update",
      "reload",
      "enable",
      "disable",
      "remove",
    ]);
    expect(
      plugin?.commands.find((command) => command.name() === "init")?.helpInformation(),
    ).toContain("--id <id>");
    expect(
      plugin?.commands.find((command) => command.name() === "install")?.helpInformation(),
    ).toContain("--id <id>");
  });
});
