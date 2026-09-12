import { stopExecutionService } from "@fde/server";
import type { Command } from "commander";
import {
  stopLocalDaemon,
  DEFAULT_STOP_TIMEOUT_MS,
  DEFAULT_KILL_TIMEOUT_MS,
} from "./local-daemon.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

interface StopResult {
  action: "stopped" | "not_running";
  home: string;
  pid: string;
  forced: boolean;
  usedLifecycleRpc: boolean;
  reason: "not_running" | "lifecycle_shutdown_rpc" | "owner_pid_signal" | "owner_pid_sigkill";
  message: string;
  executionStopped: boolean | null;
}

const stopResultSchema: OutputSchema<StopResult> = {
  idField: "action",
  columns: [
    {
      header: "STATUS",
      field: "action",
      color: (value) => (value === "stopped" ? "green" : "yellow"),
    },
    { header: "HOME", field: "home" },
    { header: "PID", field: "pid" },
    { header: "MESSAGE", field: "message" },
  ],
};

export type StopCommandResult = SingleResult<StopResult>;

function parseSecondsOption(raw: unknown, fallbackMs: number, label: string): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallbackMs;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const error: CommandError = {
      code: "INVALID_TIMEOUT",
      message: `Invalid ${label} value: ${raw}`,
      details: `${label} must be a positive number of seconds`,
    };
    throw error;
  }

  return Math.ceil(seconds * 1000);
}

export interface StopDependencies {
  stopGateway: typeof stopLocalDaemon;
  stopExecution: typeof stopExecutionService;
}

const defaultDependencies: StopDependencies = {
  stopGateway: stopLocalDaemon,
  stopExecution: stopExecutionService,
};

export function runStopCommand(
  options: CommandOptions,
  command: Command,
  dependencies: StopDependencies,
): Promise<StopCommandResult>;
export function runStopCommand(
  options: CommandOptions,
  command: Command,
): Promise<StopCommandResult>;
export async function runStopCommand(
  options: CommandOptions,
  _command: Command,
  dependencies: StopDependencies = defaultDependencies,
): Promise<StopCommandResult> {
  const home = typeof options.home === "string" ? options.home : undefined;
  const force = options.force === true;
  const timeoutMs = parseSecondsOption(options.timeout, DEFAULT_STOP_TIMEOUT_MS, "timeout");
  const killTimeoutMs = parseSecondsOption(
    options.killTimeout,
    DEFAULT_KILL_TIMEOUT_MS,
    "kill-timeout",
  );

  try {
    const result = await dependencies.stopGateway({
      home,
      force,
      timeoutMs,
      killTimeoutMs,
    });
    const execution =
      options.all === true
        ? await dependencies.stopExecution({ home: result.home, force: true })
        : null;
    const executionStopped = execution?.stopped ?? null;
    const message = execution
      ? `${result.message}. Independent execution ${
          execution.stopped ? "stopped" : "was not running"
        }.`
      : result.message;
    return {
      type: "single",
      data: {
        action: executionStopped ? "stopped" : result.action,
        home: result.home,
        pid: result.pid === null ? "-" : String(result.pid),
        forced: result.forced,
        usedLifecycleRpc: result.usedLifecycleRpc,
        reason: result.reason,
        message,
        executionStopped,
      },
      schema: stopResultSchema,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "STOP_FAILED",
      message: `Failed to stop local daemon: ${message}`,
    };
    throw error;
  }
}
