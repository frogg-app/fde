import { handleDesktopIpc } from "./ipc-security.js";
import { localAddresses, probeIdentity, reverseLookup } from "./network-service.js";

export function registerNetworkHandlers(): void {
  handleDesktopIpc("paseo:network:localAddresses", () => localAddresses());
  handleDesktopIpc("paseo:network:reverseLookup", (_event, ip: unknown) => reverseLookup(ip));
  handleDesktopIpc("paseo:network:probeIdentity", (_event, url: unknown) => probeIdentity(url));
}
