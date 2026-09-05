import { Command } from "commander";
import { createAgentCommand } from "./commands/agent/index.js";
import { addDaemonLifecycleCommands, createAuthCommand } from "./commands/daemon/index.js";
import { createPermissionsCommand } from "./commands/permissions/index.js";
import { createProviderCommand } from "./commands/provider/index.js";
import { createPluginCommand } from "./commands/plugin/index.js";
import { createProjectCommand } from "./commands/project/index.js";
import { createScheduleCommand } from "./commands/schedule/index.js";
import { createScriptCommand } from "./commands/script/index.js";
import { createTerminalCommand } from "./commands/terminal/index.js";
import { createWorktreeCommand } from "./commands/worktree/index.js";
import { createWorkspaceCommand } from "./commands/workspace/index.js";
import { createTriggerCommand } from "./commands/trigger/index.js";
import { createHooksCommand } from "./commands/hooks.js";
import { onboardCommand } from "./commands/onboard.js";
import { resolveCliVersion } from "./version.js";
import { addCommandGroup, addCommandGroupsHelp } from "./help-sections.js";

const VERSION = resolveCliVersion();

export function createCli(): Command {
  const program = new Command();

  program
    .name("fde")
    .description(
      "FDE (Frogg Development Environment) CLI - control your AI coding agents from the command line",
    )
    .version(VERSION, "-v, --version", "output the version number")
    // Global output options
    .option("-o, --format <format>", "output format: table, json, yaml", "table")
    .option("--json", "output in JSON format (alias for --format json)")
    .option("-q, --quiet", "minimal output (IDs only)")
    .option("--no-headers", "omit table headers")
    .option("--no-color", "disable colored output");

  // First run: set up, start the daemon, print pairing instructions.
  program.addCommand(onboardCommand());

  // The daemon's own lifecycle, at the root: this binary is the daemon.
  addDaemonLifecycleCommands(program);

  // Called by the agent hook installer as a shell command, never typed by a
  // person, so it stays functional but out of the help output.
  program.addCommand(createHooksCommand(), { hidden: true });

  // Namespaces, rendered in their own help section below the plain commands.
  const groups: Command[] = [];

  // Agents. These used to be duplicated at the root as well, which doubled the
  // length of the root menu and let the two copies drift apart.
  groups.push(createAgentCommand());

  // Pairing and access control.
  groups.push(createAuthCommand());

  groups.push(createTriggerCommand());

  groups.push(createTerminalCommand());
  groups.push(createScriptCommand());
  groups.push(createScheduleCommand());
  groups.push(createPermissionsCommand());
  groups.push(createProviderCommand());
  groups.push(createPluginCommand());
  groups.push(createProjectCommand());
  groups.push(createWorkspaceCommand());
  // COMPAT(worktreeCli): legacy command alias added before workspace was the product unit.
  // Added in v0.2.0; remove after 2027-01-17.
  program.addCommand(createWorktreeCommand(), { hidden: true });

  for (const group of groups) addCommandGroup(program, group);
  addCommandGroupsHelp(program, groups);

  return program;
}
