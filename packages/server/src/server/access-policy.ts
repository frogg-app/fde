import type { IncomingMessage } from "node:http";
import net from "node:net";

import type { ClaimStore } from "./claim-store.js";

/**
 * Who may talk to the daemon without a bearer token.
 *
 * - A configured password always requires a bearer (today's behavior).
 * - Loopback clients with no password stay open: a single-machine setup (CLI,
 *   desktop app, dev daemon) must never be locked out of its own daemon.
 * - Anything beyond loopback needs a bearer. Before the first device pairs
 *   ("unclaimed") no bearer can succeed, and the web UI shows the claim page
 *   instead; after pairing, the minted device credential is the bearer.
 *
 * The client address honors `trustedProxies` the same way Express's
 * `trust proxy` does for `X-Forwarded-For`, so a reverse proxy on loopback
 * does not turn every LAN visitor into a loopback client.
 */
export type TrustedProxiesSetting = true | readonly string[];

export interface DaemonAccessPolicy {
  isClaimed(): boolean;
  credentialHashes(): readonly string[];
  isLoopbackClient(req: Pick<IncomingMessage, "headers" | "socket">): boolean;
}

export function isLoopbackIp(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase();
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  return net.isIPv4(ipv4) && ipv4.startsWith("127.");
}

function normalizeIp(address: string): string {
  const trimmed = address.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
}

function isTrustedProxy(address: string, trustedProxies: TrustedProxiesSetting): boolean {
  if (trustedProxies === true) return true;
  for (const entry of trustedProxies) {
    const normalized = entry.trim().toLowerCase();
    if (normalized === "loopback" && isLoopbackIp(address)) return true;
    if (net.isIP(normalized) !== 0 && normalizeIp(normalized) === normalizeIp(address)) return true;
  }
  return false;
}

/**
 * Resolves the client address the way `proxy-addr` does: walk X-Forwarded-For
 * from the right, skipping hops that are trusted proxies. CIDR and the
 * "linklocal"/"uniquelocal" keywords are treated as untrusted (the safe
 * direction: more gating, never less).
 */
export function resolveClientAddress(input: {
  remoteAddress: string | undefined;
  forwardedFor: string | string[] | undefined;
  trustedProxies: TrustedProxiesSetting;
}): string | undefined {
  const { remoteAddress } = input;
  if (!remoteAddress) return undefined;
  const forwarded = (
    Array.isArray(input.forwardedFor) ? input.forwardedFor.join(",") : (input.forwardedFor ?? "")
  )
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  let client = remoteAddress;
  for (let index = forwarded.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(client, input.trustedProxies)) break;
    const hop = forwarded[index]!;
    if (net.isIP(normalizeIp(hop)) === 0) break;
    client = hop;
  }
  return client;
}

export interface AuthRequirementInput {
  password: string | undefined;
  claimed: boolean;
  loopback: boolean;
}

export function isAuthRequired(input: AuthRequirementInput): boolean {
  if (input.password) return true;
  return !input.loopback;
}

export function createAccessPolicy(input: {
  claimStore: ClaimStore;
  getTrustedProxies: () => TrustedProxiesSetting;
}): DaemonAccessPolicy {
  return {
    isClaimed: () => input.claimStore.isClaimed(),
    credentialHashes: () => input.claimStore.credentialHashes(),
    isLoopbackClient: (req) => {
      const remoteAddress = req.socket?.remoteAddress;
      // Unix sockets and named pipes have no remote address and are local by construction.
      if (!remoteAddress) return true;
      return isLoopbackIp(
        resolveClientAddress({
          remoteAddress,
          forwardedFor: req.headers["x-forwarded-for"],
          trustedProxies: input.getTrustedProxies(),
        }),
      );
    },
  };
}
