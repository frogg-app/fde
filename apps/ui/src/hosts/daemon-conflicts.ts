import { parseHostPort } from "@fde/protocol/daemon-endpoints";
import type { HostConnection } from "@/types/host-connection";
import type { HostProfile } from "@/types/host-connection";

/**
 * Two daemons on one machine.
 *
 * Hosts are keyed on the `serverId` from the daemon handshake, so a second
 * daemon on a different port of the same machine is a genuinely separate host.
 * That is easy to create by accident — a manually started daemon alongside the
 * managed one, or a dev build on another port — and the symptom is confusing:
 * agents and workspaces silently differ depending on which one the app picked.
 *
 * Note a *proxy* in front of another daemon is not a conflict: it forwards the
 * handshake, so it reports the same serverId and is correctly treated as one
 * host reachable two ways.
 */

/** The machine a connection points at, or null when that is not a network address. */
export function connectionNetworkHost(connection: HostConnection): string | null {
  switch (connection.type) {
    case "directTcp":
      try {
        return normalizeMachine(parseHostPort(connection.endpoint).host);
      } catch {
        return null;
      }
    case "remoteSsh":
      return normalizeMachine(connection.host);
    // Sockets and pipes are local by construction, and a relay endpoint
    // identifies the relay rather than the machine behind it.
    case "directSocket":
    case "directPipe":
    case "relay":
      return null;
  }
}

/** Loopback spellings all mean "this machine". */
function normalizeMachine(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "127.0.0.1" || trimmed === "::1" || trimmed === "0.0.0.0" || trimmed === "::") {
    return "localhost";
  }
  return trimmed;
}

export interface DaemonConflict {
  /** The already-known host running on the same machine. */
  profile: HostProfile;
  /** Which of its connections shares the machine, for display. */
  connection: HostConnection;
  machine: string;
}

/**
 * Existing hosts that are a *different* daemon on the *same* machine as
 * `connection`. Empty when there is no clash, which is the common case.
 */
export function findDaemonConflicts(input: {
  profiles: readonly HostProfile[];
  connection: HostConnection;
  serverId: string;
}): DaemonConflict[] {
  const machine = connectionNetworkHost(input.connection);
  if (!machine) {
    return [];
  }

  const conflicts: DaemonConflict[] = [];
  for (const profile of input.profiles) {
    // Same daemon reached another way is not a conflict.
    if (profile.serverId === input.serverId) continue;
    const shared = profile.connections.find(
      (candidate) => connectionNetworkHost(candidate) === machine,
    );
    if (shared) {
      conflicts.push({ profile, connection: shared, machine });
    }
  }
  return conflicts;
}

/** `192.168.1.17:6789` for display; falls back to the connection id. */
export function describeConnectionEndpoint(connection: HostConnection): string {
  switch (connection.type) {
    case "directTcp":
      return connection.endpoint;
    case "remoteSsh":
      return connection.daemonPort
        ? `${connection.host}:${connection.daemonPort}`
        : connection.host;
    case "directSocket":
    case "directPipe":
      return connection.path;
    case "relay":
      return connection.relayEndpoint;
  }
}

export interface DaemonConflictGroup {
  machine: string;
  /** Two or more distinct daemons reachable on that machine. */
  profiles: HostProfile[];
}

/**
 * Every machine in the registry that is running more than one daemon. Derived
 * from the saved hosts rather than hooked into the add flow, so it also catches
 * a second daemon that appeared after both hosts were added.
 */
export function findDaemonConflictGroups(profiles: readonly HostProfile[]): DaemonConflictGroup[] {
  const byMachine = new Map<string, HostProfile[]>();
  for (const profile of profiles) {
    // A host reachable on several machines counts once per machine, but only
    // once each - two connections to the same box are not two daemons.
    const machines = new Set(
      profile.connections
        .map(connectionNetworkHost)
        .filter((machine): machine is string => machine !== null),
    );
    for (const machine of machines) {
      const group = byMachine.get(machine);
      if (group) group.push(profile);
      else byMachine.set(machine, [profile]);
    }
  }

  return [...byMachine.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([machine, group]) => ({ machine, profiles: group }));
}
