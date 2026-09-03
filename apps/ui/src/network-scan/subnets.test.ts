import { describe, expect, it } from "vitest";
import {
  buildProbeTargets,
  enumerateSubnetHosts,
  isPrivateIpv4,
  parseIpv4,
  resolveCandidateSubnets,
  subnetOf,
} from "./subnets";

describe("parseIpv4 / isPrivateIpv4 / subnetOf", () => {
  it("parses dotted quads and rejects everything else", () => {
    expect(parseIpv4("192.168.1.10")).toEqual([192, 168, 1, 10]);
    expect(parseIpv4("192.168.1.256")).toBeNull();
    expect(parseIpv4("frogbox")).toBeNull();
    expect(parseIpv4("::1")).toBeNull();
  });

  it("recognises private ranges only", () => {
    expect(isPrivateIpv4("10.1.2.3")).toBe(true);
    expect(isPrivateIpv4("192.168.0.1")).toBe(true);
    expect(isPrivateIpv4("172.16.0.1")).toBe(true);
    expect(isPrivateIpv4("172.32.0.1")).toBe(false);
    expect(isPrivateIpv4("169.254.1.1")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("localhost")).toBe(false);
  });

  it("derives the /24 prefix", () => {
    expect(subnetOf("192.168.1.10")).toBe("192.168.1");
    expect(subnetOf("nope")).toBeNull();
  });
});

describe("enumerateSubnetHosts", () => {
  it("lists .1 through .254", () => {
    const hosts = enumerateSubnetHosts("10.0.0");
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("10.0.0.1");
    expect(hosts[253]).toBe("10.0.0.254");
  });
});

describe("resolveCandidateSubnets", () => {
  it("prefers local interface addresses, then the page host, deduplicated", () => {
    expect(
      resolveCandidateSubnets({
        localAddresses: ["192.168.1.23", "10.20.0.5", "127.0.0.1", "192.168.1.24"],
        pageHost: "10.20.0.9",
      }),
    ).toEqual(["192.168.1", "10.20.0"]);
  });

  it("uses the page host when the bridge is absent", () => {
    expect(resolveCandidateSubnets({ pageHost: "192.168.4.7" })).toEqual(["192.168.4"]);
  });

  it("falls back to the common subnets when nothing private is known", () => {
    expect(resolveCandidateSubnets({ pageHost: "localhost" })).toEqual([
      "192.168.0",
      "192.168.1",
      "10.0.0",
    ]);
    expect(resolveCandidateSubnets({ localAddresses: ["203.0.113.4"] })).toEqual([
      "192.168.0",
      "192.168.1",
      "10.0.0",
    ]);
  });
});

describe("buildProbeTargets", () => {
  it("expands subnets in order and caps the total", () => {
    const targets = buildProbeTargets(["192.168.1", "10.0.0"], 9999, 300);
    expect(targets).toHaveLength(300);
    expect(targets[0]).toEqual({ ip: "192.168.1.1", port: 9999 });
    expect(targets[254]).toEqual({ ip: "10.0.0.1", port: 9999 });
  });

  it("defaults the cap to three subnets", () => {
    expect(buildProbeTargets(["a", "b", "c", "d"], 9999)).toHaveLength(768);
  });
});

it("subnetOf accepts CIDR notation from the desktop shell", () => {
  expect(subnetOf("192.168.1.23/24")).toBe("192.168.1");
});
