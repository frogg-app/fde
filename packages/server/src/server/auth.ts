import { compare, compareSync, hashSync } from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

import { DEFAULT_TRUST_LAN, isAuthRequired, type DaemonAccessPolicy } from "./access-policy.js";
import { hashCredential } from "./claim-store.js";

export const DAEMON_PASSWORD_BCRYPT_COST = 12;

export interface DaemonAuthConfig {
  password?: string;
  /**
   * Paired-device credentials and client locality (loopback / trusted LAN /
   * public), attached by bootstrap. Without it only the password gates access
   * (the pre-pairing behavior).
   */
  access?: DaemonAccessPolicy;
}

export interface BearerAuthRejectContext {
  path: string;
  method: string;
  hasToken: boolean;
}

interface BearerValidationInput {
  password: string | undefined;
  credentialHashes?: readonly string[];
  token: string | null;
}

function matchesCredential(token: string, credentialHashes: readonly string[]): boolean {
  const provided = Buffer.from(hashCredential(token), "hex");
  let matched = false;
  for (const hash of credentialHashes) {
    const expected = Buffer.from(hash, "hex");
    if (expected.length === provided.length && timingSafeEqual(provided, expected)) {
      matched = true;
    }
  }
  return matched;
}

export function isBearerTokenValid(input: BearerValidationInput): boolean {
  return isBearerTokenValidSync(input);
}

export async function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean> {
  const hashes = input.credentialHashes ?? [];
  if (!input.password && hashes.length === 0) {
    return true;
  }
  if (input.token === null) {
    return false;
  }
  if (hashes.length > 0 && matchesCredential(input.token, hashes)) {
    return true;
  }
  return input.password ? compare(input.token, input.password) : false;
}

export function isBearerTokenValidSync(input: BearerValidationInput): boolean {
  const hashes = input.credentialHashes ?? [];
  if (!input.password && hashes.length === 0) {
    return true;
  }
  if (input.token === null) {
    return false;
  }
  if (hashes.length > 0 && matchesCredential(input.token, hashes)) {
    return true;
  }
  return input.password ? compareSync(input.token, input.password) : false;
}

export function hashDaemonPassword(password: string): string {
  return hashSync(password, DAEMON_PASSWORD_BCRYPT_COST);
}

export function extractHttpBearerToken(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  if (scheme !== "Bearer" || tokenParts.length !== 1) {
    return null;
  }
  return tokenParts[0] ?? null;
}

export function extractWsBearerProtocol(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  for (const protocol of value.split(",")) {
    const trimmed = protocol.trim();
    const segments = trimmed.split(".");
    if (segments[0] === "paseo" && segments[1] === "bearer" && segments.length >= 3) {
      return trimmed;
    }
  }

  return null;
}

export function extractWsBearerToken(protocol: string | null): string | null {
  if (!protocol) {
    return null;
  }
  const segments = protocol.split(".");
  if (segments[0] !== "paseo" || segments[1] !== "bearer" || segments.length < 3) {
    return null;
  }
  return segments.slice(2).join(".");
}

export type BearerDecision =
  | { ok: true }
  | { ok: false; reason: "unclaimed" | "missing_token" | "invalid_token" };

type RequestLike = Pick<IncomingMessage, "headers" | "socket">;

/** Does this request need a bearer at all? (see access-policy.ts) */
export function requestNeedsBearer(auth: DaemonAuthConfig | undefined, req: RequestLike): boolean {
  return isAuthRequired({
    password: auth?.password,
    claimed: auth?.access?.isClaimed() ?? false,
    client: auth?.access ? auth.access.clientLocality(req) : "loopback",
    trustLan: auth?.access?.trustLan() ?? DEFAULT_TRUST_LAN,
  });
}

function decideWithSecrets(
  auth: DaemonAuthConfig | undefined,
  token: string | null,
  valid: boolean,
): BearerDecision {
  const hasSecrets = Boolean(auth?.password) || (auth?.access?.credentialHashes().length ?? 0) > 0;
  if (!hasSecrets) return { ok: false, reason: "unclaimed" };
  if (token === null) return { ok: false, reason: "missing_token" };
  return valid ? { ok: true } : { ok: false, reason: "invalid_token" };
}

export function authorizeBearerSync(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
): BearerDecision {
  if (!requestNeedsBearer(auth, req)) return { ok: true };
  const credentialHashes = auth?.access?.credentialHashes() ?? [];
  const valid =
    token !== null && isBearerTokenValidSync({ password: auth?.password, credentialHashes, token });
  return decideWithSecrets(auth, token, valid);
}

export async function authorizeBearerAsync(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
): Promise<BearerDecision> {
  if (!requestNeedsBearer(auth, req)) return { ok: true };
  const credentialHashes = auth?.access?.credentialHashes() ?? [];
  const valid =
    token !== null &&
    (await isBearerTokenValidAsync({ password: auth?.password, credentialHashes, token }));
  return decideWithSecrets(auth, token, valid);
}

export function createRequireBearerMiddleware(
  auth: DaemonAuthConfig | undefined,
  onReject?: (context: BearerAuthRejectContext) => void,
): RequestHandler {
  return (req, res, next) => {
    if (shouldBypassBearerAuth(req.method, req.path)) {
      next();
      return;
    }

    void (async () => {
      try {
        const token = extractHttpBearerToken(req.header("authorization"));
        const decision = await authorizeBearerAsync(auth, req, token);
        if (!decision.ok) {
          onReject?.({
            path: req.path,
            method: req.method,
            hasToken: token !== null,
          });
          res.status(401).json({
            error: "Unauthorized",
            ...(decision.reason === "unclaimed" ? { setup: "unclaimed" } : {}),
          });
          return;
        }

        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

const SELF_AUTHENTICATING_ROUTES = new Set(["/api/files/download", "/mcp/agents"]);
const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/identity",
  "/api/setup/status",
  "/api/setup/claim",
]);

function isBearerFreeRoute(path: string): boolean {
  return PUBLIC_ROUTES.has(path) || SELF_AUTHENTICATING_ROUTES.has(path);
}

export function shouldBypassBearerAuth(method: string, path: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  return isBearerFreeRoute(path);
}

/**
 * Authorizes a request to the Agent MCP endpoint (/mcp/agents), which is exempt
 * from the global daemon-password middleware. Accepts either the per-daemon-run
 * capability token the daemon injects into its own agents' configs and MCP
 * client, or a valid daemon-password bearer (so existing password-authenticated
 * callers keep working). When no daemon password is configured the endpoint is
 * open, matching the global middleware's behavior.
 */
export async function isAgentMcpRequestAuthorized(input: {
  password: string | undefined;
  capabilityToken: string | null;
  authorizationHeader: string | undefined;
}): Promise<boolean> {
  if (!input.password) {
    return true;
  }
  const token = extractHttpBearerToken(input.authorizationHeader);
  if (input.capabilityToken !== null && token !== null) {
    // Constant-time compare; length-guard first because timingSafeEqual throws
    // on differing buffer lengths.
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.capabilityToken);
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return true;
    }
  }
  return isBearerTokenValidAsync({ password: input.password, token });
}
