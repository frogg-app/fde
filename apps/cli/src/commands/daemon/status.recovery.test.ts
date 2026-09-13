import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { expect, test } from "vitest";
import { loadConfig } from "@fde/server";
import { resolveLocalDaemonDiagnosticState } from "./local-daemon.js";
import { runStatusCommand, selectRelayStatus } from "./status.js";

test.each([
  ["invalid relay", JSON.stringify({ version: 1, daemon: { relay: { enabled: true } } })],
  ["malformed JSON", "{broken"],
])(
  "status reports %s as a diagnostic without a default network probe",
  async (_label, config) => {
    const home = await mkdtemp(path.join(os.tmpdir(), "fde-status-recovery-"));
    try {
      await writeFile(path.join(home, "config.json"), config);
      expect(() => loadConfig(home, { env: {} })).toThrow();
      const result = await runStatusCommand({ home }, new Command());
      expect(result.data).toEqual(
        expect.arrayContaining([
          { key: "Local Daemon", value: "stopped" },
          { key: "Connected Daemon", value: "not_probed" },
          { key: "Listen", value: "" },
          { key: "Relay", value: "unknown" },
          { key: "Note", value: expect.stringContaining("Configuration error:") },
        ]),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  },
  15_000,
);

test("status retains the recorded owner and listen target when config is invalid", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "fde-status-owner-"));
  try {
    await writeFile(
      path.join(home, "config.json"),
      JSON.stringify({ version: 1, daemon: { relay: { enabled: true } } }),
    );
    await writeFile(
      path.join(home, "fde.pid"),
      JSON.stringify({ pid: process.pid, listen: "127.0.0.1:1" }),
    );
    const state = resolveLocalDaemonDiagnosticState({ home });
    expect(state).toMatchObject({
      home,
      running: true,
      listen: "127.0.0.1:1",
      pidInfo: { pid: process.pid },
      configError: expect.stringContaining(
        "Configure a relay endpoint before enabling relay for this product.",
      ),
    });
    const result = await runStatusCommand({ home }, new Command());
    expect(result.data).toEqual(
      expect.arrayContaining([
        { key: "Local Daemon", value: "unresponsive" },
        { key: "Connected Daemon", value: "unreachable" },
        { key: "Listen", value: "127.0.0.1:1" },
        { key: "Relay", value: "unknown" },
        { key: "Note", value: expect.stringContaining("Configuration error:") },
      ]),
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("live relay facts override unknown persisted relay config", () => {
  expect(selectRelayStatus({ persisted: null })).toBe("unknown");
  expect(
    selectRelayStatus({
      persisted: null,
      live: {
        enabled: false,
        endpoint: "",
        publicEndpoint: "",
        useTls: false,
        publicUseTls: false,
      },
    }),
  ).toBe("disabled");
});
