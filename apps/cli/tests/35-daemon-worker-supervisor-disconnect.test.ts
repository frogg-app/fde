#!/usr/bin/env npx tsx

/**
 * Regression: a supervised daemon worker must exit when its supervisor IPC
 * channel closes, instead of becoming an orphaned daemon.
 */

import assert from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const pollIntervalMs = 100;
const testEnv = {
  FDE_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.FDE_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  FDE_DICTATION_ENABLED: process.env.FDE_DICTATION_ENABLED ?? "0",
  FDE_VOICE_MODE_ENABLED: process.env.FDE_VOICE_MODE_ENABLED ?? "0",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readWorkerPid(supervisorPid: number): number | null {
  if (!Number.isInteger(supervisorPid) || supervisorPid <= 0) {
    return null;
  }

  const result = spawnSync("ps", ["ax", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (result.status !== 0 || result.error) {
    return null;
  }

  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [pidToken, ppidToken] = trimmed.split(/\s+/);
    const pid = Number.parseInt(pidToken ?? "", 10);
    const ppid = Number.parseInt(ppidToken ?? "", 10);
    if (ppid === supervisorPid && pid > 0) {
      return pid;
    }
  }

  return null;
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(pollIntervalMs);
    return poll();
  }

  return poll();
}

interface DaemonStatus {
  localDaemon: string | null;
  pid: number | null;
}

async function readDaemonStatus(fdeHome: string): Promise<DaemonStatus> {
  const result =
    await $`FDE_HOME=${fdeHome} FDE_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.FDE_LOCAL_SPEECH_AUTO_DOWNLOAD} FDE_DICTATION_ENABLED=${testEnv.FDE_DICTATION_ENABLED} FDE_VOICE_MODE_ENABLED=${testEnv.FDE_VOICE_MODE_ENABLED} npx fde daemon status --home ${fdeHome} --json`.nothrow();
  if (result.exitCode !== 0) {
    return { localDaemon: null, pid: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as { localDaemon?: unknown; pid?: unknown };
    return {
      localDaemon: typeof parsed.localDaemon === "string" ? parsed.localDaemon : null,
      pid:
        typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
          ? parsed.pid
          : null,
    };
  } catch {
    return { localDaemon: null, pid: null };
  }
}

console.log("=== Daemon Worker Supervisor Disconnect Regression ===\n");

const port = await getAvailablePort();
const fdeHome = await mkdtemp(join(tmpdir(), "fde-worker-supervisor-disconnect-"));
const cliRoot = join(import.meta.dirname, "..");

let supervisorProcess: ChildProcess | null = null;
let recentSupervisorLogs = "";

try {
  console.log("Test 1: start supervised daemon with isolated FDE_HOME");

  supervisorProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../../packages/server/scripts/supervisor-entrypoint.ts", "--dev"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        FDE_HOME: fdeHome,
        FDE_LISTEN: `127.0.0.1:${port}`,
        FDE_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  supervisorProcess.stdout?.on("data", (chunk) => {
    recentSupervisorLogs = (recentSupervisorLogs + chunk.toString()).slice(-8000);
  });
  supervisorProcess.stderr?.on("data", (chunk) => {
    recentSupervisorLogs = (recentSupervisorLogs + chunk.toString()).slice(-8000);
  });

  await waitFor(
    async () => {
      const status = await readDaemonStatus(fdeHome);
      return (
        status.localDaemon === "running" && status.pid !== null && isProcessRunning(status.pid)
      );
    },
    120000,
    "daemon did not become running in time",
  );

  const statusBeforeKill = await readDaemonStatus(fdeHome);
  const supervisorPid = statusBeforeKill.pid;
  assert(supervisorPid !== null, "supervisor pid should exist once daemon starts");
  const workerPid = readWorkerPid(supervisorPid);
  assert(workerPid !== null, "supervisor should have a worker process");
  assert(isProcessRunning(workerPid), "worker process should be running");
  console.log(`✓ daemon running with supervisor ${supervisorPid} and worker ${workerPid}\n`);

  console.log("Test 2: killing supervisor should make worker exit via IPC disconnect");
  supervisorProcess.kill("SIGKILL");
  await waitFor(
    () => !isProcessRunning(supervisorPid),
    15000,
    "supervisor remained running after SIGKILL",
  );
  await waitFor(
    () => !isProcessRunning(workerPid),
    15000,
    "worker remained running after supervisor IPC disconnect",
  );
  console.log("✓ worker exited after supervisor disconnect\n");
} finally {
  if (supervisorProcess?.pid && isProcessRunning(supervisorProcess.pid)) {
    supervisorProcess.kill("SIGKILL");
  }

  await $`FDE_HOME=${fdeHome} FDE_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.FDE_LOCAL_SPEECH_AUTO_DOWNLOAD} FDE_DICTATION_ENABLED=${testEnv.FDE_DICTATION_ENABLED} FDE_VOICE_MODE_ENABLED=${testEnv.FDE_VOICE_MODE_ENABLED} npx fde daemon stop --home ${fdeHome} --force`.nothrow();
  await rm(fdeHome, { recursive: true, force: true });
}

if (recentSupervisorLogs.trim().length === 0) {
  console.log("(no supervisor logs captured)");
}

console.log("=== Worker supervisor disconnect regression test passed ===");
