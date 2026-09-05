import { Command, Option } from "commander";
import { startCommand } from "./start.js";
import { runStatusCommand } from "./status.js";
import { runStopCommand } from "./stop.js";
import { runRestartCommand } from "./restart.js";
import { runSetPasswordCommand } from "./set-password.js";
import { runTrustLanCommand } from "./trust-lan.js";
import { pairCommand } from "./pair.js";
import { runDaemonReloadCommand } from "./reload.js";
import { runClaimStatusCommand, runResetClaimCommand } from "./claim.js";
import { selfUpdateCommand } from "./self-update/command.js";
import { runInstallServiceCommand, runUninstallServiceCommand } from "./service/command.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions, addJsonOption } from "../../utils/command-options.js";

function resolveHostnamesOption(hostnames: unknown, allowedHosts: unknown): string | undefined {
  if (typeof hostnames === "string") return hostnames;
  if (typeof allowedHosts === "string") return allowedHosts;
  return undefined;
}

/**
 * Daemon lifecycle, attached directly to the root.
 *
 * `fde` is the daemon's own binary, so `fde daemon start` said the same thing
 * twice. These are the verbs you reach for most and they now sit at the top
 * level; the pairing and access verbs live under `fde auth` instead.
 */
export function addDaemonLifecycleCommands(program: Command): Command {
  program.addCommand(startCommand());
  // Renamed from `self-update`: there is nothing else it could update.
  program.addCommand(selfUpdateCommand().name("update"));

  addJsonAndDaemonHostOptions(
    program.command("reload").description("Reload config.json without restarting the daemon"),
  ).action(withOutput(runDaemonReloadCommand));

  addJsonOption(program.command("status").description("Show local daemon status"))
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runStatusCommand));

  addJsonOption(program.command("stop").description("Stop the local daemon"))
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .option("--timeout <seconds>", "Wait timeout before failing (default: 15)")
    .option("--force", "Send SIGKILL if graceful stop times out")
    .option("--kill-timeout <seconds>", "Wait after SIGKILL before failing (default: 3)")
    .action(withOutput(runStopCommand));

  addJsonOption(program.command("restart").description("Restart the local daemon"))
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .option("--timeout <seconds>", "Wait timeout before force step (default: 15)")
    .option("--force", "Send SIGKILL if graceful stop times out")
    .option(
      "--listen <listen>",
      "Listen target for restarted daemon (host:port, port, or unix socket)",
    )
    .option("--port <port>", "Port for restarted daemon listen target")
    .option("--relay", "Enable relay on restarted daemon")
    .option("--no-relay", "Disable relay on restarted daemon")
    .option("--no-mcp", "Disable Agent MCP on restarted daemon")
    .option("--no-inject-mcp", "Disable auto-injecting the FDE MCP into created agents")
    .option("--web-ui", "Enable the bundled daemon web UI on restarted daemon")
    .option("--no-web-ui", "Disable the bundled daemon web UI on restarted daemon")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(
      withOutput((...args) => {
        const [options, command] = args.slice(-2) as [(typeof args)[number], Command];
        return runRestartCommand(
          {
            ...options,
            hostnames: resolveHostnamesOption(options.hostnames, options.allowedHosts),
          },
          command,
        );
      }),
    );

  addJsonOption(
    program
      .command("install-service")
      .description("Start the FDE daemon automatically when you log in"),
  )
    .option("--listen <listen>", "Listen target for the service (default: 127.0.0.1:9999)")
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runInstallServiceCommand));

  addJsonOption(
    program
      .command("uninstall-service")
      .description("Stop starting the FDE daemon when you log in"),
  )
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runUninstallServiceCommand));

  return program;
}

/**
 * Pairing and access control. Separated from lifecycle because these decide
 * *who may connect*, which is a different question from whether the daemon is
 * running - and because flattening all thirteen daemon commands to the root
 * would just move the bloat.
 */
export function createAuthCommand(): Command {
  const auth = new Command("auth").description("Manage pairing and daemon access");

  auth.addCommand(pairCommand());

  addJsonOption(
    auth
      .command("claim-status")
      .description("Show whether a device has paired with (claimed) this daemon"),
  )
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runClaimStatusCommand));

  addJsonOption(
    auth
      .command("reset-claim")
      .description("Forget all paired devices so the next LAN visitor sees the pairing page"),
  )
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runResetClaimCommand));

  addJsonOption(
    auth
      .command("set-password")
      .description("Prompt for and save a hashed daemon password to config.json"),
  )
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runSetPasswordCommand));

  addJsonOption(
    auth
      .command("trust-lan")
      .description(
        "on: private-network clients connect without pairing or a password (default); off: they must pair",
      )
      .argument("<mode>", "on or off"),
  )
    .option("--home <path>", "FDE home directory (default: ~/.fde)")
    .action(withOutput(runTrustLanCommand));

  return auth;
}
