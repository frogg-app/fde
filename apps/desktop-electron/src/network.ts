import { handleDesktopIpc } from "./ipc-security.js";
import { localAddresses, probeIdentity, reverseLookup } from "./network-service.js";

export function registerNetworkHandlers(): void {
  handleDesktopIpc("fde:network:localAddresses", () => localAddresses());
  handleDesktopIpc("fde:network:reverseLookup", (_event, ip: unknown) => reverseLookup(ip));
  handleDesktopIpc("fde:network:probeIdentity", (_event, url: unknown) => probeIdentity(url));
}
