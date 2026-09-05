import { describe, expect, test } from "vitest";
import {
  connectionNetworkHost,
  describeConnectionEndpoint,
  findDaemonConflicts,
  findDaemonConflictGroups,
} from "./daemon-conflicts";
import type { HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostConnection } from "@/types/host-connection";

function tcp(endpoint: string): HostConnection {
  return { id: `direct:${endpoint}`, type: "directTcp", endpoint, useTls: false };
}

function profile(serverId: string, connections: HostConnection[]): HostProfile {
  return {
    serverId,
    label: serverId,
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections,
    preferredConnectionId: connections[0]?.id ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("connectionNetworkHost", () => {
  test("extracts the machine from network connections", () => {
    expect(connectionNetworkHost(tcp("192.168.1.17:6789"))).toBe("192.168.1.17");
    expect(connectionNetworkHost(tcp("[2001:db8::1]:6767"))).toBe("2001:db8::1");
    expect(
      connectionNetworkHost({ id: "s", type: "remoteSsh", host: "Devbox", daemonPort: 6767 }),
    ).toBe("devbox");
  });

  test("treats every loopback spelling as the same machine", () => {
    for (const endpoint of ["127.0.0.1:1", "localhost:1", "0.0.0.0:1", "[::1]:1"]) {
      expect(connectionNetworkHost(tcp(endpoint))).toBe("localhost");
    }
  });

  test("returns null where there is no meaningful machine", () => {
    expect(connectionNetworkHost({ id: "p", type: "directSocket", path: "/tmp/s" })).toBeNull();
    expect(
      connectionNetworkHost({
        id: "r",
        type: "relay",
        relayEndpoint: "relay.example:443",
        daemonPublicKeyB64: "k",
      }),
    ).toBeNull();
    expect(connectionNetworkHost(tcp("not-a-host-port"))).toBeNull();
  });
});

describe("findDaemonConflicts", () => {
  test("flags a different daemon on the same machine", () => {
    const existing = [profile("srv_node", [tcp("192.168.1.17:9999")])];
    const conflicts = findDaemonConflicts({
      profiles: existing,
      connection: tcp("192.168.1.17:6789"),
      serverId: "srv_rust",
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].profile.serverId).toBe("srv_node");
    expect(conflicts[0].machine).toBe("192.168.1.17");
  });

  test("a proxy reporting the same serverId is not a conflict", () => {
    // The case that prompted this: one daemon reachable on two ports.
    const existing = [profile("srv_same", [tcp("192.168.1.17:9999")])];
    expect(
      findDaemonConflicts({
        profiles: existing,
        connection: tcp("192.168.1.17:6789"),
        serverId: "srv_same",
      }),
    ).toEqual([]);
  });

  test("a different daemon on a different machine is not a conflict", () => {
    const existing = [profile("srv_other", [tcp("10.0.0.5:9999")])];
    expect(
      findDaemonConflicts({
        profiles: existing,
        connection: tcp("192.168.1.17:6789"),
        serverId: "srv_rust",
      }),
    ).toEqual([]);
  });

  test("matches loopback across spellings", () => {
    const existing = [profile("srv_node", [tcp("localhost:9999")])];
    expect(
      findDaemonConflicts({
        profiles: existing,
        connection: tcp("127.0.0.1:6789"),
        serverId: "srv_rust",
      }),
    ).toHaveLength(1);
  });

  test("reports every clashing host, not just the first", () => {
    const existing = [
      profile("srv_a", [tcp("192.168.1.17:9999")]),
      profile("srv_b", [tcp("192.168.1.17:7777")]),
      profile("srv_far", [tcp("10.0.0.5:9999")]),
    ];
    const conflicts = findDaemonConflicts({
      profiles: existing,
      connection: tcp("192.168.1.17:6789"),
      serverId: "srv_rust",
    });
    expect(conflicts.map((c) => c.profile.serverId)).toEqual(["srv_a", "srv_b"]);
  });

  test("ignores connection types with no machine", () => {
    const existing = [profile("srv_node", [{ id: "s", type: "directSocket", path: "/tmp/s" }])];
    expect(
      findDaemonConflicts({
        profiles: existing,
        connection: tcp("192.168.1.17:6789"),
        serverId: "srv_rust",
      }),
    ).toEqual([]);
  });
});

describe("describeConnectionEndpoint", () => {
  test("renders each connection type", () => {
    expect(describeConnectionEndpoint(tcp("192.168.1.17:6789"))).toBe("192.168.1.17:6789");
    expect(
      describeConnectionEndpoint({ id: "s", type: "remoteSsh", host: "box", daemonPort: 6767 }),
    ).toBe("box:6767");
    expect(describeConnectionEndpoint({ id: "s", type: "remoteSsh", host: "box" })).toBe("box");
    expect(
      describeConnectionEndpoint({ id: "p", type: "directPipe", path: "\\\\.\\pipe\\x" }),
    ).toBe("\\\\.\\pipe\\x");
  });
});

describe("findDaemonConflictGroups", () => {
  test("groups distinct daemons sharing a machine", () => {
    const groups = findDaemonConflictGroups([
      profile("srv_node", [tcp("192.168.1.17:9999")]),
      profile("srv_rust", [tcp("192.168.1.17:6789")]),
      profile("srv_far", [tcp("10.0.0.5:9999")]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].machine).toBe("192.168.1.17");
    expect(groups[0].profiles.map((p) => p.serverId)).toEqual(["srv_node", "srv_rust"]);
  });

  test("one daemon reachable twice on a machine is not a group", () => {
    expect(
      findDaemonConflictGroups([
        profile("srv_same", [tcp("192.168.1.17:9999"), tcp("192.168.1.17:6789")]),
      ]),
    ).toEqual([]);
  });

  test("no conflicts is the empty case", () => {
    expect(findDaemonConflictGroups([])).toEqual([]);
    expect(findDaemonConflictGroups([profile("srv_a", [tcp("192.168.1.17:9999")])])).toEqual([]);
  });

  test("reports several machines independently", () => {
    const groups = findDaemonConflictGroups([
      profile("srv_a", [tcp("192.168.1.17:9999")]),
      profile("srv_b", [tcp("192.168.1.17:6789")]),
      profile("srv_c", [tcp("10.0.0.5:1")]),
      profile("srv_d", [tcp("10.0.0.5:2")]),
    ]);
    expect(groups.map((g) => g.machine).sort()).toEqual(["10.0.0.5", "192.168.1.17"]);
  });
});
