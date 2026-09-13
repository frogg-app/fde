import { brand } from "@frogg/branding";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface ServiceCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface StopServiceRuntime {
  platform: NodeJS.Platform;
  uid: number | undefined;
  readCgroup(): string;
  run(command: string, args: string[], timeoutMs?: number): ServiceCommandResult;
}

const runtime: StopServiceRuntime = {
  platform: process.platform,
  uid: process.getuid?.(),
  readCgroup() {
    try {
      return readFileSync("/proc/self/cgroup", "utf8");
    } catch {
      return "";
    }
  },
  run(command, args, timeoutMs = 2000) {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.error?.message ?? result.stderr ?? "",
    };
  },
};

function isOwnedByService(pid: number, servicePid: number, adapter: StopServiceRuntime): boolean {
  if (!Number.isInteger(servicePid) || servicePid <= 1) return false;
  let current = pid;
  // Foreground CLI launches the supervisor as a child of the service process.
  for (let depth = 0; depth < 8 && current > 1; depth++) {
    if (current === servicePid) return true;
    const parent = adapter.run("ps", ["-o", "ppid=", "-p", String(current)]);
    if (parent.status !== 0) return false;
    const parentPid = Number(parent.stdout.trim());
    if (!Number.isInteger(parentPid) || parentPid === current) return false;
    current = parentPid;
  }
  return false;
}

/** Stop supervision only when its running owner matches this home's PID lock. */
export interface StopOwnedServiceOptions {
  pid: number;
  preserveExecution: boolean;
}

export function stopOwnedDaemonService(
  { pid, preserveExecution }: StopOwnedServiceOptions,
  adapter: StopServiceRuntime = runtime,
): boolean | "preserve_execution" {
  let command: string;
  let args: string[];
  if (adapter.platform === "linux") {
    const unit = `${brand.serviceName}.service`;
    // ExecStop invokes the CLI itself; asking systemd to stop again deadlocks.
    if (
      adapter
        .readCgroup()
        .split("/")
        .some((part) => part.trim() === unit)
    )
      return false;
    const owner = adapter.run("systemctl", [
      "--user",
      "show",
      unit,
      "--property=MainPID",
      "--value",
    ]);
    if (owner.status !== 0 || !isOwnedByService(pid, Number(owner.stdout.trim()), adapter))
      return false;
    if (preserveExecution) {
      const killMode = adapter.run("systemctl", [
        "--user",
        "show",
        unit,
        "--property=KillMode",
        "--value",
      ]);
      if (killMode.status !== 0 || killMode.stdout.trim() !== "process") {
        return "preserve_execution";
      }
    }
    command = "systemctl";
    args = ["--user", "stop", unit];
  } else if (adapter.platform === "darwin" && adapter.uid !== undefined) {
    const target = `gui/${adapter.uid}/${brand.launchdLabel}`;
    const owner = adapter.run("launchctl", ["print", target]);
    const recordedPid = owner.stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1];
    if (owner.status !== 0 || !isOwnedByService(pid, Number(recordedPid), adapter)) return false;
    command = "launchctl";
    args = ["bootout", target];
  } else {
    return false;
  }
  // Allow the unit's 30s stop deadline to include our nested ExecStop.
  // Queries retain the short default timeout.
  const result = adapter.run(command, args, 35_000);
  if (result.status !== 0) {
    throw new Error(`Unable to stop daemon service: ${result.stderr.trim()}`);
  }
  return true;
}
