import { spawn, type ChildProcess } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { acquirePidLock, PidLockError, releasePidLock } from "../pid-lock.js";
import { executionControlRequest, readExecutionStatus } from "./control-client.js";
import type { ExecutionServiceDescriptor, ExecutionServiceStatus } from "./protocol.js";
import {
  executionDirectory,
  hasLiveExecutionOwner,
  isProcessAlive,
  prepareExecutionDirectory,
  readExecutionDescriptor,
} from "./state.js";

export interface EnsureExecutionServiceOptions {
  home: string;
  version: string;
  workerEntry: string;
  workerArgs?: string[];
  env?: NodeJS.ProcessEnv;
  execArgv?: string[];
}

export async function getExecutionServiceStatus(
  home: string,
): Promise<ExecutionServiceStatus | null> {
  const descriptor = await readExecutionDescriptor(home);
  if (!descriptor || !isProcessAlive(descriptor.pid)) {
    if (await hasLiveExecutionOwner(home))
      throw new Error(
        "Execution service is starting or has an unpublished live owner; retry shortly",
      );
    return null;
  }
  return readExecutionStatus(descriptor);
}

export async function stopExecutionService(options: {
  home: string;
  force?: boolean;
}): Promise<{ stopped: boolean }> {
  const descriptor = await readExecutionDescriptor(options.home);
  if (!descriptor || !isProcessAlive(descriptor.pid)) {
    if (await hasLiveExecutionOwner(options.home)) {
      throw new Error("Execution service has an unpublished live owner; cannot confirm it stopped");
    }
    return { stopped: false };
  }
  await readExecutionStatus(descriptor);
  await executionControlRequest(descriptor, "/stop", { force: options.force === true });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await readExecutionDescriptor(options.home);
    if (
      !isProcessAlive(descriptor.pid) ||
      (current?.instanceId !== descriptor.instanceId &&
        !(await hasLiveExecutionOwner(options.home)))
    )
      return { stopped: true };
    await delay(50);
  }
  throw new Error("Execution service did not stop within 20 seconds; it was not force-killed");
}

async function attachExisting(
  options: EnsureExecutionServiceOptions,
): Promise<ExecutionServiceDescriptor | null> {
  const existing = await readExecutionDescriptor(options.home);
  if (!existing || !isProcessAlive(existing.pid)) return null;
  const status = await readExecutionStatus(existing);
  if (status.version !== options.version && status.residentAgentCount === 0) {
    // The service rechecks residency and fences new registrations before stopping.
    await stopExecutionService({ home: options.home });
    return null;
  }
  return existing;
}

async function launchExecutionService(
  options: EnsureExecutionServiceOptions,
): Promise<ChildProcess> {
  const directory = await prepareExecutionDirectory(options.home);
  const log = await open(path.join(directory, "execution.log"), "a", 0o600);
  try {
    const child = spawn(
      process.execPath,
      [...(options.execArgv ?? []), options.workerEntry, ...(options.workerArgs ?? [])],
      {
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        windowsHide: true,
        env: {
          ...(options.env ?? process.env),
          FDE_HOME: options.home,
          PASEO_HOME: options.home,
          FDE_EXECUTION_SERVICE: "0",
          FDE_EXECUTION_VERSION: options.version,
          PASEO_SUPERVISED: "0",
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child;
  } finally {
    await log.close();
  }
}

/** Serializes launch attempts without tying the independent owner's lifetime to the caller. */
async function ensureExecutionServiceLocked(
  options: EnsureExecutionServiceOptions,
): Promise<ExecutionServiceDescriptor> {
  await prepareExecutionDirectory(options.home);
  const launchHome = path.join(executionDirectory(options.home), "launch");
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      await acquirePidLock(launchHome, null);
      break;
    } catch (error) {
      if (!(error instanceof PidLockError) || Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
  try {
    let existing = await attachExisting(options);
    if (existing) return existing;
    while (await hasLiveExecutionOwner(options.home)) {
      if (Date.now() >= deadline)
        throw new Error(
          "Execution service owner is alive but not ready; refusing to start a second runtime",
        );
      await delay(100);
      existing = await attachExisting(options);
      if (existing) return existing;
    }
    const child = await launchExecutionService(options);
    while (Date.now() < deadline) {
      const descriptor = await readExecutionDescriptor(options.home);
      if (descriptor && isProcessAlive(descriptor.pid)) {
        await readExecutionStatus(descriptor);
        return descriptor;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Execution service exited before readiness; see ${path.join(executionDirectory(options.home), "execution.log")}`,
        );
      }
      await delay(100);
    }
    throw new Error(
      `Execution service startup timed out; see ${path.join(executionDirectory(options.home), "execution.log")}. A slow owner was left intact.`,
    );
  } finally {
    await releasePidLock(launchHome);
  }
}

const launches = new Map<string, Promise<ExecutionServiceDescriptor>>();

export function ensureExecutionService(
  options: EnsureExecutionServiceOptions,
): Promise<ExecutionServiceDescriptor> {
  const home = path.resolve(options.home);
  const active = launches.get(home);
  if (active) return active;
  const pending = ensureExecutionServiceLocked({ ...options, home }).finally(() => {
    if (launches.get(home) === pending) launches.delete(home);
  });
  launches.set(home, pending);
  return pending;
}
