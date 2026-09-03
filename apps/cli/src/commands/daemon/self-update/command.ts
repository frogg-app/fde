import { Command, Option } from "commander";
import chalk from "chalk";
import { resolveCliVersion } from "../../../version.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { applyUpdate } from "./apply.js";
import { resolveInstallDir } from "./layout.js";
import type { UpdateChannel } from "./releases.js";
import { runSelfUpdate, type SelfUpdateProgress, type SelfUpdateResult } from "./run.js";
import { detectServiceManager } from "./service.js";

interface SelfUpdateCommandOptions {
  version?: string;
  channel?: string;
  check?: boolean;
  json?: boolean;
  wait?: boolean;
  home?: string;
  installDir?: string;
  verifyTimeout?: string;
  apply?: string;
  previous?: string;
  httpBase?: string;
}

function parseChannel(raw: string | undefined): UpdateChannel {
  if (raw === undefined || raw === "stable") return "stable";
  if (raw === "beta") return "beta";
  throw new Error(`invalid channel "${raw}" (expected stable or beta)`);
}

function exitCodeFor(status: SelfUpdateResult["status"]): number {
  if (status === "failed" || status === "not_updatable") return 1;
  if (status === "rolled_back") return 2;
  return 0;
}

function printHuman(result: SelfUpdateResult): void {
  const lines: string[] = [];
  switch (result.status) {
    case "check":
      lines.push(
        result.updateAvailable
          ? chalk.green(`update available: ${result.currentVersion} -> ${result.targetVersion}`)
          : chalk.dim(`daemon ${result.currentVersion} is up to date (${result.channel})`),
      );
      if (result.releaseUrl) lines.push(chalk.dim(result.releaseUrl));
      break;
    case "up_to_date":
      lines.push(chalk.dim(`daemon ${result.currentVersion} is up to date`));
      break;
    case "not_updatable":
      lines.push(chalk.yellow(`cannot self-update: ${result.reason}`));
      break;
    case "handoff":
      lines.push(chalk.green(`update to ${result.targetVersion} handed off; see ${result.installDir}/self-update.log`));
      break;
    case "applied":
      lines.push(chalk.green(`daemon updated: ${result.currentVersion} -> ${result.targetVersion}`));
      break;
    case "rolled_back":
      lines.push(chalk.yellow(`update to ${result.targetVersion} failed and was rolled back to ${result.currentVersion}`));
      if (result.reason) lines.push(chalk.dim(result.reason));
      break;
    case "failed":
      lines.push(chalk.red(`update to ${result.targetVersion} failed: ${result.reason ?? "unknown"}`));
      break;
  }
  console.log(lines.join("\n"));
}

async function runApply(options: SelfUpdateCommandOptions): Promise<number> {
  const version = options.apply as string;
  const installDir = options.installDir ?? resolveInstallDir();
  // Let the spawning process exit so this one is re-parented away from the
  // daemon's process tree before the daemon is stopped.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const service = detectServiceManager({
    installDir,
    home: options.home,
    listen: process.env.PASEO_LISTEN?.trim() || null,
    platform: process.platform,
  });
  const outcome = await applyUpdate(
    {
      installDir,
      version,
      previous: options.previous ?? null,
      httpBase: options.httpBase ?? null,
      verifyTimeoutMs: options.verifyTimeout ? Number(options.verifyTimeout) : undefined,
    },
    { service },
  );
  console.log(JSON.stringify(outcome));
  return outcome.status === "applied" ? 0 : outcome.status === "rolled_back" ? 2 : 1;
}

export async function runSelfUpdateCommand(options: SelfUpdateCommandOptions): Promise<void> {
  const json = options.json === true;
  try {
    if (options.apply) {
      process.exit(await runApply(options));
    }
    const emit = (event: SelfUpdateProgress) => {
      if (json) console.log(JSON.stringify(event));
      else console.log(chalk.dim(`[${event.phase}] ${event.message}`));
    };
    const result = await runSelfUpdate(
      {
        version: options.version,
        channel: parseChannel(options.channel),
        check: options.check === true,
        wait: options.wait !== false,
        home: options.home,
        installDir: options.installDir,
        verifyTimeoutMs: options.verifyTimeout ? Number(options.verifyTimeout) : undefined,
      },
      {
        env: process.env,
        cliVersion: resolveCliVersion(),
        execPath: process.execPath,
        cliEntry: process.argv[1] as string,
        platform: process.platform,
        emit,
      },
    );
    if (json) console.log(JSON.stringify(result));
    else printHuman(result);
    process.exit(exitCodeFor(result.status));
  } catch (error) {
    const message = getErrorMessage(error);
    if (json) console.log(JSON.stringify({ event: "result", status: "failed", reason: message }));
    else console.error(chalk.red(`self-update failed: ${message}`));
    process.exit(1);
  }
}

export function selfUpdateCommand(): Command {
  return new Command("self-update")
    .description("Update a versioned daemon install from GitHub releases, with automatic rollback")
    .option("--version <version>", "Install this exact release instead of the newest one")
    .option("--channel <channel>", "Release channel: stable (default) or beta")
    .option("--check", "Only report whether an update is available")
    .option("--json", "Output progress and the result as JSON lines")
    .option("--no-wait", "Return after handing off to the supervisor instead of waiting for the outcome")
    .option("--home <path>", "Paseo home directory (default: ~/.paseo)")
    .option("--install-dir <dir>", "Install root (default: $FDE_INSTALL_DIR or ~/.local/share/fde)")
    .option("--verify-timeout <ms>", "How long to wait for the restarted daemon (default: 90000)")
    .addOption(new Option("--apply <version>").hideHelp())
    .addOption(new Option("--previous <version>").hideHelp())
    .addOption(new Option("--http-base <url>").hideHelp())
    .action(async (options: SelfUpdateCommandOptions) => {
      await runSelfUpdateCommand(options);
    });
}
