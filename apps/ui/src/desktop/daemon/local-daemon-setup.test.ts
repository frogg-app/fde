import { describe, expect, it, vi } from "vitest";
import type { DesktopDaemonStatus } from "./desktop-daemon";
import { setUpLocalDaemon, type LocalDaemonSetupDeps } from "./local-daemon-setup";

const running: DesktopDaemonStatus = {
  serverId: "srv",
  status: "running",
  listen: "127.0.0.1:6767",
  hostname: "box",
  pid: 4,
  home: "/h",
  version: "0.1.6",
  desktopManaged: true,
  error: null,
};

function deps(overrides: Partial<LocalDaemonSetupDeps> = {}) {
  const calls: string[] = [];
  const base: LocalDaemonSetupDeps = {
    installBundle: vi.fn(async () => {
      calls.push("install");
    }),
    enableManagement: vi.fn(async () => {
      calls.push("enable");
    }),
    startDaemon: vi.fn(async () => {
      calls.push("start");
      return running;
    }),
    registerConnection: vi.fn(async () => {
      calls.push("register");
      return { ok: true as const };
    }),
  };
  return { calls, deps: { ...base, ...overrides } };
}

describe("setUpLocalDaemon", () => {
  it("installs, enables management, starts and registers in order", async () => {
    const { calls, deps: d } = deps();
    await expect(setUpLocalDaemon({ install: true }, d)).resolves.toBe(running);
    expect(calls).toEqual(["install", "enable", "start", "register"]);
  });

  it("skips the install when the bundle is already there", async () => {
    const { calls, deps: d } = deps();
    await setUpLocalDaemon({ install: false }, d);
    expect(calls).toEqual(["enable", "start", "register"]);
  });

  it("stops at a failed install and surfaces registration errors", async () => {
    const { calls, deps: d } = deps({
      installBundle: async () => {
        throw new Error("checksum mismatch");
      },
    });
    await expect(setUpLocalDaemon({ install: true }, d)).rejects.toThrow("checksum mismatch");
    expect(calls).toEqual([]);

    const failing = deps({ registerConnection: async () => ({ ok: false, error: "no listen" }) });
    await expect(setUpLocalDaemon({ install: false }, failing.deps)).rejects.toThrow("no listen");
    expect(failing.calls).toEqual(["enable", "start"]);
  });
});
