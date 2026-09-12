import { statusFromDaemonProbe, type DesktopDaemonStatus } from "./daemon-status.js";
export type { DesktopDaemonStatus } from "./daemon-status.js";
import { DaemonOwnership } from "./daemon-ownership.js";
import type { AppReleaseChannel, AppUpdateCheckIntent } from "../features/auto-updater.js";
import { type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import log from "electron-log/main";
import { resolveFdeHome, spawnProcess } from "./process-runtime.js";
import { getBundledCliShimPath } from "../integrations/cli-install/index.js";
import { createNodeEntrypointInvocation, resolveDaemonRunnerEntrypoint } from "./runtime-paths.js";
import { runExternalCliJsonCommand, runExternalCliTextCommand } from "./cli/external.js";
import type { DesktopSettings } from "../settings/desktop-settings.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import { tailFile } from "../diagnostics/tail-file.js";

const daemonOwnership = new DaemonOwnership();

const DAEMON_LOG_FILENAME = "daemon.log";
const STARTUP_POLL_INTERVAL_MS = 200;
const STARTUP_POLL_MAX_ATTEMPTS = 150;
const DETACHED_STARTUP_GRACE_MS = 1200;

const DESKTOP_DAEMON_STOP_REASON_VALUES = [
  "manual_ipc",
  "settings",
  "host_remove",
  "quit",
  "app_update",
  "version_mismatch",
  "restart",
] as const;
export type DesktopDaemonStopReason = (typeof DESKTOP_DAEMON_STOP_REASON_VALUES)[number];

const DESKTOP_DAEMON_STOP_REASONS = new Set<string>(DESKTOP_DAEMON_STOP_REASON_VALUES);
const DEFAULT_DESKTOP_DAEMON_STOP_REASON: DesktopDaemonStopReason = "manual_ipc";

interface DesktopDaemonLogs {
  logPath: string;
  contents: string;
}

function parseReleaseChannel(
  args: Record<string, unknown> | undefined,
): AppReleaseChannel | undefined {
  if (args?.releaseChannel === "beta") {
    return "beta";
  }
  if (args?.releaseChannel === "stable") {
    return "stable";
  }
  return undefined;
}

export function parseAppUpdateCheckIntent(
  args: Record<string, unknown> | undefined,
): AppUpdateCheckIntent {
  return args?.intent === "manual" ? "manual" : "automatic";
}

export function parseDesktopDaemonStopReason(
  args: Record<string, unknown> | undefined,
): DesktopDaemonStopReason {
  const reason = args?.reason;
  if (typeof reason === "string" && DESKTOP_DAEMON_STOP_REASONS.has(reason)) {
    return reason as DesktopDaemonStopReason;
  }
  return DEFAULT_DESKTOP_DAEMON_STOP_REASON;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getFdeHome(): string {
  return resolveFdeHome(process.env);
}

function logFilePath(): string {
  return path.join(getFdeHome(), DAEMON_LOG_FILENAME);
}

export function isDesktopManagedDaemonRunningSync(): boolean {
  try {
    const raw = readFileSync(path.join(getFdeHome(), "fde.pid"), "utf-8");
    const lock = JSON.parse(raw) as { pid?: unknown; desktopManaged?: unknown };
    if (!daemonOwnership.owns(lock)) return false;
    if (typeof lock.pid !== "number" || !Number.isInteger(lock.pid)) return false;
    return isProcessRunning(lock.pid);
  } catch {
    return false;
  }
}

function summarizeDesktopDaemonStatus(status: DesktopDaemonStatus): Record<string, unknown> {
  return {
    status: status.status,
    pid: status.pid,
    listen: status.listen,
    serverId: status.serverId || null,
    version: status.version,
    desktopManaged: status.desktopManaged,
    error: status.error,
  };
}

const DESKTOP_DAEMON_STOP_CLI_ARGS = [
  "daemon",
  "stop",
  "--json",
  "--timeout",
  "5",
  "--force",
  "--kill-timeout",
  "5",
];

async function runDesktopDaemonStopViaCli({
  reason,
  statusBefore,
  resolveStatusAfter = false,
}: {
  reason: DesktopDaemonStopReason;
  statusBefore?: DesktopDaemonStatus | null;
  resolveStatusAfter?: boolean;
}): Promise<{
  cliResult: unknown;
  statusAfter: DesktopDaemonStatus | null;
}> {
  logDesktopDaemonLifecycle("desktop daemon stop requested", {
    reason,
    statusBefore: statusBefore ? summarizeDesktopDaemonStatus(statusBefore) : null,
  });

  const cliResult = await runExternalCliJsonCommand(DESKTOP_DAEMON_STOP_CLI_ARGS);
  const statusAfter = resolveStatusAfter ? await resolveDesktopDaemonStatus() : null;

  logDesktopDaemonLifecycle("desktop daemon stop completed", {
    reason,
    cliResult,
    statusAfter: statusAfter ? summarizeDesktopDaemonStatus(statusAfter) : null,
  });

  return { cliResult, statusAfter };
}

export async function stopDesktopDaemonViaCli(
  reason: DesktopDaemonStopReason = DEFAULT_DESKTOP_DAEMON_STOP_REASON,
): Promise<void> {
  await stopDesktopDaemon(reason);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logDesktopDaemonLifecycle(message: string, details?: Record<string, unknown>): void {
  log.info("[desktop daemon]", message, {
    pid: process.pid,
    ...details,
  });
}

export function resolveDesktopAppVersion(): string {
  if (app.isPackaged) {
    return app.getVersion();
  }

  try {
    const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: unknown;
    };
    if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
    // Fall back to Electron's default version if the package metadata is unavailable.
  }

  return app.getVersion();
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

export async function resolveDesktopDaemonStatus(): Promise<DesktopDaemonStatus> {
  const home = getFdeHome();

  try {
    const payload = (await runExternalCliJsonCommand(["daemon", "status", "--json"])) as Record<
      string,
      unknown
    >;
    return statusFromDaemonProbe(payload, home);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logDesktopDaemonLifecycle("resolveStatus CLI command failed", {
      error: errorMessage,
    });
    return {
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home,
      version: null,
      desktopManaged: false,
      error: errorMessage,
    };
  }
}

function normalizeVersion(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function shouldRestartForVersion(current: DesktopDaemonStatus): boolean {
  if (!daemonOwnership.owns(current)) return false;
  const appVersion = normalizeVersion(resolveDesktopAppVersion());
  const daemonVersion = normalizeVersion(current.version);
  return Boolean(appVersion && daemonVersion && appVersion !== daemonVersion);
}

function assertBuiltInDaemonManagementEnabled(settings: DesktopSettings): void {
  if (!settings.daemon.manageBuiltInDaemon) {
    throw new Error("Built-in daemon management is disabled.");
  }
}

function buildStartupFailureError(result: {
  code: number | null;
  signal: string | null;
  error?: Error;
}): Error {
  const reason = result.error
    ? result.error.message
    : `exit code ${result.code ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}`;
  const parts = [`Daemon failed to start: ${reason}`];
  const logs = tailFile(logFilePath(), 15);
  if (logs) parts.push(`Recent logs (${logFilePath()}):\n${logs}`);
  return new Error(parts.join("\n\n"));
}

async function pollForRunningDaemon(): Promise<DesktopDaemonStatus> {
  async function poll(attempt: number): Promise<DesktopDaemonStatus> {
    if (attempt >= STARTUP_POLL_MAX_ATTEMPTS) return resolveDesktopDaemonStatus();
    const status = await resolveDesktopDaemonStatus();
    if (attempt === 0 || attempt === STARTUP_POLL_MAX_ATTEMPTS - 1 || attempt % 10 === 9) {
      logDesktopDaemonLifecycle("polling daemon status after detached start", {
        attempt: attempt + 1,
        status: status.status,
        pid: status.pid,
        listen: status.listen,
        serverId: status.serverId || null,
      });
    }
    if (status.status === "running" && status.serverId && status.listen) return status;
    await sleep(STARTUP_POLL_INTERVAL_MS);
    return poll(attempt + 1);
  }
  return poll(0);
}

type GraceResult =
  | { exitedEarly: false }
  | {
      exitedEarly: true;
      code: number | null;
      signal: string | null;
      error?: Error;
    };

async function waitForStartupGrace(child: ChildProcess): Promise<GraceResult> {
  return new Promise<GraceResult>((resolve) => {
    let settled = false;
    const finish = (value: GraceResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => finish({ exitedEarly: false }), DETACHED_STARTUP_GRACE_MS);

    child.once("error", (error) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      finish({ exitedEarly: true, code, signal });
    });
  });
}

export async function startDaemon(): Promise<DesktopDaemonStatus> {
  assertBuiltInDaemonManagementEnabled(await getDesktopSettingsStore().get());

  const current = await resolveDesktopDaemonStatus();
  logDesktopDaemonLifecycle("initial status check before start", {
    status: current.status,
    pid: current.pid,
    listen: current.listen,
    serverId: current.serverId || null,
    error: current.error,
    desktopManaged: current.desktopManaged,
  });
  if (current.status === "running") {
    if (shouldRestartForVersion(current)) {
      logDesktopDaemonLifecycle("daemon version mismatch, restarting", {
        appVersion: normalizeVersion(resolveDesktopAppVersion()),
        daemonVersion: normalizeVersion(current.version),
      });
      await stopDesktopDaemon("version_mismatch");
    } else {
      return current;
    }
  }

  const daemonRunner = resolveDaemonRunnerEntrypoint();
  const reclaimStalePidLock =
    current.status === "errored" && daemonOwnership.owns(current) && current.error === null;
  const invocation = createNodeEntrypointInvocation({
    entrypoint: daemonRunner,
    argvMode: "node-script",
    args: reclaimStalePidLock ? ["--reclaim-stale-pid-lock"] : [],
    baseEnv: process.env,
  });

  logDesktopDaemonLifecycle("starting detached daemon", {
    appIsPackaged: app.isPackaged,
    daemonRunnerEntry: daemonRunner.entryPath,
    daemonRunnerExecArgv: daemonRunner.execArgv,
    command: invocation.command,
    args: invocation.args,
    electronRunAsNode: invocation.env.ELECTRON_RUN_AS_NODE ?? null,
    parentExecPath: process.execPath,
    parentElectronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  });

  const child: ChildProcess = spawnProcess(invocation.command, invocation.args, {
    detached: true,
    envMode: "internal",
    env: invocation.env,
    envOverlay: {
      FDE_DESKTOP_MANAGED: "1",
      FDE_CLI: getBundledCliShimPath(),
      FDE_WEB_UI_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  logDesktopDaemonLifecycle("detached spawn returned", {
    childPid: child.pid ?? null,
    spawnfile: child.spawnfile,
    spawnargs: child.spawnargs,
  });

  daemonOwnership.recordStarted(child.pid, { pid: child.pid ?? null, desktopManaged: true });
  child.unref();

  const result = await waitForStartupGrace(child);

  logDesktopDaemonLifecycle("detached startup grace period completed", {
    childPid: child.pid ?? null,
    result,
  });

  if (result.exitedEarly) {
    daemonOwnership.release();
    throw buildStartupFailureError(result);
  }

  const started = await pollForRunningDaemon();
  if (started.status !== "running" || !started.serverId || !started.listen) {
    child.kill();
    daemonOwnership.release();
    throw new Error(`Daemon did not become ready. ${started.error ?? tailFile(logFilePath(), 15)}`);
  }
  daemonOwnership.recordStarted(child.pid, started);
  return started;
}

export async function stopDesktopDaemon(
  reason: DesktopDaemonStopReason = DEFAULT_DESKTOP_DAEMON_STOP_REASON,
): Promise<DesktopDaemonStatus> {
  const status = await resolveDesktopDaemonStatus();
  if (
    (reason === "manual_ipc" || reason === "restart") &&
    (status.status === "running" || status.status === "errored")
  ) {
    daemonOwnership.assertManualControl(status);
  }
  if (
    (status.status !== "running" && status.status !== "errored") ||
    !daemonOwnership.owns(status)
  ) {
    logDesktopDaemonLifecycle("desktop daemon stop skipped", {
      reason,
      statusBefore: summarizeDesktopDaemonStatus(status),
    });
    return status;
  }

  const { statusAfter } = await runDesktopDaemonStopViaCli({
    reason,
    statusBefore: status,
    resolveStatusAfter: true,
  });
  daemonOwnership.release();
  return statusAfter ?? (await resolveDesktopDaemonStatus());
}

export async function restartDaemon(): Promise<DesktopDaemonStatus> {
  assertBuiltInDaemonManagementEnabled(await getDesktopSettingsStore().get());
  await stopDesktopDaemon("restart");
  return startDaemon();
}

export function getDaemonLogs(): DesktopDaemonLogs {
  const logPath = logFilePath();
  return {
    logPath,
    contents: tailFile(logPath, 100),
  };
}

export async function getCliDaemonStatus(): Promise<string> {
  return await runExternalCliTextCommand(["daemon", "status"]);
}

export async function getLocalDaemonVersion(): Promise<{
  version: string | null;
  error: string | null;
}> {
  const status = await resolveDesktopDaemonStatus();
  if (status.status !== "running") {
    return { version: null, error: "Daemon is not running." };
  }
  return {
    version: status.version,
    error: status.version ? null : "Running daemon did not report a version.",
  };
}

export async function resolveRequestedReleaseChannel(
  args: Record<string, unknown> | undefined,
): Promise<AppReleaseChannel> {
  return parseReleaseChannel(args) ?? (await getDesktopSettingsStore().get()).releaseChannel;
}

export { createDaemonCommandHandlers, registerDaemonManager } from "./daemon-commands.js";
