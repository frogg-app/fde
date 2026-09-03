import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_SERVICE_LISTEN,
  resolveServicePlan,
  type ServiceCommand,
  type ServicePlan,
  type ServicePlanInput,
  type ServicePlatform,
} from "./plan.js";

/**
 * Installs and removes the "start FDE when I log in" service: a systemd user
 * unit, a launchd agent, or a Windows logon task (see plan.ts). Every step is
 * idempotent — installing twice rewrites the same unit and restarts the
 * service; uninstalling something that is not there is not an error.
 */
export interface ServiceActionOptions {
  listen?: string;
  home?: string;
  platform?: ServicePlatform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ServiceActionResult {
  action: "installed" | "uninstalled" | "not_installed";
  platform: ServicePlatform;
  label: string;
  /** The unit/plist path, or null on Windows where the task is the record. */
  file: string | null;
  listen: string;
  home: string | null;
  command: string;
  /** Commands that failed; the service may still need manual attention. */
  warnings: string[];
  hints: string[];
  message: string;
}

/** How to launch the CLI again from a service manager, with no shell in between. */
export function resolveCliCommand(env: NodeJS.ProcessEnv = process.env): ServiceCommand {
  const launcher = env.FDE_CLI?.trim() || env.PASEO_CLI?.trim();
  if (launcher && existsSync(launcher)) {
    return { program: launcher, args: [] };
  }

  const entry = process.argv[1];
  if (entry) {
    // A bundle install keeps a rolling `current/bin/fde` symlink; prefer it so
    // the service survives an upgrade to a new version directory.
    const versionsIndex = entry.split(path.sep).indexOf("versions");
    if (versionsIndex > 0) {
      const root = entry.split(path.sep).slice(0, versionsIndex).join(path.sep);
      const rolling = path.join(root, "current", "bin", "fde");
      if (existsSync(rolling)) return { program: rolling, args: [] };
    }
    return { program: process.execPath, args: [path.resolve(entry)] };
  }
  return { program: process.execPath, args: [] };
}

function buildPlanInput(options: ServiceActionOptions): ServicePlanInput {
  const platform = options.platform ?? (process.platform as ServicePlatform);
  const env = options.env ?? process.env;
  const listen = options.listen?.trim() || DEFAULT_SERVICE_LISTEN;
  const cli = resolveCliCommand(env);
  const args = [...cli.args, "daemon", "start", "--foreground"];
  // Windows tasks carry no environment block, so the settings ride on argv.
  if (platform === "win32") {
    args.push("--listen", listen);
    if (options.home) args.push("--home", options.home);
  }

  return {
    platform,
    homeDir: options.homeDir ?? os.homedir(),
    env,
    command: { program: cli.program, args },
    listen,
    ...(options.home ? { fdeHome: options.home } : {}),
    pathPrepend: path.dirname(cli.program),
  };
}

function runCommand(command: ServiceCommand): string | null {
  const result = spawnSync(command.program, command.args, { stdio: "ignore" });
  if (result.error) return `${command.program}: ${result.error.message}`;
  if (result.status !== 0) {
    return `${[command.program, ...command.args].join(" ")} exited with ${result.status ?? "a signal"}`;
  }
  return null;
}

function describeCommand(plan: ServicePlan, input: ServicePlanInput): string {
  return [input.command.program, ...input.command.args].join(" ") + (plan.file ? "" : "");
}

export function installLoginService(options: ServiceActionOptions = {}): ServiceActionResult {
  const input = buildPlanInput(options);
  const plan = resolveServicePlan(input);
  const warnings: string[] = [];

  if (plan.file) {
    mkdirSync(path.dirname(plan.file.path), { recursive: true });
    writeFileSync(plan.file.path, plan.file.contents);
  }
  for (const command of plan.install) {
    const failure = runCommand(command);
    // The first launchd/systemd step clears any previous registration and is
    // expected to fail on a clean machine.
    if (failure && command !== plan.install[0]) warnings.push(failure);
  }

  return {
    action: "installed",
    platform: plan.platform,
    label: plan.label,
    file: plan.file?.path ?? null,
    listen: input.listen,
    home: input.fdeHome ?? null,
    command: describeCommand(plan, input),
    warnings,
    hints: plan.hints,
    message: warnings.length
      ? `Installed ${plan.label}, but some steps need attention: ${warnings.join("; ")}`
      : `FDE will start when you log in (${plan.label}).`,
  };
}

export function uninstallLoginService(options: ServiceActionOptions = {}): ServiceActionResult {
  const input = buildPlanInput(options);
  const plan = resolveServicePlan(input);
  const existed = plan.file ? existsSync(plan.file.path) : true;

  for (const command of plan.uninstall) runCommand(command);
  if (plan.file && existed) rmSync(plan.file.path, { force: true });

  return {
    action: existed ? "uninstalled" : "not_installed",
    platform: plan.platform,
    label: plan.label,
    file: plan.file?.path ?? null,
    listen: input.listen,
    home: input.fdeHome ?? null,
    command: describeCommand(plan, input),
    warnings: [],
    hints: [],
    message: existed
      ? `FDE will no longer start when you log in (${plan.label} removed).`
      : `Nothing to remove: no ${plan.label} login service is installed.`,
  };
}
