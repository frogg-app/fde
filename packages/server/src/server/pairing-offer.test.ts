import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { generateLocalPairingOffer } from "./pairing-offer.js";

const roots: string[] = [];

describe("generateLocalPairingOffer", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("treats relay enabled without an endpoint as relay unavailable", async () => {
    const fdeHome = await mkdtemp(path.join(os.tmpdir(), "fde-pairing-offer-"));
    roots.push(fdeHome);

    await expect(
      generateLocalPairingOffer({ fdeHome, relayEnabled: true, relayEndpoint: "" }),
    ).resolves.toEqual({ relayEnabled: false, url: null, qr: null });
    await expect(generateLocalPairingOffer({ fdeHome, relayEnabled: true })).resolves.toEqual({
      relayEnabled: false,
      url: null,
      qr: null,
    });
  });

  test("builds an offer once an endpoint is configured", async () => {
    const fdeHome = await mkdtemp(path.join(os.tmpdir(), "fde-pairing-offer-"));
    roots.push(fdeHome);

    const offer = await generateLocalPairingOffer({
      fdeHome,
      relayEnabled: true,
      relayEndpoint: "relay.example.test:443",
      appBaseUrl: "https://pair.example.test",
      includeQr: false,
    });
    expect(offer.relayEnabled).toBe(true);
    expect(offer.url).toContain("https://pair.example.test");
  });
});
