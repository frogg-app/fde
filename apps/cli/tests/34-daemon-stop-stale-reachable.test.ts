#!/usr/bin/env npx tsx

/**
 * Regression: `frogg daemon stop` must stop a reachable daemon even when the
 * local pid file points at a dead supervisor owner.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const pollIntervalMs = 100;
const testEnv = {
  FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  FROGG_DICTATION_ENABLED: process.env.FROGG_DICTATION_ENABLED ?? "0",
  FROGG_VOICE_MODE_ENABLED: process.env.FROGG_VOICE_MODE_ENABLED ?? "0",
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
  connectedDaemon: string | null;
  pid: number | null;
}

async function readDaemonStatus(froggHome: string): Promise<DaemonStatus> {
  const result =
    await $`FROGG_HOME=${froggHome} FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD} FROGG_DICTATION_ENABLED=${testEnv.FROGG_DICTATION_ENABLED} FROGG_VOICE_MODE_ENABLED=${testEnv.FROGG_VOICE_MODE_ENABLED} npx frogg daemon status --home ${froggHome} --json`.nothrow();
  if (result.exitCode !== 0) {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      localDaemon?: unknown;
      connectedDaemon?: unknown;
      pid?: unknown;
    };
    return {
      localDaemon: typeof parsed.localDaemon === "string" ? parsed.localDaemon : null,
      connectedDaemon: typeof parsed.connectedDaemon === "string" ? parsed.connectedDaemon : null,
      pid:
        typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
          ? parsed.pid
          : null,
    };
  } catch {
    return { localDaemon: null, connectedDaemon: null, pid: null };
  }
}

function findUnusedPid(): number {
  for (let pid = 999_999; pid > 900_000; pid--) {
    if (!isProcessRunning(pid)) {
      return pid;
    }
  }
  throw new Error("Unable to find unused pid for stale pid fixture");
}

console.log("=== Daemon Stop (stale pid, reachable worker regression) ===\n");

const port = await getAvailablePort();
const froggHome = await mkdtemp(join(tmpdir(), "frogg-stop-stale-reachable-"));
const cliRoot = join(import.meta.dirname, "..");
const host = `127.0.0.1:${port}`;
const pidPath = join(froggHome, "frogg.pid");
const stalePid = findUnusedPid();

let workerProcess: ChildProcess | null = null;

try {
  console.log("Test 1: start daemon worker with stale supervisor pid file");

  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        pid: stalePid,
        startedAt: new Date().toISOString(),
        hostname: "stale-supervisor-fixture.local",
        uid: typeof process.getuid === "function" ? process.getuid() : undefined,
        listen: host,
      },
      null,
      2,
    )}\n`,
  );

  workerProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../../packages/server/src/server/daemon-worker.ts"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        FROGG_HOME: froggHome,
        FROGG_LISTEN: host,
        FROGG_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  await waitFor(
    async () => {
      const status = await readDaemonStatus(froggHome);
      return status.localDaemon === "stale_pid" && status.connectedDaemon === "reachable";
    },
    120000,
    "daemon did not enter stale_pid + reachable state in time",
  );

  const statusBeforeStop = await readDaemonStatus(froggHome);
  assert.strictEqual(statusBeforeStop.pid, stalePid, "status should report the stale owner pid");
  assert(workerProcess.pid && isProcessRunning(workerProcess.pid), "worker should be running");
  console.log(`✓ fixture has stale pid ${stalePid} and live worker ${workerProcess.pid}\n`);

  console.log(
    "Test 2: `frogg daemon stop` should stop reachable worker instead of saying not_running",
  );
  await writeFile(
    join(froggHome, "config.json"),
    JSON.stringify({ version: 1, daemon: { relay: { enabled: true } } }),
  );
  const stopResult =
    await $`FROGG_HOME=${froggHome} FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD} FROGG_DICTATION_ENABLED=${testEnv.FROGG_DICTATION_ENABLED} FROGG_VOICE_MODE_ENABLED=${testEnv.FROGG_VOICE_MODE_ENABLED} npx frogg daemon stop --home ${froggHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  const stopJson = JSON.parse(stopResult.stdout) as {
    action?: unknown;
    pid?: unknown;
    message?: unknown;
  };
  assert.strictEqual(stopJson.action, "stopped", "stop should report stopped action");
  assert.strictEqual(
    stopJson.pid,
    String(stalePid),
    "stop should report the stale pid it recovered from",
  );
  assert.strictEqual(
    stopJson.message,
    "Daemon stopped gracefully",
    "stop should route through lifecycle shutdown",
  );

  await waitFor(
    () => !isProcessRunning(workerProcess?.pid ?? -1),
    15000,
    "worker remained running after stop",
  );
  assert.strictEqual(existsSync(pidPath), false, "stale pid file should be removed after stop");
  console.log("✓ stop recovered stale supervisor pid state\n");
} finally {
  if (workerProcess?.pid && isProcessRunning(workerProcess.pid)) {
    workerProcess.kill("SIGTERM");
    await waitFor(
      () => !isProcessRunning(workerProcess!.pid ?? -1),
      5000,
      "worker cleanup timed out",
    ).catch(() => {
      workerProcess?.kill("SIGKILL");
    });
  }

  await $`FROGG_HOME=${froggHome} FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.FROGG_LOCAL_SPEECH_AUTO_DOWNLOAD} FROGG_DICTATION_ENABLED=${testEnv.FROGG_DICTATION_ENABLED} FROGG_VOICE_MODE_ENABLED=${testEnv.FROGG_VOICE_MODE_ENABLED} npx frogg daemon stop --home ${froggHome} --force`.nothrow();
  await rm(froggHome, { recursive: true, force: true });
}

console.log("=== Stale reachable stop regression test passed ===");
