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
  /**
   * True when the daemon is unclaimed: a LAN client must redeem a pairing link
   * (`fde daemon pair` on the host) before it can connect. Null when unknown.
   */
  pairingRequired: boolean | null;
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
  pairingRequired: boolean | null;
}
