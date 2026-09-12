type DesktopDaemonState = "starting" | "running" | "stopped" | "errored";

export interface DesktopDaemonStatus {
  serverId: string;
  status: DesktopDaemonState;
  listen: string | null;
  hostname: string | null;
  pid: number | null;
  home: string;
  version: string | null;
  desktopManaged: boolean;
  error: string | null;
}

// A reachable configured address can belong to another home. Only this home's PID state establishes local liveness.
export function statusFromDaemonProbe(
  payload: Record<string, unknown>,
  home: string,
): DesktopDaemonStatus {
  const local = typeof payload.localDaemon === "string" ? payload.localDaemon : "stopped";
  const pid =
    typeof payload.pid === "number" && Number.isInteger(payload.pid) && payload.pid > 0
      ? payload.pid
      : null;
  const processAlive = local === "running" && pid !== null;
  const stalledProcess = local === "unresponsive" && pid !== null;
  let status: DesktopDaemonState = "stopped";
  if (processAlive) {
    status = "running";
  } else if (stalledProcess) {
    status = "errored";
  }
  return {
    serverId: typeof payload.serverId === "string" ? payload.serverId : "",
    status,
    listen: typeof payload.listen === "string" ? payload.listen : null,
    hostname:
      status === "running" && typeof payload.hostname === "string" ? payload.hostname : null,
    pid: processAlive || stalledProcess ? pid : null,
    home,
    version:
      (processAlive || stalledProcess) && typeof payload.daemonVersion === "string"
        ? payload.daemonVersion
        : null,
    desktopManaged: (processAlive || stalledProcess) && payload.desktopManaged === true,
    error: null,
  };
}
