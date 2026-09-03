export interface ProbeTarget {
  ip: string;
  port: number;
}

/** An FDE daemon that answered a probe. `endpoint` is what a directTcp connection stores. */
export interface DiscoveredServer {
  ip: string;
  port: number;
  endpoint: string;
  /** Hostname the daemon reports about itself, or a reverse-DNS name; null when unknown. */
  hostname: string | null;
  version: string | null;
  serverId: string | null;
  /** `identity` when `/api/identity` answered, `health` when only `/api/health` did. */
  source: "identity" | "health";
}

export interface ScanProgress {
  scanned: number;
  total: number;
}

export type ScanStatus = "idle" | "scanning" | "done";

export interface DaemonIdentity {
  serverId: string | null;
  hostname: string | null;
  version: string | null;
  product: string | null;
}
