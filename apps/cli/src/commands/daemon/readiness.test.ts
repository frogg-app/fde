import os from "node:os";
import { describe, expect, test, vi } from "vitest";

import {
  describeAccessMode,
  listLanAddresses,
  resolveAccessMode,
  resolveListenPort,
} from "./readiness.js";

describe("LAN addresses", () => {
  function mockInterfaces(): void {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      lo: [
        {
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        },
      ],
      eth0: [
        {
          address: "192.168.1.42",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "aa:bb:cc:dd:ee:ff",
          internal: false,
          cidr: "192.168.1.42/24",
        },
        {
          address: "fe80::1",
          netmask: "ffff:ffff:ffff:ffff::",
          family: "IPv6",
          mac: "aa:bb:cc:dd:ee:ff",
          internal: false,
          cidr: "fe80::1/64",
          scopeid: 2,
        },
      ],
    });
  }

  test("lists non-loopback IPv4 addresses with the port for a wildcard bind", () => {
    mockInterfaces();
    try {
      expect(listLanAddresses("0.0.0.0:9991")).toEqual(["http://192.168.1.42:9991"]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("a loopback bind has no LAN address, an explicit host is itself", () => {
    mockInterfaces();
    try {
      expect(listLanAddresses("127.0.0.1:9991")).toEqual([]);
      expect(listLanAddresses("192.168.1.42:9991")).toEqual(["http://192.168.1.42:9991"]);
      expect(listLanAddresses("/tmp/daemon.sock")).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("reads the port out of a listen target", () => {
    expect(resolveListenPort("0.0.0.0:9991")).toBe(9991);
    expect(resolveListenPort("9991")).toBe(9991);
    expect(resolveListenPort("/tmp/daemon.sock")).toBeNull();
  });
});

describe("access mode", () => {
  test("a password outranks trusted LAN", () => {
    expect(resolveAccessMode({ passwordConfigured: true, lanTrusted: true })).toBe("password");
    expect(resolveAccessMode({ passwordConfigured: false, lanTrusted: true })).toBe("lan_trusted");
    expect(resolveAccessMode({ passwordConfigured: false, lanTrusted: false })).toBe(
      "pairing_required",
    );
  });

  test("each mode says who can connect", () => {
    expect(describeAccessMode("password")).toContain("password");
    expect(describeAccessMode("lan_trusted")).toContain("private network");
    expect(describeAccessMode("pairing_required")).toContain("pair");
  });
});
