import { describe, expect, it } from "vitest";
import { mergeScanResults, scanNetwork } from "./scanner";
import { parseDaemonHealth, parseDaemonIdentity, probeDaemon } from "./probe";
import type { DiscoveredServer, ProbeTarget } from "./types";

function server(overrides: Partial<DiscoveredServer> & { ip: string }): DiscoveredServer {
  return {
    port: 9999,
    endpoint: `${overrides.ip}:${overrides.port ?? 9999}`,
    hostname: null,
    version: null,
    serverId: null,
    source: "health",
    pairingRequired: null,
    ...overrides,
  };
}

describe("mergeScanResults", () => {
  it("dedupes by endpoint and sorts by address", () => {
    const merged = mergeScanResults(
      [server({ ip: "192.168.1.20" })],
      [server({ ip: "192.168.1.3" }), server({ ip: "192.168.1.20" })],
    );
    expect(merged.map((entry) => entry.ip)).toEqual(["192.168.1.3", "192.168.1.20"]);
  });

  it("lets an identity answer replace a bare health answer, never the reverse", () => {
    const health = server({ ip: "10.0.0.2" });
    const identity = server({
      ip: "10.0.0.2",
      source: "identity",
      hostname: "frogbox",
      version: "0.4.1",
      serverId: "srv_1",
    });
    expect(mergeScanResults([health], [identity])[0]).toEqual(identity);
    expect(mergeScanResults([identity], [health])[0]).toEqual(identity);
  });

  it("fills a hostname learned later (reverse DNS) without dropping other fields", () => {
    const identity = server({ ip: "10.0.0.2", source: "identity", version: "1.0.0" });
    const named = server({ ip: "10.0.0.2", source: "identity", hostname: "frogbox.lan" });
    expect(mergeScanResults([identity], [named])[0]).toMatchObject({
      hostname: "frogbox.lan",
      version: "1.0.0",
    });
  });
});

describe("scanNetwork", () => {
  it("probes every target with bounded concurrency and reports progress", async () => {
    const targets: ProbeTarget[] = Array.from({ length: 10 }, (_, i) => ({
      ip: `10.0.0.${i + 1}`,
      port: 9999,
    }));
    let inFlight = 0;
    let peak = 0;
    const progress: number[] = [];
    const found = await scanNetwork({
      targets,
      concurrency: 3,
      onProgress: ({ scanned }) => progress.push(scanned),
      probe: async (target) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return target.ip.endsWith(".4") ? server({ ip: target.ip }) : null;
      },
    });
    expect(found.map((entry) => entry.ip)).toEqual(["10.0.0.4"]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(10);
  });

  it("stops scheduling probes once aborted", async () => {
    const controller = new AbortController();
    let probes = 0;
    const found = await scanNetwork({
      targets: Array.from({ length: 50 }, (_, i) => ({ ip: `10.0.0.${i + 1}`, port: 9999 })),
      concurrency: 2,
      signal: controller.signal,
      probe: async () => {
        probes += 1;
        if (probes === 4) controller.abort();
        return null;
      },
    });
    expect(found).toEqual([]);
    expect(probes).toBeLessThan(10);
  });
});

describe("probeDaemon", () => {
  const jsonResponse = (status: number, body: unknown): Response =>
    ({ status, json: async () => body }) as unknown as Response;

  it("reads /api/identity when the daemon offers it", async () => {
    const calls: string[] = [];
    const found = await probeDaemon(
      { ip: "10.0.0.2", port: 9999 },
      {
        fetchImpl: async (url) => {
          calls.push(url);
          return jsonResponse(200, {
            serverId: "srv_1",
            hostname: "frogbox",
            version: "0.4.1",
            product: "fde",
          });
        },
      },
    );
    expect(calls).toEqual(["http://10.0.0.2:9999/api/identity"]);
    expect(found).toMatchObject({
      endpoint: "10.0.0.2:9999",
      hostname: "frogbox",
      version: "0.4.1",
      serverId: "srv_1",
      source: "identity",
      pairingRequired: null,
    });
  });

  it("reports pairingRequired from an unclaimed daemon's identity", async () => {
    const found = await probeDaemon(
      { ip: "10.0.0.6", port: 9999 },
      {
        fetchImpl: async () =>
          jsonResponse(200, {
            serverId: "srv_unclaimed",
            hostname: "newbox",
            version: "0.1.12",
            product: "fde",
            pairingRequired: true,
          }),
      },
    );
    expect(found).toMatchObject({ serverId: "srv_unclaimed", pairingRequired: true });
  });

  it("falls back to /api/health on older daemons", async () => {
    const found = await probeDaemon(
      { ip: "10.0.0.3", port: 9999 },
      {
        fetchImpl: async (url) =>
          url.endsWith("/api/identity")
            ? jsonResponse(404, null)
            : jsonResponse(200, { status: "ok", timestamp: "now" }),
      },
    );
    expect(found).toMatchObject({ endpoint: "10.0.0.3:9999", hostname: null, source: "health" });
  });

  it("returns null when nothing answers or the answer is not a daemon", async () => {
    expect(
      await probeDaemon(
        { ip: "10.0.0.4", port: 9999 },
        {
          fetchImpl: async () => {
            throw new Error("ECONNREFUSED");
          },
        },
      ),
    ).toBeNull();
    expect(
      await probeDaemon(
        { ip: "10.0.0.5", port: 9999 },
        { fetchImpl: async () => jsonResponse(200, { hello: "world" }) },
      ),
    ).toBeNull();
  });

  it("parses identity and health payloads defensively", () => {
    expect(parseDaemonIdentity({ version: "1.2.3" })).toEqual({
      serverId: null,
      hostname: null,
      version: "1.2.3",
      product: null,
      pairingRequired: null,
    });
    expect(
      parseDaemonIdentity({ serverId: "srv", product: "fde", pairingRequired: true }),
    ).toMatchObject({ serverId: "srv", pairingRequired: true });
    expect(parseDaemonIdentity({})).toBeNull();
    expect(parseDaemonIdentity("nope")).toBeNull();
    expect(parseDaemonHealth({ status: "ok" })).toBe(true);
    expect(parseDaemonHealth({ status: "down" })).toBe(false);
  });
});
