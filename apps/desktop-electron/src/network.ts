import { handleDesktopIpc } from "./ipc-security.js";
import { localAddresses, probeIdentity, reverseLookup } from "./network-service.js";

export function registerNetworkHandlers(): void {
  handleDesktopIpc("frogg:network:localAddresses", () => localAddresses());
  handleDesktopIpc("frogg:network:reverseLookup", (_event, ip: unknown) => reverseLookup(ip));
  const probes = new Map<string, AbortController>();
  handleDesktopIpc(
    "frogg:network:probeIdentity",
    async (event, url: unknown, requestId: unknown) => {
      if (requestId === undefined) return probeIdentity(url);
      if (typeof requestId !== "string") throw new Error("Expected a probe request ID");
      const key = `${event.sender.id}:${requestId}`;
      const controller = new AbortController();
      probes.set(key, controller);
      try {
        return await probeIdentity(url, controller.signal);
      } finally {
        probes.delete(key);
      }
    },
  );
  handleDesktopIpc("frogg:network:cancelProbe", (event, requestId: unknown) => {
    if (typeof requestId !== "string") throw new Error("Expected a probe request ID");
    probes.get(`${event.sender.id}:${requestId}`)?.abort();
  });
}
