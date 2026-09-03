import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type pino from "pino";
import type {
  DaemonUpdateChannel,
  DaemonUpdateCheckResponse,
  DaemonUpdateGetStatusResponse,
  DaemonUpdateRun,
  DaemonUpdateStartResponse,
} from "@fde/protocol/messages";
import type { SessionOutboundMessage } from "../../messages.js";
import { readLastUpdateResult, type DaemonInstallInfo } from "./daemon-update-install.js";

/**
 * Runs `fde daemon self-update` for clients. One instance per daemon: it
 * owns the single in-flight run and broadcasts `daemon.update.run.progress`
 * to every session. The CLI does the work (download, verify, install) and
 * hands off to its detached supervisor, which restarts this process; the
 * outcome is read back from `last-update.json` by whichever daemon comes up.
 */
export type CheckPayload = Omit<DaemonUpdateCheckResponse["payload"], "requestId">;
export type StartPayload = Omit<DaemonUpdateStartResponse["payload"], "requestId">;
export type StatusPayload = Omit<DaemonUpdateGetStatusResponse["payload"], "requestId">;

export type SpawnUpdateCli = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcess;

export interface DaemonUpdateServiceOptions {
  install: DaemonInstallInfo;
  daemonVersion: string;
  paseoHome: string;
  listen: string | null;
  logger: pino.Logger;
  env?: NodeJS.ProcessEnv;
  spawnCli?: SpawnUpdateCli;
  checkTimeoutMs?: number;
}

interface CliProgressEvent {
  event: "progress";
  phase: string;
  message: string;
}

interface CliResultEvent {
  event: "result";
  status: string;
  currentVersion?: string | null;
  targetVersion?: string | null;
  updatable?: boolean;
  updateAvailable?: boolean;
  reason?: string | null;
  releaseUrl?: string | null;
}

type CliEvent = CliProgressEvent | CliResultEvent;

const DEFAULT_CHECK_TIMEOUT_MS = 60_000;

function parseCliEvent(line: string): CliEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<CliEvent>;
    if (parsed.event === "progress" && typeof parsed.phase === "string") {
      return { event: "progress", phase: parsed.phase, message: String(parsed.message ?? "") };
    }
    if (parsed.event === "result" && typeof parsed.status === "string") {
      return parsed as CliResultEvent;
    }
  } catch {
    // Not one of ours (chalk output, warnings); ignore.
  }
  return null;
}

const defaultSpawnCli: SpawnUpdateCli = (command, args, options) =>
  spawn(command, args, {
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: process.platform === "win32",
  });

export class DaemonUpdateService {
  private readonly install: DaemonInstallInfo;
  private readonly daemonVersion: string;
  private readonly paseoHome: string;
  private readonly listen: string | null;
  private readonly logger: pino.Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly spawnCli: SpawnUpdateCli;
  private readonly checkTimeoutMs: number;
  private broadcaster: ((msg: SessionOutboundMessage) => void) | null = null;
  private run: DaemonUpdateRun | null = null;

  constructor(options: DaemonUpdateServiceOptions) {
    this.install = options.install;
    this.daemonVersion = options.daemonVersion;
    this.paseoHome = options.paseoHome;
    this.listen = options.listen;
    this.logger = options.logger.child({ module: "daemon-update" });
    this.env = options.env ?? process.env;
    this.spawnCli = options.spawnCli ?? defaultSpawnCli;
    this.checkTimeoutMs = options.checkTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  }

  setBroadcaster(broadcaster: (msg: SessionOutboundMessage) => void): void {
    this.broadcaster = broadcaster;
  }

  get installInfo(): DaemonInstallInfo {
    return this.install;
  }

  currentRun(): DaemonUpdateRun | null {
    return this.run;
  }

  status(): StatusPayload {
    return {
      updatable: this.install.updatable,
      reason: this.install.reason,
      currentVersion: this.daemonVersion,
      installDir: this.install.installDir,
      run: this.run,
      lastResult: readLastUpdateResult(this.install.installDir),
    };
  }

