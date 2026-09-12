import type { HostRuntimeConnectionStatus } from "@/runtime/host-runtime";

export function sidebarConnectionMessage(status: HostRuntimeConnectionStatus | undefined) {
  switch (status) {
    case "online":
      return null;
    case "offline":
    case "error":
      return "subagents.offline";
    default:
      return "common.connectionStatus.connecting";
  }
}
