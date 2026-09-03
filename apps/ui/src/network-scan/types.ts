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

/** What a user can quote when a scan finds nothing. */
export interface ScanDiagnostics {
  /** Addresses the shell reported (CIDR), empty in a browser. */
  localAddresses: string[];
  localAddressesError: string | null;
  /** `shell` when the desktop shell's Rust probe carried the requests. */
  transport: "shell" | "fetch";
  /** First transport error per /24 prefix, e.g. `{"192.168.1": "Connection refused"}`. */
  firstErrorBySubnet: Record<string, string>;
}

export interface DaemonIdentity {
  serverId: string | null;
  hostname: string | null;
  version: string | null;
  product: string | null;
  pairingRequired: boolean | null;
}
