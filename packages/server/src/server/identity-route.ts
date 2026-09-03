import type { IncomingMessage } from "node:http";
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
  /**
   * Whether *this requester* must pair (or use a password) before it can
   * connect. False for loopback, for the LAN while `lanTrusted`, and for
   * everyone once the daemon is claimed or has a password.
   */
  pairingRequired: boolean;
  /** The daemon's `daemon.auth.trustLan` mode: private-network clients connect without pairing. */
  lanTrusted: boolean;
}

type RequestLike = Pick<IncomingMessage, "headers" | "socket">;

export interface IdentityRouteDependencies {
  serverId: string;
  version: string;
  hostname: () => string;
  listen: () => string | null;
  isClaimed: () => boolean;
  trustLan: () => boolean;
  /** Loopback or trusted-LAN requester (see access-policy.ts). */
  isTrustedClient: (req: RequestLike) => boolean;
}

export function describeDaemonIdentity(
  deps: IdentityRouteDependencies,
  req: RequestLike,
): DaemonIdentity {
  return {
    product: IDENTITY_PRODUCT,
    serverId: deps.serverId,
    hostname: deps.hostname(),
    version: deps.version,
    listen: deps.listen(),
    pairingRequired: !deps.isClaimed() && !deps.isTrustedClient(req),
    lanTrusted: deps.trustLan(),
  };
}

/**
 * CORS for discovery: any origin may read it, and Chromium's Private Network
 * Access preflight (`Access-Control-Request-Private-Network: true`, sent when a
 * public-address-space page fetches a LAN address) is answered with
 * `Access-Control-Allow-Private-Network: true`. Newer Chromium (Local Network
 * Access, 138+) gates the request on a user permission instead and never sends
 * the preflight, so the desktop shell probes from Rust; these headers still
 * serve browsers in preflight mode.
 */
function setDiscoveryCorsHeaders(res: Parameters<RequestHandler>[1]): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

export function createIdentityRouteHandler(deps: IdentityRouteDependencies): RequestHandler {
  return (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    // Public, read-only discovery data: LAN scanners running inside the desktop webview or a
    // browser fetch it cross-origin, so it must not depend on the CORS allowlist.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.json(describeDaemonIdentity(deps, req));
    setDiscoveryCorsHeaders(res);
    res.json(describeDaemonIdentity(deps));
  };
}

/**
 * `OPTIONS /api/identity`. Register it before the daemon's CORS middleware
 * (which answers every OPTIONS with a bare 204), e.g.
 * `app.options("/api/identity", createIdentityPreflightHandler())`.
 */
export function createIdentityPreflightHandler(): RequestHandler {
  return (_req, res) => {
    setDiscoveryCorsHeaders(res);
    res.setHeader("Access-Control-Max-Age", "600");
    res.status(204).end();
  };
}
