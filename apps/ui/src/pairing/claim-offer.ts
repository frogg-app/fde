import type { ConnectionOfferV3 } from "@fde/protocol/connection-offer";
import { normalizeHostPort } from "@fde/protocol/daemon-endpoints";

/**
 * Client side of the daemon's first-run claim gate (docs/permissions.md,
 * "Claimed state"). A v3 offer lists the daemon's direct endpoints and a
 * single-use claim token; this module picks an endpoint that answers
 * `/api/identity` with the offer's `serverId`, redeems the token with
 * `POST /api/setup/claim`, and returns the device credential that becomes the
 * host connection's password.
 */
export type ClaimOfferErrorCode =
  | "expired"
  | "unreachable"
  | "identity_mismatch"
  | "token_rejected"
  | "claim_failed";

export class ClaimOfferError extends Error {
  readonly code: ClaimOfferErrorCode;
  /** The endpoints that were tried, so the UI can show them and offer a manual one. */
  readonly endpoints: readonly string[];

  constructor(code: ClaimOfferErrorCode, message: string, endpoints: readonly string[] = []) {
    super(message);
    this.name = "ClaimOfferError";
    this.code = code;
    this.endpoints = endpoints;
  }
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

export interface ClaimOfferOptions {
  fetchImpl?: FetchLike;
  /** Per-endpoint identity probe budget. */
  probeTimeoutMs?: number;
  /** This device's own IPv4 addresses; an endpoint on the same /24 is preferred. */
  localAddresses?: readonly string[];
  /** Skip the offer's list and use this endpoint only (typed in by the user). */
  endpointOverride?: string;
  now?: () => number;
}

export interface SelectedEndpoint {
  endpoint: string;
  useTls: boolean;
  hostname: string | null;
}

export interface ClaimResult extends SelectedEndpoint {
  serverId: string;
  credential: string;
  principalId: string | null;
}

export const DEFAULT_PROBE_TIMEOUT_MS = 4_000;

function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
  const impl = fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!impl) throw new ClaimOfferError("claim_failed", "fetch is unavailable in this runtime");
  return impl;
}

