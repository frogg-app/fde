import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@fde/server";
import { resolveLocalDaemonDiagnosticState } from "./local-daemon.js";
import { runStart, type StartOptions, type StartRuntime } from "./start.js";

class FakeStartRuntime implements StartRuntime {
  states: ReturnType<StartRuntime["resolveState"]>[] = [{ running: false, pidInfo: null }];
  logs: string[] = [];
  errors: string[] = [];
  launches: StartOptions[] = [];
  failure: Error | null = null;
  resolveState: StartRuntime["resolveState"] = () => {
    const state = this.states[0];
    if (!state) throw new Error("Missing fake state");
    if (this.states.length > 1) this.states.shift();
    return state;
  };
  async startDetached(options: StartOptions) {
    this.launches.push(options);
    if (this.failure) throw this.failure;
    return { pid: 5678, logPath: "/test/fde/daemon.log" };
  }
  startForeground(options: StartOptions) {
    this.launches.push(options);
    return 0;
  }
  log(message: string) {
    this.logs.push(message);
  }
  error(message: string) {
    this.errors.push(message);
  }
  exit(code: number): never {
    throw new Error(`exit:${code}`);
  }
}

describe("daemon start feedback", () => {
  test.each([false, true])(
    "existing daemon is a quiet success (foreground=%s)",
    async (foreground) => {
      const runtime = new FakeStartRuntime();
      runtime.states = [{ running: true, pidInfo: { pid: 1234 } }];
      await runStart({ home: "/test/fde", foreground }, runtime);
      expect(runtime.launches).toEqual([]);
      expect(runtime.logs).toEqual(["Daemon already running (PID 1234)."]);
      expect(runtime.errors).toEqual([]);
    },
  );

  test("a stale PID file does not prevent a new start", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states = [{ running: false, pidInfo: { pid: 1234 } }];
    await runStart({ home: "/test/fde" }, runtime);
    expect(runtime.launches).toEqual([{ home: "/test/fde" }]);
    expect(runtime.logs[0]).toContain("PID 5678");
    expect(runtime.errors).toEqual([]);
  });

  test("a concurrent successful start suppresses the losing child's failure logs", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states.push({ running: true, pidInfo: { pid: 5678 } });
    runtime.failure = new Error("Daemon failed\nRecent daemon logs: old errors");
    await runStart({}, runtime);
    expect(runtime.logs).toEqual(["Daemon already running (PID 5678)."]);
    expect(runtime.errors).toEqual([]);
  });

  test("real startup failures still report an error and fail", async () => {
    const runtime = new FakeStartRuntime();
    runtime.failure = new Error("Could not bind daemon socket");
    await expect(runStart({}, runtime)).rejects.toThrow("exit:1");
    expect(runtime.errors[0]).toContain("Could not bind daemon socket");
  });

  test("invalid start flags remain errors even with a running daemon", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states = [{ running: true, pidInfo: { pid: 1234 } }];
    await expect(runStart({ listen: "0.0.0.0:9999", port: "9999" }, runtime)).rejects.toThrow(
      "exit:1",
    );
    expect(runtime.launches).toEqual([]);
    expect(runtime.errors[0]).toContain("Cannot use --listen and --port together");
  });

  test.each([false, true])(
    "schema-invalid persisted relay does not block precheck (running=%s)",
    async (running) => {
      const home = await mkdtemp(path.join(os.tmpdir(), "fde-start-config-"));
      try {
        await writeFile(
          path.join(home, "config.json"),
          JSON.stringify({ version: 1, daemon: { relay: { enabled: "yes" } } }),
        );
        if (running)
          await writeFile(path.join(home, "fde.pid"), JSON.stringify({ pid: process.pid }));
        expect(() => loadConfig(home, { env: {} })).toThrow("[Config] Invalid config");
        const runtime = new FakeStartRuntime();
        runtime.resolveState = resolveLocalDaemonDiagnosticState;
        await runStart({ home, relay: false }, runtime);
        if (running) {
          expect(runtime.logs).toEqual([`Daemon already running (PID ${process.pid}).`]);
          expect(runtime.launches).toEqual([]);
        } else {
          expect(runtime.launches).toEqual([{ home, relay: false }]);
        }
        expect(runtime.errors).toEqual([]);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );
});
