import type { ProbeTarget } from "./types";

/** Subnets probed when nothing better is known about the machine's network. */
export const FALLBACK_SUBNETS = ["192.168.0", "192.168.1", "10.0.0"] as const;

/** Upper bound on probes per scan: three /24 subnets' worth of hosts. */
export const MAX_PROBE_TARGETS = 768;

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIpv4(value: string): [number, number, number, number] | null {
  const match = value.trim().match(IPV4_PATTERN);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

/** RFC 1918 and link-local ranges: the only ones worth sweeping for a LAN daemon. */
export function isPrivateIpv4(value: string): boolean {
  // Accepts the CIDR form the desktop shell reports ("192.168.1.23/24") as well.
  const octets = parseIpv4(value.split("/")[0] ?? value);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** The /24 prefix ("192.168.1") of an IPv4 address, or null for anything else. */
export function subnetOf(value: string): string | null {
  // The desktop shell reports interface addresses in CIDR form ("192.168.1.23/24").
  const octets = parseIpv4(value.split("/")[0] ?? value);
  if (!octets) return null;
  return `${octets[0]}.${octets[1]}.${octets[2]}`;
}

/** Host addresses of a /24 prefix, .1 through .254. */
export function enumerateSubnetHosts(prefix: string): string[] {
  const hosts: string[] = [];
  for (let last = 1; last <= 254; last += 1) {
    hosts.push(`${prefix}.${last}`);
  }
  return hosts;
}

export interface SubnetHints {
  /** IPv4 addresses of this machine's interfaces (desktop bridge), if known. */
  localAddresses?: readonly string[];
  /** Why the shell could not list its addresses, when it could not (diagnostics only). */
  localAddressesError?: string;
  /** Host the web page was loaded from; a LAN IP means the daemon's subnet is a good guess. */
  pageHost?: string | null;
}

/**
 * Which /24 subnets to sweep, most likely first, deduplicated. Interfaces the
 * machine actually has win over the page host, which wins over the common
 * home/office defaults. The defaults are appended only when nothing better is
 * known, so a machine on 10.1.2.0/24 does not also sweep 192.168.x.
 */
export function resolveCandidateSubnets(hints: SubnetHints): string[] {
  const ordered: string[] = [];
  const push = (prefix: string | null) => {
    if (prefix && !ordered.includes(prefix)) ordered.push(prefix);
  };
  for (const address of hints.localAddresses ?? []) {
    if (isPrivateIpv4(address)) push(subnetOf(address));
  }
  if (hints.pageHost && isPrivateIpv4(hints.pageHost)) {
    push(subnetOf(hints.pageHost));
  }
  if (ordered.length === 0) {
    for (const prefix of FALLBACK_SUBNETS) push(prefix);
  }
  return ordered;
}

/** Probe targets for the subnets, in order, capped at `cap` so a scan stays bounded. */
export function buildProbeTargets(
  subnets: readonly string[],
  port: number,
  cap: number = MAX_PROBE_TARGETS,
): ProbeTarget[] {
  const targets: ProbeTarget[] = [];
  for (const prefix of subnets) {
    for (const ip of enumerateSubnetHosts(prefix)) {
      if (targets.length >= cap) return targets;
      targets.push({ ip, port });
    }
  }
  return targets;
}
