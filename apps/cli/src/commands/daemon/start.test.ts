import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  resolveLocalDaemonState,
  startLocalDaemonDetached,
  startLocalDaemonForeground,
  type LocalDaemonState,
} from "./local-daemon.js";
import { runStart } from "./start.js";

vi.mock("./local-daemon.js", () => ({
  resolveLocalDaemonState: vi.fn(),
  startLocalDaemonDetached: vi.fn(),
  startLocalDaemonForeground: vi.fn(),
}));

function state(running: boolean, pid: number | null = null): LocalDaemonState {
  return {
    home: "/test/fde",
    listen: "0.0.0.0:9999",
    relayEnabled: false,
    relayEndpoint: "",
    relayUseTls: false,
    relayPublicUseTls: false,
    logPath: "/test/fde/daemon.log",
    pidPath: "/test/fde/fde.pid",
    pidInfo: pid === null ? null : { pid },
    running,
    stalePidFile: pid !== null && !running,
  };
}

describe("daemon start feedback", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit:${code}`);
    });
    vi.mocked(resolveLocalDaemonState).mockReturnValue(state(false));
  });

  afterEach(() => vi.restoreAllMocks());

  test.each([false, true])(
    "existing daemon is a quiet success (foreground=%s)",
    async (foreground) => {
      vi.mocked(resolveLocalDaemonState).mockReturnValue(state(true, 1234));
      await runStart({ home: "/test/fde", foreground });
      expect(resolveLocalDaemonState).toHaveBeenCalledWith({ home: "/test/fde" });
      expect(startLocalDaemonDetached).not.toHaveBeenCalled();
      expect(startLocalDaemonForeground).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledExactlyOnceWith("Daemon already running (PID 1234).");
      expect(console.error).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    },
  );

  test("a stale PID file does not prevent a new start", async () => {
    vi.mocked(resolveLocalDaemonState).mockReturnValue(state(false, 1234));
    vi.mocked(startLocalDaemonDetached).mockResolvedValue({
      pid: 5678,
      logPath: "/test/fde/daemon.log",
    });
    await runStart({ home: "/test/fde" });
    expect(startLocalDaemonDetached).toHaveBeenCalledOnce();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("PID 5678"));
    expect(console.error).not.toHaveBeenCalled();
  });

  test("a concurrent successful start suppresses the losing child's failure logs", async () => {
    vi.mocked(resolveLocalDaemonState)
      .mockReturnValueOnce(state(false))
      .mockReturnValueOnce(state(true, 5678));
    vi.mocked(startLocalDaemonDetached).mockRejectedValue(
      new Error("Daemon failed\nRecent daemon logs: old errors"),
    );
    await runStart({});
    expect(console.log).toHaveBeenCalledExactlyOnceWith("Daemon already running (PID 5678).");
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("real startup failures still report an error and fail", async () => {
    vi.mocked(startLocalDaemonDetached).mockRejectedValue(
      new Error("Could not bind daemon socket"),
    );
    await expect(runStart({})).rejects.toThrow("exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not bind daemon socket"),
    );
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("invalid start flags remain errors even with a running daemon", async () => {
    vi.mocked(resolveLocalDaemonState).mockReturnValue(state(true, 1234));
    await expect(runStart({ listen: "0.0.0.0:9999", port: "9999" })).rejects.toThrow("exit:1");
    expect(startLocalDaemonDetached).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Cannot use --listen and --port together"),
    );
  });
});
