import { describe, expect, it, vi } from "vitest";
import type { ConnectionOfferV3 } from "@fde/protocol/connection-offer";
import {
  ClaimOfferError,
  claimDaemon,
  claimDirectOffer,
  isOfferExpired,
  rankEndpoints,
  selectDirectEndpoint,
  type FetchLike,
} from "./claim-offer";

const NOW = Date.parse("2026-09-03T10:00:00.000Z");

function makeOffer(overrides: Partial<ConnectionOfferV3> = {}): ConnectionOfferV3 {
  return {
    v: 3,
    product: "fde",
    serverId: "srv_devbox",
    hostname: "devbox",
    daemonPublicKeyB64: "pk",
    direct: { endpoints: ["10.0.0.5:9999", "192.168.1.10:9999", "localhost:9999"] },
    claim: { token: "tok_1", expiresAt: new Date(NOW + 60_000).toISOString() },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A fake daemon per endpoint: identity answers, claim answers, or nothing (throws). */
function makeFetch(
  hosts: Record<
    string,
    { identity?: { serverId: string; hostname?: string }; claim?: (body: unknown) => Response }
  >,
): FetchLike & { calls: Array<{ url: string; method: string; body: unknown }> } {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const impl = (async (url: string, init?: { method?: string; body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ url, method: init?.method ?? "GET", body });
    const parsed = new URL(url);
    const host = hosts[parsed.host];
    if (!host) throw new TypeError("Failed to fetch");
    if (parsed.pathname === "/api/identity") {
      if (!host.identity) throw new TypeError("Failed to fetch");
      return jsonResponse(200, { product: "fde", ...host.identity, pairingRequired: true });
    }
    if (parsed.pathname === "/api/setup/claim" && host.claim) return host.claim(body);
    return jsonResponse(404, { error: "not found" });
  }) as FetchLike & { calls: typeof calls };
  impl.calls = calls;
  return impl;
}

describe("rankEndpoints", () => {
  it("prefers endpoints on one of this device's /24 subnets, keeping the offer order otherwise", () => {
    expect(
      rankEndpoints(["10.0.0.5:9999", "192.168.1.10:9999", "localhost:9999"], ["192.168.1.42"]),
    ).toEqual(["192.168.1.10:9999", "10.0.0.5:9999", "localhost:9999"]);
    expect(rankEndpoints(["a:1", "b:2"])).toEqual(["a:1", "b:2"]);
  });
});

describe("selectDirectEndpoint", () => {
  it("picks the reachable endpoint whose identity matches the offer", async () => {
    const fetchImpl = makeFetch({
      "192.168.1.10:9999": { identity: { serverId: "srv_devbox", hostname: "devbox.lan" } },
    });
    const selected = await selectDirectEndpoint(makeOffer(), {
      fetchImpl,
      localAddresses: ["192.168.1.7"],
      probeTimeoutMs: 100,
    });
    expect(selected).toEqual({
      endpoint: "192.168.1.10:9999",
      useTls: false,
      hostname: "devbox.lan",
    });
  });

  it("reports an identity mismatch when an endpoint belongs to another daemon", async () => {
    const fetchImpl = makeFetch({
      "10.0.0.5:9999": { identity: { serverId: "srv_other" } },
    });
    await expect(
      selectDirectEndpoint(makeOffer(), { fetchImpl, probeTimeoutMs: 100 }),
    ).rejects.toMatchObject({ code: "identity_mismatch" });
  });

  it("lists the endpoints it tried when nothing answers", async () => {
    const fetchImpl = makeFetch({});
    const error = await selectDirectEndpoint(makeOffer(), {
      fetchImpl,
      probeTimeoutMs: 100,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClaimOfferError);
    expect((error as ClaimOfferError).code).toBe("unreachable");
    expect((error as ClaimOfferError).endpoints).toEqual([
      "10.0.0.5:9999",
      "192.168.1.10:9999",
      "localhost:9999",
    ]);
  });

  it("uses only a user-typed endpoint override", async () => {
    const fetchImpl = makeFetch({
      "devbox.example:9999": { identity: { serverId: "srv_devbox" } },
    });
    const selected = await selectDirectEndpoint(makeOffer(), {
      fetchImpl,
      endpointOverride: "devbox.example:9999",
      probeTimeoutMs: 100,
    });
    expect(selected.endpoint).toBe("devbox.example:9999");
    expect(fetchImpl.calls.map((call) => call.url)).toEqual([
      "http://devbox.example:9999/api/identity",
    ]);
  });
});

describe("claimDaemon", () => {
  it("posts the token and label and returns the credential", async () => {
    const fetchImpl = makeFetch({
      "192.168.1.10:9999": {
        claim: () =>
          jsonResponse(201, {
            serverId: "srv_devbox",
            principalId: "p_1",
            credentialId: "c_1",
            credential: "secret-credential",
          }),
      },
    });
    const claimed = await claimDaemon({
      endpoint: "192.168.1.10:9999",
      useTls: false,
      token: "tok_1",
      label: "FDE on laptop",
      fetchImpl,
    });
    expect(claimed).toEqual({
      credential: "secret-credential",
      serverId: "srv_devbox",
      principalId: "p_1",
    });
    expect(fetchImpl.calls[0]).toEqual({
      url: "http://192.168.1.10:9999/api/setup/claim",
      method: "POST",
      body: { token: "tok_1", label: "FDE on laptop" },
    });
  });

  it("maps a 403 to token_rejected", async () => {
    const fetchImpl = makeFetch({
      "192.168.1.10:9999": {
        claim: () => jsonResponse(403, { error: "Invalid or expired claim token" }),
      },
    });
    await expect(
      claimDaemon({
        endpoint: "192.168.1.10:9999",
        useTls: false,
        token: "tok_used",
        label: "x",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "token_rejected" });
  });
});

describe("claimDirectOffer", () => {
  it("refuses an expired offer before touching the network", async () => {
    const fetchImpl = vi.fn() as unknown as FetchLike;
    const offer = makeOffer({
      claim: { token: "tok", expiresAt: new Date(NOW - 1).toISOString() },
    });
    expect(isOfferExpired(offer, NOW)).toBe(true);
    await expect(
      claimDirectOffer(offer, { label: "x", fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({ code: "expired" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("selects, claims, and returns a directTcp-ready result", async () => {
    const fetchImpl = makeFetch({
      "192.168.1.10:9999": {
        identity: { serverId: "srv_devbox", hostname: "devbox.lan" },
        claim: (body) =>
          (body as { token: string }).token === "tok_1"
            ? jsonResponse(201, { serverId: "srv_devbox", principalId: "p_1", credential: "cred" })
            : jsonResponse(403, { error: "bad token" }),
      },
    });
    const result = await claimDirectOffer(makeOffer(), {
      label: "FDE on laptop",
      fetchImpl,
      localAddresses: ["192.168.1.7"],
      probeTimeoutMs: 100,
      now: () => NOW,
    });
    expect(result).toEqual({
      endpoint: "192.168.1.10:9999",
      useTls: false,
      hostname: "devbox.lan",
      serverId: "srv_devbox",
      credential: "cred",
      principalId: "p_1",
    });
  });
});
