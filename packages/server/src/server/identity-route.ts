import type { RequestHandler } from "express";

/**
 * `GET /api/identity`: unauthenticated, tiny, and safe to expose, so LAN
 * scanners and the desktop app can list daemons before pairing. It reveals
 * nothing a `hello` handshake would not, and it never includes credentials or
 * the claim token.
 */
export const IDENTITY_PRODUCT = "fde";

export interface DaemonIdentity {
  product: typeof IDENTITY_PRODUCT;
  serverId: string;
  hostname: string;
  version: string;
  listen: string | null;
  pairingRequired: boolean;
}

export interface IdentityRouteDependencies {
  serverId: string;
  version: string;
  hostname: () => string;
  listen: () => string | null;
  isClaimed: () => boolean;
}

export function describeDaemonIdentity(deps: IdentityRouteDependencies): DaemonIdentity {
  return {
    product: IDENTITY_PRODUCT,
    serverId: deps.serverId,
    hostname: deps.hostname(),
    version: deps.version,
    listen: deps.listen(),
    pairingRequired: !deps.isClaimed(),
  };
}

export function createIdentityRouteHandler(deps: IdentityRouteDependencies): RequestHandler {
  return (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Public, read-only discovery data: LAN scanners running inside the desktop webview or a
    // browser fetch it cross-origin, so it must not depend on the CORS allowlist.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(describeDaemonIdentity(deps));
  };
}
