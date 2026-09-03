import type { DaemonIdentity, DiscoveredServer, ProbeTarget } from "./types";

export const PROBE_TIMEOUT_MS = 700;

export type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** The desktop shell's Rust-side GET: status plus parsed JSON, or a rejection. */
export type ShellProbeLike = (url: string) => Promise<{ status: number; body: unknown }>;

export interface ProbeOptions {
  fetchImpl?: FetchLike;
  /**
   * Preferred over `fetchImpl` when present: the request leaves from the shell
   * process, so the webview's cross-origin and local-network rules cannot block it.
   */
  shellProbe?: ShellProbeLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with the transport error of a failed request (for diagnostics). */
  onError?: (target: ProbeTarget, message: string) => void;
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

export function describeProbeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "timed out";
    return error.message || error.name;
  }
  return typeof error === "string" ? error : String(error);
}

type ProbeAnswer = { status: number; body: unknown } | { error: string };

type Transport = Required<Pick<ProbeOptions, "timeoutMs">> &
  Pick<ProbeOptions, "fetchImpl" | "shellProbe" | "signal">;

async function fetchJson(url: string, transport: Transport): Promise<ProbeAnswer> {
  if (transport.shellProbe) {
    try {
      const answer = await transport.shellProbe(url);
      return { status: answer.status, body: answer.body ?? null };
    } catch (error) {
      return { error: describeProbeError(error) };
    }
  }
  const fetchImpl = transport.fetchImpl;
  if (!fetchImpl) return { error: "fetch is not available" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), transport.timeoutMs);
  const onOuterAbort = () => controller.abort();
  transport.signal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  } catch (error) {
    // Browsers hide the reason behind a bare "Failed to fetch": a refused
    // connection, a CORS rejection and a blocked local-network request all
    // look alike here. The desktop shell's probe reports the real cause.
    return { error: describeProbeError(error) };
  } finally {
    clearTimeout(timer);
    transport.signal?.removeEventListener("abort", onOuterAbort);
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
  const transport: Transport = {
    fetchImpl: options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined),
    shellProbe: options.shellProbe,
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
    signal: options.signal,
  };
  const base = `http://${target.ip}:${target.port}`;
  const endpoint = `${target.ip}:${target.port}`;

  const identityResponse = await fetchJson(`${base}/api/identity`, transport);
  if ("error" in identityResponse) {
    // Nothing is listening (or the request timed out); no point asking again.
    options.onError?.(target, identityResponse.error);
    return null;
  }
  if (identityResponse.status === 200) {
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

  const healthResponse = await fetchJson(`${base}/api/health`, transport);
  if (
    !("error" in healthResponse) &&
    healthResponse.status === 200 &&
    parseDaemonHealth(healthResponse.body)
  ) {
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
