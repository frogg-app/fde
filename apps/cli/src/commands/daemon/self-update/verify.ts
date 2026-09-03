import { daemonHttpJson } from "../daemon-http.js";

/**
 * Post-restart verification: the daemon on the same listen address must
 * report the expected version on `GET /api/identity` and answer
 * `GET /api/health`. Anything else after the deadline is a failed update.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1000;

export type VerifyResult = { ok: true; elapsedMs: number } | { ok: false; reason: string };

export interface VerifyDaemonOptions {
  httpBase: string;
  expectedVersion: string;
  timeoutMs?: number;
  /** Optional liveness probe; false after the grace period ends the wait early. */
  isRunning?: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface IdentityShape {
  version?: unknown;
}

interface HealthShape {
  status?: unknown;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type DaemonProbe = (httpBase: string) => Promise<{ version: string; healthy: boolean }>;

export async function probeDaemon(
  httpBase: string,
): Promise<{ version: string; healthy: boolean }> {
  const identity = await daemonHttpJson<IdentityShape>({ base: httpBase, path: "/api/identity" });
  const health = await daemonHttpJson<HealthShape>({ base: httpBase, path: "/api/health" });
  return {
    version: typeof identity.version === "string" ? identity.version : "",
    healthy: health.status === "ok",
  };
}

export async function waitForDaemonVersion(
  options: VerifyDaemonOptions,
  probe: DaemonProbe = probeDaemon,
): Promise<VerifyResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const started = now();
  const deadline = started + timeoutMs;
  const gracePeriodEnd = started + Math.min(10_000, timeoutMs / 3);
  let lastReason = "daemon did not answer";
  let deadPolls = 0;
  while (now() < deadline) {
    try {
      const result = await probe(options.httpBase);
      if (result.version === options.expectedVersion && result.healthy) {
        return { ok: true, elapsedMs: now() - started };
      }
      lastReason =
        result.version !== options.expectedVersion
          ? `daemon reports version ${result.version || "unknown"}, expected ${options.expectedVersion}`
          : "daemon health check did not report ok";
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
    if (options.isRunning && now() > gracePeriodEnd) {
      deadPolls = (await options.isRunning()) ? 0 : deadPolls + 1;
      if (deadPolls >= 3) {
        return { ok: false, reason: `daemon process is not running (${lastReason})` };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return { ok: false, reason: `timed out after ${Math.round(timeoutMs / 1000)}s: ${lastReason}` };
}
