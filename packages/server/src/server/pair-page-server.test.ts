import { describe, expect, test } from "vitest";

import { encodeOfferFragmentPayload } from "@fde/protocol/connection-offer";
import { EXPIRED_PAIRING_MESSAGE } from "./pairing-code-page.js";
import { createPairPageApp } from "./pair-page-server.js";

function codeFor(expiresAt: string): string {
  return encodeOfferFragmentPayload({
    v: 3,
    product: "fde",
    serverId: "srv_someone_elses_daemon",
    hostname: "devbox",
    daemonPublicKeyB64: "pubkey",
    direct: { endpoints: ["192.168.1.10:9999"] },
    claim: { token: "tok", expiresAt },
  });
}

function startService() {
  const server = createPairPageApp({
    pairingBaseUrl: "https://pair.example",
  }).listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no TCP address");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("standalone pairing page service", () => {
  test("renders a hand-off page for another daemon's live code", async () => {
    const service = startService();
    try {
      const code = codeFor(new Date(Date.now() + 5 * 60_000).toISOString());
      const response = await fetch(`${service.base}/code/${code}`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain(code);
      expect(html).toContain(`paseo://pair#offer=${code}`);
      expect(html).toContain("<svg");
      // It issued no codes, so it can never pair the browser looking at it,
      // and it says nothing about the daemon the code belongs to.
      expect(html).not.toContain("Pair this browser");
      expect(html).not.toContain("devbox");
    } finally {
      await service.close();
    }
  });

  test("expired codes, unknown paths, and bare /pair render one generic page", async () => {
    const service = startService();
    try {
      for (const path of [
        `/code/${codeFor(new Date(Date.now() - 1_000).toISOString())}`,
        "/code/not-a-code",
        "/pair",
        "/anything-else",
      ]) {
        const response = await fetch(`${service.base}${path}`);
        expect(response.status, path).toBe(404);
        expect(await response.text(), path).toContain(EXPIRED_PAIRING_MESSAGE);
      }
    } finally {
      await service.close();
    }
  });

  test("answers health checks and sends bare visitors to the site", async () => {
    const service = startService();
    try {
      const health = await fetch(`${service.base}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ ok: true });

      const root = await fetch(`${service.base}/`, { redirect: "manual" });
      expect(root.status).toBe(302);
      expect(root.headers.get("location")).toBe("https://frogg.app");
    } finally {
      await service.close();
    }
  });
});
