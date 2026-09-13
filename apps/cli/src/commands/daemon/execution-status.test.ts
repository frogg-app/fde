import { Command } from "commander";
import { describe, expect, test } from "vitest";
import { runExecutionStatusCommand, type ExecutionStatusDependencies } from "./execution-status.js";
import { runStopCommand, type StopDependencies } from "./stop.js";

const absentGateway: StopDependencies["stopGateway"] = async () => ({
  action: "not_running",
  home: "/scratch/home",
  pid: null,
  forced: false,
  usedLifecycleRpc: false,
  reason: "not_running",
  message: "Daemon is not running",
});
const resolveHome: ExecutionStatusDependencies["resolveHome"] = (home) => home ?? "/scratch/home";

describe("independent execution lifecycle", () => {
  test("reports resident execution separately from the installed version", async () => {
    const homes: string[] = [];
    const getStatus: ExecutionStatusDependencies["getStatus"] = async (home) => {
      homes.push(home);
      return {
        protocolVersion: 1,
        instanceId: "00000000-0000-4000-8000-000000000000",
        version: "0.1.0",
        pid: 123,
        residentAgentCount: 2,
        startedAt: "2026-01-01T00:00:00Z",
        port: 1234,
        controlPort: 1235,
        lifecycle: null,
      };
    };
    const result = await runExecutionStatusCommand({ home: "/scratch/custom" }, new Command(), {
      resolveHome,
      getStatus,
    });
    expect(homes).toEqual(["/scratch/custom"]);
    expect(result.data).toMatchObject({
      status: "running",
      executionVersion: "0.1.0",
      pid: 123,
      residentAgentCount: 2,
    });
    expect(result.data.message).toContain("retain this backend version");
  });

  test("reports absent execution without inventing a zero resident count", async () => {
    const result = await runExecutionStatusCommand({}, new Command(), {
      resolveHome,
      getStatus: async () => null,
    });
    expect(result.data).toMatchObject({
      status: "stopped",
      executionVersion: null,
      residentAgentCount: null,
    });
  });

  test("surfaces unreachable execution instead of reporting it stopped", async () => {
    await expect(
      runExecutionStatusCommand({}, new Command(), {
        resolveHome,
        getStatus: async () => {
          throw new Error("unreachable execution owner");
        },
      }),
    ).rejects.toThrow("unreachable execution owner");
  });

  test("stop --all stops execution even with no gateway", async () => {
    const requests: Parameters<StopDependencies["stopExecution"]>[0][] = [];
    const result = await runStopCommand({ all: true }, new Command(), {
      stopGateway: absentGateway,
      stopExecution: async (request) => {
        requests.push(request);
        return { stopped: true };
      },
    });
    expect(requests).toEqual([{ home: "/scratch/home", force: true }]);
    expect(result.data).toMatchObject({ action: "stopped", executionStopped: true });
  });

  test("ordinary stop stops supervision and leaves execution running", async () => {
    const requests: Parameters<StopDependencies["stopExecution"]>[0][] = [];
    const gatewayRequests: Parameters<StopDependencies["stopGateway"]>[0][] = [];
    await runStopCommand({}, new Command(), {
      stopGateway: async (request) => {
        gatewayRequests.push(request);
        return absentGateway();
      },
      stopExecution: async (request) => {
        requests.push(request);
        return { stopped: true };
      },
    });
    expect(requests).toEqual([]);
    expect(gatewayRequests).toMatchObject([{ stopService: true }]);
  });

  test("stop --all reports an execution stop failure", async () => {
    await expect(
      runStopCommand({ all: true }, new Command(), {
        stopGateway: absentGateway,
        stopExecution: async () => {
          throw new Error("execution owner unreachable");
        },
      }),
    ).rejects.toMatchObject({ code: "STOP_FAILED" });
  });
});
