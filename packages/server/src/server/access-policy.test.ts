import { describe, expect, test } from "vitest";

import {
  classifyClientAddress,
  isAuthRequired,
  isLoopbackIp,
  isPrivateLanIp,
  resolveClientAddress,
} from "./access-policy.js";

describe("access policy", () => {
  test("recognizes loopback addresses in every notation", () => {
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("127.8.8.8")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
    expect(isLoopbackIp("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackIp("192.168.1.10")).toBe(false);
    expect(isLoopbackIp("::ffff:10.0.0.1")).toBe(false);
    expect(isLoopbackIp(undefined)).toBe(false);
  });

  test("recognizes private and link-local address space as the LAN", () => {
    // IPv4 private ranges, including their edges.
    expect(isPrivateLanIp("10.0.0.1")).toBe(true);
    expect(isPrivateLanIp("10.255.255.255")).toBe(true);
    expect(isPrivateLanIp("172.16.0.0")).toBe(true);
    expect(isPrivateLanIp("172.31.255.255")).toBe(true);
    expect(isPrivateLanIp("192.168.1.10")).toBe(true);
    expect(isPrivateLanIp("169.254.10.20")).toBe(true);
    // IPv4-mapped IPv6, which is what a dual-stack listener reports.
    expect(isPrivateLanIp("::ffff:192.168.1.10")).toBe(true);
    expect(isPrivateLanIp("::FFFF:10.1.2.3")).toBe(true);
    // IPv6 unique-local and link-local.
    expect(isPrivateLanIp("fd12:3456:789a::1")).toBe(true);
    expect(isPrivateLanIp("fc00::1")).toBe(true);
    expect(isPrivateLanIp("fe80::1c2a:ff:fe12:3456")).toBe(true);
    expect(isPrivateLanIp("FEBF::1")).toBe(true);
    // Just outside every range.
    expect(isPrivateLanIp("172.32.0.0")).toBe(false);
    expect(isPrivateLanIp("172.15.255.255")).toBe(false);
    expect(isPrivateLanIp("192.169.0.1")).toBe(false);
    expect(isPrivateLanIp("11.0.0.1")).toBe(false);
    expect(isPrivateLanIp("fec0::1")).toBe(false);
    expect(isPrivateLanIp("fb00::1")).toBe(false);
    // Carrier-grade NAT is the ISP's network, not the owner's.
    expect(isPrivateLanIp("100.64.0.0")).toBe(false);
    expect(isPrivateLanIp("100.127.255.255")).toBe(false);
    // Loopback is its own class, and public addresses are public.
    expect(isPrivateLanIp("127.0.0.1")).toBe(false);
    expect(isPrivateLanIp("::1")).toBe(false);
    expect(isPrivateLanIp("8.8.8.8")).toBe(false);
    expect(isPrivateLanIp("2001:db8::1")).toBe(false);
    expect(isPrivateLanIp("not-an-ip")).toBe(false);
    expect(isPrivateLanIp(undefined)).toBe(false);
  });

  test("classifies a resolved client address", () => {
    expect(classifyClientAddress("127.0.0.1")).toBe("loopback");
    expect(classifyClientAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyClientAddress("192.168.1.10")).toBe("lan");
    expect(classifyClientAddress("::ffff:192.168.1.10")).toBe("lan");
    expect(classifyClientAddress("172.31.255.255")).toBe("lan");
    expect(classifyClientAddress("172.32.0.0")).toBe("public");
    expect(classifyClientAddress("100.64.0.0")).toBe("public");
    expect(classifyClientAddress("203.0.113.5")).toBe("public");
    expect(classifyClientAddress(undefined)).toBe("public");
  });

  test("honors X-Forwarded-For only from trusted proxies", () => {
    expect(
      resolveClientAddress({
        remoteAddress: "127.0.0.1",
        forwardedFor: "192.168.1.10",
        trustedProxies: ["loopback"],
      }),
    ).toBe("192.168.1.10");
    expect(
      resolveClientAddress({
        remoteAddress: "127.0.0.1",
        forwardedFor: "192.168.1.10",
        trustedProxies: [],
      }),
    ).toBe("127.0.0.1");
    expect(
      resolveClientAddress({
        remoteAddress: "10.0.0.2",
        forwardedFor: "192.168.1.10, 10.0.0.3",
        trustedProxies: ["10.0.0.2", "10.0.0.3"],
      }),
    ).toBe("192.168.1.10");
    expect(
      resolveClientAddress({
        remoteAddress: "10.0.0.2",
        forwardedFor: "spoofed-garbage",
        trustedProxies: true,
      }),
    ).toBe("10.0.0.2");
  });

  test("a password always requires a bearer, whatever the network", () => {
    for (const client of ["loopback", "lan", "public"] as const) {
      for (const trustLan of [true, false]) {
        expect(isAuthRequired({ password: "hash", claimed: false, client, trustLan })).toBe(true);
        expect(isAuthRequired({ password: "hash", claimed: true, client, trustLan })).toBe(true);
      }
    }
  });

  test("without a password: loopback is open, the LAN follows trustLan, public needs a bearer", () => {
    for (const claimed of [true, false]) {
      for (const trustLan of [true, false]) {
        expect(isAuthRequired({ password: undefined, claimed, client: "loopback", trustLan })).toBe(
          false,
        );
        expect(isAuthRequired({ password: undefined, claimed, client: "public", trustLan })).toBe(
          true,
        );
      }
      expect(isAuthRequired({ password: undefined, claimed, client: "lan", trustLan: true })).toBe(
        false,
      );
      expect(isAuthRequired({ password: undefined, claimed, client: "lan", trustLan: false })).toBe(
        true,
      );
    }
  });
});
