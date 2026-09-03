import express from "express";
import { describe, expect, test } from "vitest";

import {
  buildPairingUrl,
  encodeOfferFragmentPayload,
  type ConnectionOfferV3,
} from "@fde/protocol/connection-offer";
import { createClaimOfferStore } from "./claim-offer-store.js";
import { EXPIRED_PAIRING_MESSAGE } from "./pairing-code-page.js";
import { mountPairingCodeRoutes, resolvePairingCode } from "./pairing-code-route.js";

const SERVER_ID = "srv_test";
const PAIRING_BASE_URL = "https://pair.frogg.app";

function buildOffer(input: {
  token: string;
  expiresAt: string;
  serverId?: string;
}): ConnectionOfferV3 {
  return {
    v: 3,
    product: "fde",
    serverId: input.serverId ?? SERVER_ID,
    hostname: "devbox",
    daemonPublicKeyB64: "pubkey",
    direct: { endpoints: ["192.168.1.10:9999"] },
    claim: { token: input.token, expiresAt: input.expiresAt },
  };
}

function startServer(offers = createClaimOfferStore()) {
  const app = express();
  mountPairingCodeRoutes(app, {
    serverId: SERVER_ID,
    offers,
    pairingBaseUrl: () => PAIRING_BASE_URL,
  });
  const server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no TCP address");
  return {
    offers,
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("pairing code page", () => {
  test("renders the code, the deep link, and a QR for a live code", async () => {
    const server = startServer();
    try {
      const claim = server.offers.issue();
      const code = encodeOfferFragmentPayload(buildOffer(claim));

      const response = await fetch(`${server.base}/code/${code}`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(html).toContain(code);
      expect(html).toContain(`paseo://pair#offer=${code}`);
      expect(html).toContain("<svg");
      expect(html).toContain("Pair this browser");
      expect(html).toContain("devbox");
    } finally {
      await server.close();
    }
  });

  test("serves the same page from /pair?code=", async () => {
    const server = startServer();
    try {
      const code = encodeOfferFragmentPayload(buildOffer(server.offers.issue()));
      const response = await fetch(`${server.base}/pair?code=${code}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(code);
    } finally {
      await server.close();
    }
  });

  test("leaks nothing for an unknown, malformed, or expired code", async () => {
    const server = startServer();
    try {
      const expired = encodeOfferFragmentPayload(
        buildOffer({ token: "gone", expiresAt: new Date(Date.now() - 1000).toISOString() }),
      );
      const unknownToken = encodeOfferFragmentPayload(
        buildOffer({
          token: "never-issued",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );

      for (const path of [
        "/code/not-an-offer",
        "/code/!!!",
        `/code/${expired}`,
        `/code/${unknownToken}`,
        "/pair?code=",
        "/pair",
      ]) {
        const response = await fetch(`${server.base}${path}`);
        const html = await response.text();
        expect(response.status).toBe(404);
        expect(html).toContain(EXPIRED_PAIRING_MESSAGE);
        expect(html).not.toContain("devbox");
        expect(html).not.toContain(SERVER_ID);
        expect(html).not.toContain("Pair this browser");
      }
    } finally {
      await server.close();
    }
  });
});

describe("resolvePairingCode", () => {
  const offers = createClaimOfferStore();
  const deps = { serverId: SERVER_ID, offers, pairingBaseUrl: () => PAIRING_BASE_URL };

  test("offers the browser pairing only for this daemon's own live token", () => {
    const claim = offers.issue();
    expect(resolvePairingCode(encodeOfferFragmentPayload(buildOffer(claim)), deps)).toEqual({
      hostname: "devbox",
      canPairThisBrowser: true,
    });

    // Another daemon's code still renders (a proxy may serve it) but cannot be
    // claimed here, and nothing about it is echoed back.
    const foreign = encodeOfferFragmentPayload(buildOffer({ ...claim, serverId: "srv_other" }));
    expect(resolvePairingCode(foreign, deps)).toEqual({
      hostname: null,
      canPairThisBrowser: false,
    });
  });

  test("a consumed token stops resolving", () => {
    const claim = offers.issue();
    const code = encodeOfferFragmentPayload(buildOffer(claim));
    expect(resolvePairingCode(code, deps)).not.toBeNull();
    expect(offers.consume(claim.token)).toBe(true);
    expect(resolvePairingCode(code, deps)).toBeNull();
  });

  test("reads the code out of a full pairing URL shape", () => {
    const claim = offers.issue();
    const code = encodeOfferFragmentPayload(buildOffer(claim));
    expect(buildPairingUrl(PAIRING_BASE_URL, code)).toBe(`${PAIRING_BASE_URL}/code/${code}`);
    expect(resolvePairingCode(code, deps)?.canPairThisBrowser).toBe(true);
  });
});
