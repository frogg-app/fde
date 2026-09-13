import { loadConfig } from "@fde/server";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { stopLocalDaemon } from "./local-daemon.js";

test.each([
  ["invalid relay", JSON.stringify({ version: 1, daemon: { relay: { enabled: true } } })],
  ["malformed JSON", "{broken"],
])("stop recovers a recorded owner despite %s config", async (_label, config) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "fde-stop-recovery-"));
  const owner = spawn(
    process.execPath,
    ["-e", "console.log('ready'); setInterval(() => {}, 1000)"],
    {
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  try {
    if (!owner.stdout) throw new Error("Missing fixture stdout");
    await once(owner.stdout, "data");
    await writeFile(path.join(home, "config.json"), config);
    if (_label === "invalid relay") {
      expect(() => loadConfig(home, { env: {} })).toThrow(
        "Configure a relay endpoint before enabling relay for this product.",
      );
    }
    await writeFile(
      path.join(home, "fde.pid"),
      JSON.stringify({ pid: owner.pid, listen: "127.0.0.1:1" }),
    );
    const result = await stopLocalDaemon({ home, timeoutMs: 2000 });
    expect(result).toMatchObject({
      action: "stopped",
      reason: "owner_pid_signal",
    });
    expect(owner.exitCode !== null || owner.signalCode !== null).toBe(true);
    expect(await stopLocalDaemon({ home })).toMatchObject({
      action: "not_running",
    });
  } finally {
    owner.kill("SIGKILL");
    await rm(home, { recursive: true, force: true });
  }
});

test("stop with no recorded owner ignores invalid startup config and its listen address", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "fde-stop-empty-"));
  try {
    await writeFile(path.join(home, "config.json"), "{broken");
    expect(await stopLocalDaemon({ home })).toMatchObject({
      action: "not_running",
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
