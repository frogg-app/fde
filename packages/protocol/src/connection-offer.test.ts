import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  DEFAULT_PAIRING_BASE_URL,
  buildPairingUrl,
  extractPairingCode,
  hasPairingCode,
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

  it("builds https links carrying the code in the path", () => {
    const encoded = encodeOfferFragmentPayload(offer);
    expect(encoded).toBe(encodeBase64UrlNoPadUtf8(JSON.stringify(offer)));
    expect(buildPairingUrl(DEFAULT_PAIRING_BASE_URL, encoded)).toBe(
      `https://pair.frogg.app/code/${encoded}`,
    );
    expect(buildPairingUrl("https://pair.frogg.app/", encoded)).toBe(
      `https://pair.frogg.app/code/${encoded}`,
    );
    expect(buildPairingUrl("https://pair.example.com/code", encoded)).toBe(
      `https://pair.example.com/code/${encoded}`,
    );
  });

  it("derives the paseo://pair deep link and parses it back", () => {
    const encoded = encodeOfferFragmentPayload(offer);
    const url = buildPairingUrl(DEFAULT_PAIRING_BASE_URL, encoded);
    const deepLink = buildPairingDeepLink(url);
    expect(deepLink).toBe(`paseo://pair#offer=${encoded}`);
    expect(isPairingDeepLink(deepLink!)).toBe(true);
    expect(isPairingDeepLink(`paseo://pair/#offer=${encoded}`)).toBe(true);
    expect(isPairingDeepLink("paseo://h/srv/agent/a")).toBe(false);
    expect(isPairingDeepLink("paseo://pair#offer=")).toBe(false);
    expect(parseAnyConnectionOfferFromUrl(deepLink!)).toEqual(offer);
    expect(parseAnyConnectionOfferFromUrl(url)).toEqual(offer);
    expect(hasPairingCode(url)).toBe(true);
    expect(hasOfferFragment(deepLink!)).toBe(true);
    expect(hasOfferFragment(url)).toBe(false);
    expect(buildPairingDeepLink("https://pair.frogg.app/code/")).toBeNull();
  });

  it("keeps parsing the older #offer= and ?code= forms", () => {
    const encoded = encodeOfferFragmentPayload(offer);
    expect(parseAnyConnectionOfferFromUrl(`https://frogg.app/pair#offer=${encoded}`)).toEqual(offer);
    expect(parseAnyConnectionOfferFromUrl(`https://pair.frogg.app/pair?code=${encoded}`)).toEqual(
      offer,
    );
    expect(extractPairingCode(`https://pair.frogg.app/code/${encoded}`)).toBe(encoded);
    expect(extractPairingCode(`http://192.168.1.5:9999/code/${encoded}/`)).toBe(encoded);
    expect(extractPairingCode(`https://pair.frogg.app/pair?code=${encoded}#x`)).toBe(encoded);
    expect(extractPairingCode("https://pair.frogg.app/code/")).toBeNull();
    expect(extractPairingCode("https://pair.frogg.app/")).toBeNull();
    expect(hasPairingCode("https://pair.frogg.app/pair")).toBe(false);
  });
});
