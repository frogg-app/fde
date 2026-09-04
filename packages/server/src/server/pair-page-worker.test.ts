import { describe, expect, test } from "vitest";

import { encodeOfferFragmentPayload } from "@fde/protocol/connection-offer";
import { createPairPageApp } from "./pair-page-server.js";
import { handlePairPageRequest } from "./pair-page-worker.js";
import { EXPIRED_PAIRING_MESSAGE } from "./pairing-code-page.js";

const BASE_URL = "https://pair.example";
const ENV = { FDE_PAIRING_BASE_URL: BASE_URL, FDE_PAIR_ROOT_REDIRECT: "https://frogg.example" };

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

function get(path: string): Promise<Response> {
  return handlePairPageRequest(new Request(`https://pair.example${path}`), ENV);
}

/** The express service, for the parity test below. */
function startService() {
  const server = createPairPageApp({ pairingBaseUrl: BASE_URL }).listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no TCP address");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("pairing page worker", () => {
  test("renders a hand-off page for another daemon's live code", async () => {
    const code = codeFor(new Date(Date.now() + 5 * 60_000).toISOString());
    const response = await get(`/code/${code}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(code);
    expect(html).toContain(`paseo://pair#offer=${code}`);
    expect(html).toContain("<svg");
    // It issues no codes, so it can never pair the browser looking at the page,
    // and it never echoes back the hostname from a foreign offer.
    expect(html).not.toContain("Pair this browser");
    expect(html).not.toContain("devbox");
  });

  test("accepts the ?code= form the daemon also serves", async () => {
    const code = codeFor(new Date(Date.now() + 5 * 60_000).toISOString());
    const response = await get(`/pair?code=${code}`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(code);
  });

  test("renders one generic expired page for everything that is not a live offer", async () => {
    const expired = codeFor(new Date(Date.now() - 60_000).toISOString());
    for (const path of [`/code/${expired}`, "/code/not-an-offer", "/pair", "/anything/else"]) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain(EXPIRED_PAIRING_MESSAGE);
    }
  });

  test("redirects the root and carries the hardening headers", async () => {
    const root = await get("/");
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe("https://frogg.example");

    const page = await get(`/code/${codeFor(new Date(Date.now() + 60_000).toISOString())}`);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("referrer-policy")).toBe("no-referrer");
    expect(page.headers.get("cache-control")).toBe("no-store");
  });

  test("answers healthz", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "fde-pair-page" });
  });

  /**
   * The whole point of the port: the Worker is transport only, so the bytes it
   * serves must match the express service the daemon and the container run.
   */
  test("serves byte-identical HTML to the express service", async () => {
    const service = startService();
    try {
      const code = codeFor(new Date(Date.now() + 5 * 60_000).toISOString());
      for (const path of [`/code/${code}`, `/pair?code=${code}`, "/code/bogus"]) {
        const fromExpress = await fetch(`${service.base}${path}`);
        const fromWorker = await get(path);

        expect(fromWorker.status).toBe(fromExpress.status);
        expect(await fromWorker.text()).toBe(await fromExpress.text());
      }
    } finally {
      await service.close();
    }
  });
});
