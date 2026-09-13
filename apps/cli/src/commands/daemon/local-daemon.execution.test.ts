import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { stopLocalDaemon } from "./local-daemon.js";

test("forced gateway stop preserves detached execution descendants with no opt-in environment", async () => {
  vi.stubEnv("FROGG_EXECUTION_SERVICE", "");
  const home = await mkdtemp(path.join(os.tmpdir(), "frogg-cli-execution-"));
  const owner = spawn(
    process.execPath,
    [
      "-e",
      `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log(child.pid);
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  let descendant: number | null = null;
  try {
    if (!owner.stdout) throw new Error("Fixture stdout is unavailable");
    const [chunk] = await once(owner.stdout, "data");
    descendant = Number(String(chunk).trim());
    expect(Number.isInteger(descendant)).toBe(true);
    await mkdir(path.join(home, "execution-service"));
    await writeFile(
      path.join(home, "frogg.pid"),
      JSON.stringify({ pid: owner.pid, listen: "127.0.0.1:1" }),
    );
    const result = await stopLocalDaemon({
      home,
      timeoutMs: 100,
      killTimeoutMs: 2000,
      force: true,
    });
    expect(result).toMatchObject({ action: "stopped", forced: true });
    expect(process.kill(descendant, 0)).toBe(true);
  } finally {
    owner.kill("SIGKILL");
    if (descendant !== null) process.kill(descendant, "SIGKILL");
    await rm(home, { recursive: true, force: true });
    vi.unstubAllEnvs();
  }
}, 10000);
