import type { IncomingMessage } from "node:http";
import net from "node:net";

import type { ClaimStore } from "./claim-store.js";

/**
 * Who may talk to the daemon without a bearer token.
 *
 * - A configured password always requires a bearer: it is the opt-in lock.
 * - Loopback clients with no password stay open: a single-machine setup (CLI,
 *   desktop app, dev daemon) must never be locked out of its own daemon.
 * - Private-network clients (RFC 1918, link-local, ULA) are treated like
 *   loopback while `daemon.auth.trustLan` is on (the default): no bearer, no
 *   claim gate. Turning it off makes the LAN behave like the public internet.
 * - Public clients need a bearer. Before the first device pairs ("unclaimed")
 *   no bearer can succeed, and the web UI shows the claim page instead; after
 *   pairing, the minted device credential is the bearer.
 *
 * The client address honors `trustedProxies` the same way Express's
 * `trust proxy` does for `X-Forwarded-For`, so a reverse proxy on loopback
 * does not turn every visitor into a loopback client.
 */
export type TrustedProxiesSetting = true | readonly string[];

/** Where a request comes from, after trusted proxies are resolved. */
export type ClientLocality = "loopback" | "lan" | "public";

export const DEFAULT_TRUST_LAN = true;

type RequestLike = Pick<IncomingMessage, "headers" | "socket">;

export interface DaemonAccessPolicy {
  isClaimed(): boolean;
  credentialHashes(): readonly string[];
  /** Whether private-network clients are currently treated like loopback. */
  trustLan(): boolean;
  clientLocality(req: RequestLike): ClientLocality;
  isLoopbackClient(req: RequestLike): boolean;
  /** Loopback, or LAN while `trustLan` is on: no bearer unless a password is set. */
  isTrustedClient(req: RequestLike): boolean;
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

function ipv4Octets(address: string): [number, number, number, number] | null {
  if (!net.isIPv4(address)) return null;
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

/**
 * Private/local address space, the "same building" a daemon owner reasonably
 * shares: IPv4 10/8, 172.16/12, 192.168/16, 169.254/16 (link-local); IPv6
 * fc00::/7 (ULA) and fe80::/10 (link-local); and their IPv4-mapped forms.
 * Deliberately excluded: CGNAT 100.64/10 (an ISP's network, not yours),
 * loopback (its own class), and everything routable.
 */
export function isPrivateLanIp(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = normalizeIp(address);
  const octets = ipv4Octets(normalized);
  if (octets) {
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (!net.isIPv6(normalized)) return false;
  const firstHextet = normalized.split(":")[0] ?? "";
  if (firstHextet.length === 0) return false;
  const value = Number.parseInt(firstHextet, 16);
  if (!Number.isInteger(value)) return false;
  // fc00::/7 covers fc00–fdff; fe80::/10 covers fe80–febf.
  if ((value & 0xfe00) === 0xfc00) return true;
  if ((value & 0xffc0) === 0xfe80) return true;
  return false;
}

export function classifyClientAddress(address: string | undefined): ClientLocality {
  if (isLoopbackIp(address)) return "loopback";
  if (isPrivateLanIp(address)) return "lan";
  return "public";
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
  client: ClientLocality;
  trustLan: boolean;
}

export function isClientTrusted(client: ClientLocality, trustLan: boolean): boolean {
  return client === "loopback" || (client === "lan" && trustLan);
}

export function isAuthRequired(input: AuthRequirementInput): boolean {
  if (input.password) return true;
  return !isClientTrusted(input.client, input.trustLan);
}

export function createAccessPolicy(input: {
  claimStore: ClaimStore;
  getTrustedProxies: () => TrustedProxiesSetting;
  getTrustLan?: () => boolean;
}): DaemonAccessPolicy {
  const trustLan = (): boolean => input.getTrustLan?.() ?? DEFAULT_TRUST_LAN;
  const clientLocality = (req: RequestLike): ClientLocality => {
    const remoteAddress = req.socket?.remoteAddress;
    // Unix sockets and named pipes have no remote address and are local by construction.
    if (!remoteAddress) return "loopback";
    return classifyClientAddress(
      resolveClientAddress({
        remoteAddress,
        forwardedFor: req.headers["x-forwarded-for"],
        trustedProxies: input.getTrustedProxies(),
      }),
    );
  };
  return {
    isClaimed: () => input.claimStore.isClaimed(),
    credentialHashes: () => input.claimStore.credentialHashes(),
    trustLan,
    clientLocality,
    isLoopbackClient: (req) => clientLocality(req) === "loopback",
    isTrustedClient: (req) => isClientTrusted(clientLocality(req), trustLan()),
  };
}
