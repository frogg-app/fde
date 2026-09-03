import type { DaemonIdentity, DiscoveredServer, ProbeTarget } from "./types";

export const PROBE_TIMEOUT_MS = 700;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export interface ProbeOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * `/api/identity` as the daemon returns it:
 * `{serverId, hostname, version, product:"fde", pairingRequired}`.
 */
export function parseDaemonIdentity(payload: unknown): DaemonIdentity | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const identity: DaemonIdentity = {
    serverId: readString(record, "serverId"),
    hostname: readString(record, "hostname"),
    version: readString(record, "version"),
    product: readString(record, "product"),
    pairingRequired: typeof record.pairingRequired === "boolean" ? record.pairingRequired : null,
  };
  if (!identity.serverId && !identity.hostname && !identity.version) return null;
  return identity;
}

/** `/api/health` answers `{status:"ok"}`; anything else is not an FDE daemon. */
export function parseDaemonHealth(payload: unknown): boolean {
  return Boolean(
    payload && typeof payload === "object" && (payload as Record<string, unknown>).status === "ok",
  );
}

async function fetchJson(
  url: string,
  options: Required<Pick<ProbeOptions, "fetchImpl" | "timeoutMs">> & { signal?: AbortSignal },
): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const response = await options.fetchImpl(url, { signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Ask one address whether an FDE daemon lives there. `/api/identity` is
 * preferred (it carries hostname and version); older daemons answer only
 * `/api/health`, which still proves a daemon is present.
 */
export async function probeDaemon(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<DiscoveredServer | null> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) return null;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const base = `http://${target.ip}:${target.port}`;
  const endpoint = `${target.ip}:${target.port}`;
  const fetchOptions = { fetchImpl, timeoutMs, signal: options.signal };

  const identityResponse = await fetchJson(`${base}/api/identity`, fetchOptions);
  if (identityResponse?.status === 200) {
    const identity = parseDaemonIdentity(identityResponse.body);
    if (identity && (identity.product === null || identity.product === "fde")) {
      return {
        ip: target.ip,
        port: target.port,
        endpoint,
        hostname: identity.hostname,
        version: identity.version,
        serverId: identity.serverId,
        source: "identity",
        pairingRequired: identity.pairingRequired,
      };
    }
  }
  if (identityResponse === null) {
    // Nothing is listening (or the request timed out); no point asking again.
    return null;
  }

  const healthResponse = await fetchJson(`${base}/api/health`, fetchOptions);
  if (healthResponse?.status === 200 && parseDaemonHealth(healthResponse.body)) {
    return {
      ip: target.ip,
      port: target.port,
      endpoint,
      hostname: null,
      version: null,
      serverId: null,
      source: "health",
      pairingRequired: null,
    };
  }
  return null;
}
