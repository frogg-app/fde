import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { afterEach, describe, expect, test } from "vitest";

import { parseAnyConnectionOfferFromUrl } from "@fde/protocol/connection-offer";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "./test-utils/paseo-daemon.js";

/**
 * The test daemon binds 127.0.0.1, so a "remote" visitor is simulated with
 * X-Forwarded-For: the default trusted proxy setting is `loopback`, exactly the
 * reverse-proxy-on-localhost case the gate has to see through.
 */
const REMOTE = { "x-forwarded-for": "192.168.1.23" };
const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

function extractPairingUrl(html: string): string {
  const match = html.match(/id="link" class="link" href="([^"]+)"/);
  if (!match?.[1]) throw new Error("pairing link missing from claim page");
  return match[1].replace(/&amp;/g, "&");
}

function wsClose(
  port: number,
  headers: Record<string, string>,
  protocol?: string,
): Promise<{ code: number; reason: string } | "open"> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, protocol ? [protocol] : undefined, {
      headers,
    });
    ws.once("open", () => {
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
          resolve("open");
        }
      }, 150);
    });
    ws.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.once("error", reject);
  });
}

describe("first-run claim gate", () => {
  let tempRoot: string | null = null;
  let daemonHandle: TestPaseoDaemon | null = null;

  async function startDaemon(options: { password?: string } = {}): Promise<TestPaseoDaemon> {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "fde-claim-gate-"));
    const distDir = path.join(tempRoot, "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(
      path.join(distDir, "index.html"),
      "<!DOCTYPE html><html><head></head><body>the app</body></html>",
    );
    daemonHandle = await createTestPaseoDaemon({
      mcpEnabled: false,
      webUi: { enabled: true, distDir },
      ...(options.password ? { auth: { password: options.password } } : {}),
    });
    return daemonHandle;
  }

  afterEach(async () => {
    await daemonHandle?.close();
    daemonHandle = null;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  test("serves the claim page to remote visitors, the app to loopback, and the app after claiming", async () => {
    const { port, daemon } = await startDaemon();
    const base = `http://127.0.0.1:${port}`;

    const identity = await (await fetch(`${base}/api/identity`, { headers: REMOTE })).json();
    expect(identity).toMatchObject({
      product: "fde",
      pairingRequired: true,
      listen: `127.0.0.1:${port}`,
    });

    const loopback = await fetch(`${base}/`);
    expect(loopback.status).toBe(200);
    expect(await loopback.text()).toContain("the app");

    const gated = await fetch(`${base}/some/deep/link`, { headers: REMOTE });
    expect(gated.status).toBe(200);
    expect(gated.headers.get("cache-control")).toContain("no-store");
    const html = await gated.text();
    expect(html).toContain("Claim this FDE daemon");
    expect(html).toContain("#25B5C8");
    expect(html).toContain("<svg");

    // Remote API and WebSocket access is locked while unclaimed.
    const lockedApi = await fetch(`${base}/api/status`, { headers: REMOTE });
    expect(lockedApi.status).toBe(401);
    expect(await lockedApi.json()).toEqual({ error: "Unauthorized", setup: "unclaimed" });
    expect(await wsClose(port, REMOTE)).toEqual({ code: 4401, reason: "Pairing required" });
    // Loopback keeps working as before.
    expect((await fetch(`${base}/api/status`)).status).toBe(200);
    expect(await wsClose(port, {})).toBe("open");

    const offer = parseAnyConnectionOfferFromUrl(extractPairingUrl(html));
    if (!offer || offer.v !== 3) throw new Error("expected a v3 direct claim offer");
    expect(offer.direct.endpoints[0]).toBe(`127.0.0.1:${port}`);
    expect(offer.serverId).toBe(identity.serverId);

    const status = await (await fetch(`${base}/api/setup/status`, { headers: REMOTE })).json();
    expect(status).toEqual({ claimed: false, pairingRequired: true });

    const claimed = await fetch(`${base}/api/setup/claim`, {
      method: "POST",
      headers: { ...REMOTE, "content-type": "application/json" },
      body: JSON.stringify({ token: offer.claim.token, label: "Phone" }),
    });
    expect(claimed.status).toBe(201);
    const minted = (await claimed.json()) as { credential: string; principalId: string };
    expect(minted.credential.length).toBeGreaterThan(20);
    expect(daemon.claimStore.isClaimed()).toBe(true);
    expect(daemon.claimStore.read().principals[0]?.label).toBe("Phone");

    // The token was single-use.
    const replay = await fetch(`${base}/api/setup/claim`, {
      method: "POST",
      headers: { ...REMOTE, "content-type": "application/json" },
      body: JSON.stringify({ token: offer.claim.token }),
    });
    expect(replay.status).toBe(403);

    const afterClaim = await fetch(`${base}/`, { headers: REMOTE });
    expect(await afterClaim.text()).toContain("the app");
    expect((await (await fetch(`${base}/api/identity`)).json()).pairingRequired).toBe(false);

    // The minted credential is the bearer for HTTP and WebSocket from remote clients.
    const withCredential = await fetch(`${base}/api/status`, {
      headers: { ...REMOTE, authorization: `Bearer ${minted.credential}` },
    });
    expect(withCredential.status).toBe(200);
    expect((await fetch(`${base}/api/status`, { headers: REMOTE })).status).toBe(401);
    expect(await wsClose(port, REMOTE, `paseo.bearer.${minted.credential}`)).toBe("open");
    expect(await wsClose(port, REMOTE, "paseo.bearer.wrong")).toEqual({
      code: 4401,
      reason: "Incorrect password",
    });

    // Paired clients can issue another offer; unauthenticated remote clients cannot.
    const anotherOffer = await fetch(`${base}/api/setup/offer`, {
      method: "POST",
      headers: { ...REMOTE, authorization: `Bearer ${minted.credential}` },
    });
    expect(anotherOffer.status).toBe(200);
    expect((await anotherOffer.json()).claimed).toBe(true);
    expect(
      (await fetch(`${base}/api/setup/offer`, { method: "POST", headers: REMOTE })).status,
    ).toBe(401);

    // Reset (what `fde daemon reset-claim` does) brings the gate back without a restart.
    daemon.claimStore.reset();
    expect(await (await fetch(`${base}/`, { headers: REMOTE })).text()).toContain(
      "Claim this FDE daemon",
    );
  });

  test("a configured password counts as claimed: no gate, password required everywhere", async () => {
    const { port } = await startDaemon({ password: CORRECT_PASSWORD_HASH });
    const base = `http://127.0.0.1:${port}`;
    expect((await (await fetch(`${base}/api/identity`)).json()).pairingRequired).toBe(false);
    expect(await (await fetch(`${base}/`, { headers: REMOTE })).text()).toContain("the app");
    expect((await fetch(`${base}/api/status`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/status`, { headers: { authorization: "Bearer correct-password" } }))
        .status,
    ).toBe(200);
  });
});
