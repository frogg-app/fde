import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

const supervisorUrl = new URL("./supervisor.ts", import.meta.url).href;

test.concurrent.each(["environment", "directory"])(
  "supervisor force-kills only the gateway when execution is identified by %s",
  async (mode) => {
    const home = await mkdtemp(path.join(os.tmpdir(), "fde-supervisor-execution-"));
    const runner = path.join(home, "runner.mjs");
    const worker = path.join(home, "worker.mjs");
    if (mode === "directory") await mkdir(path.join(home, "execution-service"));
    await writeFile(
      worker,
      `
      import { spawn } from 'node:child_process';
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
      child.unref();
      process.stdout.write('DESCENDANT=' + child.pid + '\\n');
      process.on('SIGTERM', () => {});
      process.on('message', () => {});
      process.send({ type: 'fde:shutdown', reason: 'force_kill_probe' });
      setInterval(() => {}, 1000);
    `,
    );
    await writeFile(
      runner,
      `
      import { runSupervisor } from ${JSON.stringify(supervisorUrl)};
      runSupervisor({ name: 'ExecutionTest', startupMessage: 'fixture',
        resolveWorkerEntry: () => ${JSON.stringify(worker)}, workerExecArgv: [],
        workerEnv: process.env, restartOnCrash: false });
    `,
    );
    const child = spawn(process.execPath, ["--import", "tsx", runner], {
      env: {
        ...process.env,
        FDE_HOME: home,
        FDE_EXECUTION_SERVICE: mode === "environment" ? "1" : "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Fixture timed out: ${stderr}`)), 20000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      expect(code, stderr).toBe(0);
      const descendant = Number(stdout.match(/DESCENDANT=(\d+)/)?.[1]);
      expect(Number.isInteger(descendant), stdout).toBe(true);
      expect(process.kill(descendant, 0)).toBe(true);
    } finally {
      child.kill("SIGKILL");
      const descendant = Number(stdout.match(/DESCENDANT=(\d+)/)?.[1]);
      if (Number.isInteger(descendant)) {
        try {
          process.kill(descendant, "SIGKILL");
        } catch (error) {
          expect.soft(error).toMatchObject({ code: "ESRCH" });
        }
      }
      await rm(home, { recursive: true, force: true });
    }
  },
  25000,
);
