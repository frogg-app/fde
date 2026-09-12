import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  stop: vi.fn(),
  gatewayStop: vi.fn(),
}));
vi.mock("@fde/server", () => ({
  getExecutionServiceStatus: mocks.status,
  stopExecutionService: mocks.stop,
}));
vi.mock("./local-daemon.js", () => ({
  resolveLocalPaseoHome: (home: string | undefined) => home ?? "/scratch/home",
  stopLocalDaemon: mocks.gatewayStop,
  DEFAULT_STOP_TIMEOUT_MS: 15000,
  DEFAULT_KILL_TIMEOUT_MS: 3000,
}));
import { runExecutionStatusCommand } from "./execution-status.js";
import { runStopCommand } from "./stop.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gatewayStop.mockResolvedValue({
    action: "not_running",
    home: "/scratch/home",
    pid: null,
    forced: false,
    usedLifecycleRpc: false,
    reason: "not_running",
    message: "Daemon is not running",
  });
});

describe("independent execution lifecycle", () => {
  test("reports resident execution separately from the installed version", async () => {
    mocks.status.mockResolvedValue({
      version: "0.1.0",
      pid: 123,
      residentAgentCount: 2,
    });
    const result = await runExecutionStatusCommand({ home: "/scratch/custom" }, new Command());
    expect(mocks.status).toHaveBeenCalledWith("/scratch/custom");
    expect(result.data).toMatchObject({
      status: "running",
      executionVersion: "0.1.0",
      pid: 123,
      residentAgentCount: 2,
    });
    expect(result.data.message).toContain("retain this backend version");
  });

  test("reports absent execution without inventing a zero resident count", async () => {
    mocks.status.mockResolvedValue(null);
    const result = await runExecutionStatusCommand({}, new Command());
    expect(result.data).toMatchObject({
      status: "stopped",
      executionVersion: null,
      residentAgentCount: null,
    });
  });

  test("surfaces unreachable execution instead of reporting it stopped", async () => {
    mocks.status.mockRejectedValue(new Error("unreachable execution owner"));
    await expect(runExecutionStatusCommand({}, new Command())).rejects.toThrow(
      "unreachable execution owner",
    );
  });

  test("stop --all stops execution even with no gateway", async () => {
    mocks.stop.mockResolvedValue({ stopped: true });
    const result = await runStopCommand({ all: true }, new Command());
    expect(mocks.stop).toHaveBeenCalledWith({
      home: "/scratch/home",
      force: true,
    });
    expect(result.data).toMatchObject({
      action: "stopped",
      executionStopped: true,
    });
  });

  test("ordinary stop leaves execution running", async () => {
    await runStopCommand({}, new Command());
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  test("stop --all reports an execution stop failure", async () => {
    mocks.stop.mockRejectedValue(new Error("execution owner unreachable"));
    await expect(runStopCommand({ all: true }, new Command())).rejects.toMatchObject({
      code: "STOP_FAILED",
    });
  });
});
