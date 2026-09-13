import { brand } from "@frogg/branding";
import { Command, Option } from "commander";
import chalk from "chalk";
import { prepareFroggHome } from "@frogg/server";
import {
  resolveLocalDaemonDiagnosticState,
  startLocalDaemonForeground,
  startLocalDaemonDetached,
  type DaemonStartOptions as StartOptions,
} from "./local-daemon.js";
import { getErrorMessage } from "../../utils/errors.js";

export type { DaemonStartOptions as StartOptions } from "./local-daemon.js";

type RawStartCommandOptions = StartOptions & {
  allowedHosts?: string;
};

export function startCommand(): Command {
  return new Command("start")
    .description(`Start the local ${brand.name} daemon`)
    .option("--listen <listen>", "Listen target (host:port, port, or unix socket path)")
    .option("--port <port>", `Port to listen on (default: ${brand.daemonPort})`)
    .option("--home <path>", `${brand.name} home directory (default: ~/${brand.homeDir})`)
    .option("--foreground", "Run in foreground (don't daemonize)")
    .option("--relay", "Enable relay connection")
    .option("--no-relay", "Disable relay connection")
    .option("--relay-use-tls", "Use wss:// for the relay connection and pairing offers")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option("--no-inject-mcp", `Disable auto-injecting the ${brand.name} MCP into created agents`)
    .option("--web-ui", "Enable the bundled daemon web UI")
    .option("--no-web-ui", "Disable the bundled daemon web UI")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(async (options: RawStartCommandOptions) => {
      await runStart({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

export interface StartRuntime {
  resolveState(options: {
    home?: string;
  }): Pick<ReturnType<typeof resolveLocalDaemonDiagnosticState>, "running" | "pidInfo">;
  startDetached: typeof startLocalDaemonDetached;
  startForeground: typeof startLocalDaemonForeground;
  prepareHome?(options: { home?: string }): void;
  log(message: string): void;
  error(message: string): void;
  exit(code: number): never;
}

const defaultRuntime: StartRuntime = {
  resolveState: resolveLocalDaemonDiagnosticState,
  startDetached: startLocalDaemonDetached,
  startForeground: startLocalDaemonForeground,
  prepareHome: (options) => {
    if (!options.home) prepareFroggHome();
  },
  log: console.log,
  error: console.error,
  exit: process.exit,
};

export async function runStart(
  options: StartOptions,
  runtime: StartRuntime = defaultRuntime,
): Promise<void> {
  if (options.listen && options.port) {
    runtime.error(chalk.red("Cannot use --listen and --port together"));
    runtime.exit(1);
  }

  runtime.prepareHome?.({ home: options.home });
  if (reportAlreadyRunning(options, runtime)) return;

  if (!options.foreground) {
    try {
      const startup = await runtime.startDetached(options);
      runtime.log(chalk.green(`Daemon starting in background (PID ${startup.pid ?? "unknown"}).`));
      runtime.log(chalk.dim(`Logs: ${startup.logPath}`));
    } catch (err) {
      // Another start may win the race after the initial check.
      if (reportAlreadyRunning(options, runtime)) return;
      exitWithError(getErrorMessage(err), runtime);
    }
    return;
  }
  try {
    const status = runtime.startForeground(options);
    if (status !== 0 && reportAlreadyRunning(options, runtime)) return;
    runtime.exit(status);
  } catch (err) {
    const message = getErrorMessage(err);
    exitWithError(`Failed to start daemon: ${message}`, runtime);
  }
}

function reportAlreadyRunning(options: StartOptions, runtime: StartRuntime): boolean {
  const state = runtime.resolveState({ home: options.home });
  if (!state.running || !state.pidInfo) return false;
  runtime.log(`Daemon already running (PID ${state.pidInfo.pid}).`);
  return true;
}

function exitWithError(message: string, runtime: StartRuntime): never {
  runtime.error(chalk.red(message));
  runtime.exit(1);
}
