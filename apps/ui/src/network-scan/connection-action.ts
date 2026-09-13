import type { DiscoveredServer } from "./types";

/** The 0.6 namespace migration requires upgrading both client and daemon. */
export function resolveDiscoveredConnectionAction(
  server: Pick<DiscoveredServer, "version" | "pairingRequired">,
): "upgrade" | "pair" | "connect" {
  const version = server.version
    ?.trim()
    .match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (version && Number(version[1]) === 0 && Number(version[2]) < 6) {
    return "upgrade";
  }
  return server.pairingRequired ? "pair" : "connect";
}