export function buildDaemonHttpBase(endpoint: string, useTls: boolean): string {
  return `${useTls ? "https" : "http"}://${normalizeHostPort(endpoint)}`;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function ipv4Prefix(host: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(host);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function endpointHost(endpoint: string): string {
  const normalized = normalizeHostPort(endpoint);
  const bracket = normalized.lastIndexOf("]");
  if (bracket !== -1) return normalized.slice(1, bracket);
  const colon = normalized.lastIndexOf(":");
  return colon === -1 ? normalized : normalized.slice(0, colon);
}

/** Endpoints on one of this device's own /24 subnets first, otherwise the offer's order. */
export function rankEndpoints(
  endpoints: readonly string[],
  localAddresses: readonly string[] = [],
): string[] {
  const localPrefixes = new Set(
    localAddresses.map(ipv4Prefix).filter((prefix): prefix is string => prefix !== null),
  );
  const sameSubnet: string[] = [];
  const others: string[] = [];
  for (const endpoint of endpoints) {
    const prefix = ipv4Prefix(endpointHost(endpoint));
    (prefix && localPrefixes.has(prefix) ? sameSubnet : others).push(endpoint);
  }
  return [...sameSubnet, ...others];
}

type ProbeOutcome =
  | { kind: "match"; endpoint: string; hostname: string | null }
  | { kind: "mismatch"; endpoint: string; serverId: string | null }
  | { kind: "unreachable"; endpoint: string };

async function probeIdentity(
  endpoint: string,
  useTls: boolean,
  expectedServerId: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${buildDaemonHttpBase(endpoint, useTls)}/api/identity`, {
      signal: controller.signal,
    });
    if (!response.ok) return { kind: "unreachable", endpoint };
    const body = (await response.json()) as unknown;
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const serverId = readString(record, "serverId");
    if (serverId !== expectedServerId) return { kind: "mismatch", endpoint, serverId };
    return { kind: "match", endpoint, hostname: readString(record, "hostname") };
  } catch {
    return { kind: "unreachable", endpoint };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes every endpoint concurrently and returns the best one that proves it
 * is the offer's daemon. Throws `identity_mismatch` when something answered
 * but with another server id, `unreachable` when nothing answered at all.
 */
export async function selectDirectEndpoint(
  offer: ConnectionOfferV3,
  options: ClaimOfferOptions = {},
): Promise<SelectedEndpoint> {
  const fetchImpl = resolveFetch(options.fetchImpl);
  const useTls = offer.direct.useTls ?? false;
  const candidates = options.endpointOverride
    ? [options.endpointOverride]
    : rankEndpoints(offer.direct.endpoints, options.localAddresses);
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const outcomes = await Promise.all(
    candidates.map((endpoint) =>
      probeIdentity(endpoint, useTls, offer.serverId, fetchImpl, timeoutMs),
    ),
  );
  const match = outcomes.find((outcome) => outcome.kind === "match");
  if (match && match.kind === "match") {
    return { endpoint: normalizeHostPort(match.endpoint), useTls, hostname: match.hostname };
  }
  const mismatch = outcomes.find((outcome) => outcome.kind === "mismatch");
  if (mismatch && mismatch.kind === "mismatch") {
    throw new ClaimOfferError(
      "identity_mismatch",
      `${mismatch.endpoint} answered as ${mismatch.serverId ?? "an unknown daemon"}, not ${offer.serverId}`,
      candidates,
    );
  }
  throw new ClaimOfferError(
    "unreachable",
    `None of the daemon's endpoints answered: ${candidates.join(", ")}`,
    candidates,
  );
}

/** `POST /api/setup/claim`: redeems the single-use token for a device credential. */
export async function claimDaemon(input: {
  endpoint: string;
  useTls: boolean;
  token: string;
  label: string;
  fetchImpl?: FetchLike;
}): Promise<{ credential: string; serverId: string | null; principalId: string | null }> {
  const fetchImpl = resolveFetch(input.fetchImpl);
  let response: Response;
  try {
    response = await fetchImpl(
      `${buildDaemonHttpBase(input.endpoint, input.useTls)}/api/setup/claim`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: input.token, label: input.label }),
      },
    );
  } catch (error) {
    throw new ClaimOfferError(
      "unreachable",
      error instanceof Error ? error.message : "The daemon did not answer the claim request",
      [input.endpoint],
    );
  }
  if (response.status === 403) {
    throw new ClaimOfferError(
      "token_rejected",
      "The pairing code was already used or has expired",
      [input.endpoint],
    );
  }
  let body: Record<string, unknown> = {};
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new ClaimOfferError(
      "claim_failed",
      readString(body, "error") ?? `Claim request failed with HTTP ${response.status}`,
      [input.endpoint],
    );
  }
  const credential = readString(body, "credential");
  if (!credential) {
    throw new ClaimOfferError("claim_failed", "The daemon returned no credential", [
      input.endpoint,
    ]);
  }
  return {
    credential,
    serverId: readString(body, "serverId"),
    principalId: readString(body, "principalId"),
  };
}

export function isOfferExpired(offer: ConnectionOfferV3, now: number = Date.now()): boolean {
  const expiresAt = Date.parse(offer.claim.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

/** The whole flow: expiry check, endpoint selection, claim. */
export async function claimDirectOffer(
  offer: ConnectionOfferV3,
  input: { label: string } & ClaimOfferOptions,
): Promise<ClaimResult> {
  if (isOfferExpired(offer, input.now?.() ?? Date.now())) {
    throw new ClaimOfferError("expired", "This pairing code has expired", offer.direct.endpoints);
  }
  const selected = await selectDirectEndpoint(offer, input);
  const claimed = await claimDaemon({
    endpoint: selected.endpoint,
    useTls: selected.useTls,
    token: offer.claim.token,
    label: input.label,
    fetchImpl: input.fetchImpl,
  });
  if (claimed.serverId && claimed.serverId !== offer.serverId) {
    throw new ClaimOfferError(
      "identity_mismatch",
      `The daemon claimed as ${claimed.serverId}, not ${offer.serverId}`,
      [selected.endpoint],
    );
  }
  return {
    ...selected,
    hostname: selected.hostname ?? offer.hostname ?? null,
    serverId: offer.serverId,
    credential: claimed.credential,
    principalId: claimed.principalId,
  };
}
