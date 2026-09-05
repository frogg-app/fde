import { Command } from "commander";

/**
 * Triggers: external events (GitHub, Slack, Discord, Linear) that create a
 * workspace and run an agent on this daemon.
 *
 * Formerly `fde hub`. Renamed because "hub" named the server rather than the
 * feature - the domain vocabulary everywhere else is already "triggers".
 *
 * Every subcommand is disabled pending a rewrite. The previous implementation
 * defaulted to `https://hub.paseo.sh`, an upstream-hosted service this project
 * does not run, and enrolling pointed a third party at a standing connection
 * able to run coding agents against local repositories. The daemon-side
 * protocol (`packages/server/src/server/hub/`) and the old CLI implementation
 * (`apps/cli/src/commands/hub/`) are left in place for that rewrite; they are
 * simply not wired up.
 */

/** Named so `fde trigger --help` still documents the intended surface. */
const DISABLED_SUBCOMMANDS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "login", description: "Log in to a trigger service for CLI access" },
  { name: "init", description: "Scaffold triggers-as-code configuration" },
  { name: "connect", description: "Enroll this daemon with a trigger service" },
  { name: "status", description: "Show this daemon's trigger connection" },
  { name: "disconnect", description: "Disconnect this daemon from its trigger service" },
  { name: "permissions", description: "Manage what triggers may do on this daemon" },
  { name: "projects", description: "List projects for the authenticated account" },
  { name: "export", description: "Export active triggers as YAML" },
  { name: "deploy", description: "Validate and activate trigger configuration" },
  { name: "logout", description: "Remove the stored trigger service login" },
];

export const TRIGGERS_DISABLED_MESSAGE =
  "Triggers are disabled pending a rewrite.\n" +
  "\n" +
  "The previous implementation enrolled this daemon with an upstream-hosted\n" +
  "service (https://hub.paseo.sh) that could create workspaces and run agents\n" +
  "here. Nothing connects to it now.\n" +
  "\n" +
  'Track this at ROADMAP.md under "Triggers".';

function addDisabledSubcommand(parent: Command, spec: { name: string; description: string }): void {
  parent
    .command(spec.name)
    // Marked in the description too, so `--help` alone tells the whole story.
    .description(`${spec.description} (disabled)`)
    // Accept anything: a user pasting an old command should get the
    // explanation, not an argument-parsing error.
    .allowUnknownOption(true)
    .argument("[args...]")
    .action(() => {
      process.stderr.write(`${TRIGGERS_DISABLED_MESSAGE}\n`);
      process.exitCode = 1;
    });
}

export function createTriggerCommand(): Command {
  const trigger = new Command("trigger")
    .description("Run agents from external events (disabled pending rewrite)")
    // `hub` keeps working so existing scripts get the explanation rather than
    // "unknown command". Commander renders this as `trigger|hub` in help,
    // which also tells anyone looking for the old name where it went.
    .alias("hub");

  for (const spec of DISABLED_SUBCOMMANDS) {
    addDisabledSubcommand(trigger, spec);
  }

  trigger.action(() => {
    process.stderr.write(`${TRIGGERS_DISABLED_MESSAGE}\n`);
    process.exitCode = 1;
  });

  return trigger;
}