  async check(input: { channel?: DaemonUpdateChannel } = {}): Promise<CheckPayload> {
    const channel = input.channel ?? "stable";
    const base: CheckPayload = {
      updatable: this.install.updatable,
      reason: this.install.reason,
      currentVersion: this.daemonVersion,
      channel,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      error: null,
    };
    if (!this.install.cliLauncher) return base;
    try {
      const result = await this.runCli(["--check", "--channel", channel], null);
      if (!result) return { ...base, error: "self-update check produced no result" };
      if (result.status === "not_updatable") {
        return { ...base, updatable: false, reason: result.reason ?? base.reason };
      }
      if (result.status === "failed") return { ...base, error: result.reason ?? "check failed" };
      return {
        ...base,
        latestVersion: result.targetVersion ?? null,
        updateAvailable: result.updateAvailable === true,
        releaseUrl: result.releaseUrl ?? null,
      };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async start(input: { version?: string; channel?: DaemonUpdateChannel } = {}): Promise<StartPayload> {
    if (!this.install.updatable || !this.install.cliLauncher) {
      return { accepted: false, runId: null, targetVersion: null, error: this.install.reason };
    }
    if (this.run) {
      return {
        accepted: false,
        runId: this.run.runId,
        targetVersion: this.run.to,
        error: `an update to ${this.run.to} is already in progress`,
      };
    }
    const runId = randomUUID();
    this.run = {
      runId,
      from: this.daemonVersion,
      to: input.version ?? "latest",
      phase: "check",
      message: "resolving release",
      at: new Date().toISOString(),
    };
    this.broadcast();
    const args = [
      "--no-wait",
      "--channel",
      input.channel ?? "stable",
      ...(input.version ? ["--version", input.version] : []),
    ];
    // Runs detached from the response: the CLI keeps reporting until it hands off.
    const completion = this.runCli(args, runId)
      .then((result) => this.finishRun(runId, result))
      .catch((error: unknown) => {
        this.logger.error({ err: error, runId }, "self-update run failed");
        this.finishRun(runId, {
          event: "result",
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    void completion;
    return { accepted: true, runId, targetVersion: input.version ?? null, error: null };
  }

  private finishRun(runId: string, result: CliResultEvent | null): void {
    if (!this.run || this.run.runId !== runId) return;
    const status = result?.status ?? "failed";
    if (status === "handoff") {
      // The supervisor restarts this daemon; the outcome lands in last-update.json.
      this.update("restart", `restarting into ${result?.targetVersion ?? this.run.to}`);
      return;
    }
    const reason =
      result?.reason ??
      (status === "up_to_date" ? `already on ${result?.currentVersion ?? this.daemonVersion}` : null);
    this.update("failed", reason ?? `self-update ended with ${status}`);
    this.run = null;
  }

  private update(phase: string, message: string | null): void {
    if (!this.run) return;
    this.run = { ...this.run, phase, message, at: new Date().toISOString() };
    this.broadcast();
  }

  private broadcast(): void {
    if (!this.run || !this.broadcaster) return;
    try {
      this.broadcaster({ type: "daemon.update.run.progress", payload: this.run });
    } catch (error) {
      this.logger.warn({ err: error }, "failed to broadcast self-update progress");
    }
  }

  private runCli(extraArgs: string[], runId: string | null): Promise<CliResultEvent | null> {
    const launcher = this.install.cliLauncher as string;
    const args = [
      "daemon",
      "self-update",
      "--json",
      "--home",
      this.paseoHome,
      "--install-dir",
      this.install.installDir,
      ...extraArgs,
    ];
    const env: NodeJS.ProcessEnv = {
      ...this.env,
      PASEO_HOME: this.paseoHome,
      FDE_INSTALL_DIR: this.install.installDir,
      ...(this.listen ? { PASEO_LISTEN: this.listen } : {}),
    };
    this.logger.info({ launcher, args: extraArgs, runId }, "running fde daemon self-update");
    return new Promise((resolve, reject) => {
      const child = this.spawnCli(launcher, args, { env });
      let result: CliResultEvent | null = null;
      let stderr = "";
      const timer =
        runId === null
          ? setTimeout(() => {
              child.kill();
              reject(new Error(`self-update check timed out after ${this.checkTimeoutMs}ms`));
            }, this.checkTimeoutMs)
          : null;
      if (child.stdout) {
        createInterface({ input: child.stdout }).on("line", (line) => {
          const event = parseCliEvent(line);
          if (!event) return;
          if (event.event === "result") {
            result = event;
            if (runId && event.targetVersion && this.run?.runId === runId) {
              this.run = { ...this.run, to: event.targetVersion };
            }
            return;
          }
          if (runId) this.update(event.phase, event.message);
        });
      }
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.once("error", (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        if (timer) clearTimeout(timer);
        if (result) {
          resolve(result);
          return;
        }
        reject(new Error(`self-update exited with ${code ?? "a signal"}: ${stderr.trim()}`));
      });
    });
  }
}
