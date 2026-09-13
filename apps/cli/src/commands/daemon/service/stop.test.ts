import { describe, expect, test } from "vitest";
import { stopOwnedDaemonService, type StopServiceRuntime } from "./stop.js";

class ServiceRuntime implements StopServiceRuntime {
  platform: NodeJS.Platform = "linux";
  uid = 1000;
  cgroup = "";
  owner = "123";
  stopStatus = 0;
  parent = "1";
  killMode = "mixed";
  calls: string[][] = [];
  timeouts: (number | undefined)[] = [];
  readCgroup() {
    return this.cgroup;
  }
  run(command: string, args: string[], timeoutMs?: number) {
    this.timeouts.push(timeoutMs);
    this.calls.push([command, ...args]);
    if (command === "ps") return { status: 0, stdout: this.parent, stderr: "" };
    if (args.includes("--property=KillMode"))
      return { status: 0, stdout: this.killMode, stderr: "" };
    const query = args.includes("show") || args.includes("print");
    return {
      status: query ? 0 : this.stopStatus,
      stdout: this.owner,
      stderr: "service refused",
    };
  }
}

describe("stop service ownership", () => {
  test("stops matching systemd owner through supervision", () => {
    const runtime = new ServiceRuntime();
    expect(stopOwnedDaemonService({ pid: 123, preserveExecution: false }, runtime)).toBe(true);
    expect(runtime.calls.at(-1)).toEqual(["systemctl", "--user", "stop", "frogg-daemon.service"]);
    expect(runtime.timeouts.at(-1)).toBe(35_000);
  });
  test("does not stop another home's service", () => {
    const runtime = new ServiceRuntime();
    expect(stopOwnedDaemonService({ pid: 456, preserveExecution: false }, runtime)).toBe(false);
    expect(runtime.calls.some((call) => call.includes("stop"))).toBe(false);
  });
  test("recognizes the supervisor child of a foreground CLI service", () => {
    const runtime = new ServiceRuntime();
    runtime.parent = "123";
    expect(stopOwnedDaemonService({ pid: 456, preserveExecution: false }, runtime)).toBe(true);
    expect(runtime.calls.at(-1)).toEqual(["systemctl", "--user", "stop", "frogg-daemon.service"]);
    expect(runtime.timeouts.at(-1)).toBe(35_000);
  });
  test("uses graceful owner shutdown for a mixed unit with retained execution", () => {
    const runtime = new ServiceRuntime();
    expect(stopOwnedDaemonService({ pid: 123, preserveExecution: true }, runtime)).toBe(
      "preserve_execution",
    );
    expect(runtime.calls.some((call) => call.includes("stop"))).toBe(false);
  });
  test("stops a process-only unit while preserving independent execution", () => {
    const runtime = new ServiceRuntime();
    runtime.killMode = "process";
    expect(stopOwnedDaemonService({ pid: 123, preserveExecution: true }, runtime)).toBe(true);
  });
  test("ExecStop does not recursively ask systemd to stop itself", () => {
    const runtime = new ServiceRuntime();
    runtime.cgroup = "0::/user.slice/frogg-daemon.service\n";
    expect(stopOwnedDaemonService({ pid: 123, preserveExecution: false }, runtime)).toBe(false);
    expect(runtime.calls).toHaveLength(0);
  });
  test("stops matching launchd owner without disabling login registration", () => {
    const runtime = new ServiceRuntime();
    runtime.platform = "darwin";
    runtime.owner = "service = {\n\tpid = 123\n}";
    expect(stopOwnedDaemonService({ pid: 123, preserveExecution: false }, runtime)).toBe(true);
    expect(runtime.calls.at(-1)?.slice(0, 2)).toEqual(["launchctl", "bootout"]);
  });
  test("reports a failed service stop instead of signaling a respawning process", () => {
    const runtime = new ServiceRuntime();
    runtime.stopStatus = 1;
    expect(() => stopOwnedDaemonService({ pid: 123, preserveExecution: false }, runtime)).toThrow(
      "service refused",
    );
  });
});
