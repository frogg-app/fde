import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  DEFAULT_PAIRING_BASE_URL,
  buildOfferFragmentUrl,
  buildPairingDeepLink,
  decodeOfferFragmentPayload,
  encodeOfferFragmentPayload,
  hasOfferFragment,
  isPairingDeepLink,
  parseAnyConnectionOfferFromUrl,
  parseConnectionOfferFromUrl,
} from "./connection-offer.js";

function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("connection offer", () => {
  it("decodes base64url JSON payloads", () => {
    const payload = {
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.paseo.sh:443" },
    };

    expect(decodeOfferFragmentPayload(encodeBase64UrlNoPadUtf8(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("parses connection offers from QR-style URLs", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.paseo.sh:443" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toEqual(offer);
  });

  it("leaves relay TLS unset when absent", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 2,
        serverId: "server-123",
        daemonPublicKeyB64: "pubkey",
        relay: { endpoint: "relay.example.com:80" },
      }),
    ).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:80" },
    });
  });

  it("round-trips relay TLS in offers without rejecting extra relay fields", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true, extra: "future" },
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toEqual({
      v: 2,
      serverId: "server-123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true },
    });
  });

  it("returns null when the URL has no offer fragment", () => {
    expect(parseConnectionOfferFromUrl("https://app.paseo.sh/pair")).toBeNull();
  });

  it("parses direct claim (v3) offers and keeps relay optional", () => {
    const offer = {
      v: 3,
      product: "fde",
      serverId: "srv_abc",
      hostname: "devbox",
      daemonPublicKeyB64: "pubkey",
      direct: { endpoints: ["192.168.1.10:9999", "localhost:9999"] },
      claim: { token: "tok", expiresAt: "2026-09-03T00:00:00.000Z" },
    };
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseAnyConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toEqual(offer);
    expect(() => parseConnectionOfferFromUrl(`https://app.paseo.sh/#offer=${encoded}`)).toThrow();
  });
});

describe("pairing links", () => {
  const offer = {
    v: 3 as const,
    serverId: "srv_abc",
    daemonPublicKeyB64: "pubkey",
    direct: { endpoints: ["192.168.1.10:9999"] },
    claim: { token: "tok", expiresAt: "2026-09-03T00:00:00.000Z" },
  };

  it("builds https links with the payload in the fragment", () => {
    const encoded = encodeOfferFragmentPayload(offer);
    expect(encoded).toBe(encodeBase64UrlNoPadUtf8(JSON.stringify(offer)));
    expect(buildOfferFragmentUrl(DEFAULT_PAIRING_BASE_URL, encoded)).toBe(
      `https://frogg.app/pair#offer=${encoded}`,
    );
    expect(buildOfferFragmentUrl("https://frogg.app/pair/", encoded)).toBe(
      `https://frogg.app/pair#offer=${encoded}`,
    );
    expect(buildOfferFragmentUrl("https://app.paseo.sh", encoded)).toBe(
      `https://app.paseo.sh/#offer=${encoded}`,
    );
  });

  it("derives the paseo://pair deep link and parses it back", () => {
    const encoded = encodeOfferFragmentPayload(offer);
    const url = buildOfferFragmentUrl(DEFAULT_PAIRING_BASE_URL, encoded);
    const deepLink = buildPairingDeepLink(url);
    expect(deepLink).toBe(`paseo://pair#offer=${encoded}`);
    expect(isPairingDeepLink(deepLink!)).toBe(true);
    expect(isPairingDeepLink(`paseo://pair/#offer=${encoded}`)).toBe(true);
    expect(isPairingDeepLink("paseo://h/srv/agent/a")).toBe(false);
    expect(isPairingDeepLink("paseo://pair#offer=")).toBe(false);
    expect(parseAnyConnectionOfferFromUrl(deepLink!)).toEqual(offer);
    expect(hasOfferFragment(url)).toBe(true);
    expect(hasOfferFragment("https://frogg.app/pair")).toBe(false);
    expect(buildPairingDeepLink("https://frogg.app/pair")).toBeNull();
  });
});
