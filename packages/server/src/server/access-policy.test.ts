import { describe, expect, test } from "vitest";

import { isAuthRequired, isLoopbackIp, resolveClientAddress } from "./access-policy.js";

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

  test("password always requires a bearer; without one only loopback is open", () => {
    expect(isAuthRequired({ password: "hash", claimed: false, loopback: true })).toBe(true);
    expect(isAuthRequired({ password: undefined, claimed: false, loopback: true })).toBe(false);
    expect(isAuthRequired({ password: undefined, claimed: true, loopback: true })).toBe(false);
    expect(isAuthRequired({ password: undefined, claimed: false, loopback: false })).toBe(true);
    expect(isAuthRequired({ password: undefined, claimed: true, loopback: false })).toBe(true);
  });
});
