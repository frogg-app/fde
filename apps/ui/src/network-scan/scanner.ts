import { parseIpv4 } from "./subnets";
import type { DiscoveredServer, ProbeTarget, ScanProgress } from "./types";

export const SCAN_CONCURRENCY = 32;

export type ProbeFn = (
  target: ProbeTarget,
  options: { signal?: AbortSignal },
) => Promise<DiscoveredServer | null>;

export interface ScanNetworkOptions {
  targets: readonly ProbeTarget[];
  probe: ProbeFn;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  onServer?: (server: DiscoveredServer) => void;
}

function ipSortKey(ip: string): number {
  const octets = parseIpv4(ip);
  if (!octets) return Number.MAX_SAFE_INTEGER;
  return ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
}

function compareServers(a: DiscoveredServer, b: DiscoveredServer): number {
  return ipSortKey(a.ip) - ipSortKey(b.ip) || a.port - b.port;
}

/**
 * Merge newly discovered servers into the list, keyed by endpoint. A richer
 * answer (`identity`) replaces a bare `health` one; otherwise the newer entry
 * wins field by field so a later reverse lookup can fill in a hostname.
 */
export function mergeScanResults(
  existing: readonly DiscoveredServer[],
  incoming: readonly DiscoveredServer[],
): DiscoveredServer[] {
  const byEndpoint = new Map<string, DiscoveredServer>();
  for (const server of existing) byEndpoint.set(server.endpoint, server);
  for (const server of incoming) {
    const previous = byEndpoint.get(server.endpoint);
    if (!previous) {
      byEndpoint.set(server.endpoint, server);
      continue;
    }
    if (previous.source === "identity" && server.source === "health") {
      byEndpoint.set(server.endpoint, {
        ...previous,
        hostname: server.hostname ?? previous.hostname,
      });
      continue;
    }
    byEndpoint.set(server.endpoint, {
      ...previous,
      ...server,
      hostname: server.hostname ?? previous.hostname,
      version: server.version ?? previous.version,
      serverId: server.serverId ?? previous.serverId,
    });
  }
  return Array.from(byEndpoint.values()).sort(compareServers);
}

/**
 * Probe every target with a bounded pool of workers. Resolves with the
 * servers found (sorted by address). Aborting the signal stops new probes;
 * in-flight ones finish on their own timeout.
 */
export async function scanNetwork(options: ScanNetworkOptions): Promise<DiscoveredServer[]> {
  const { targets, probe, signal } = options;
  const concurrency = Math.max(1, options.concurrency ?? SCAN_CONCURRENCY);
  const total = targets.length;
  let nextIndex = 0;
  let scanned = 0;
  let found: DiscoveredServer[] = [];

  options.onProgress?.({ scanned, total });

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const index = nextIndex;
      if (index >= total) return;
      nextIndex += 1;
      const target = targets[index];
      const server = await probe(target, { signal });
      if (signal?.aborted) return;
      scanned += 1;
      if (server) {
        found = mergeScanResults(found, [server]);
        options.onServer?.(server);
      }
      options.onProgress?.({ scanned, total });
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, total); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return found;
}
