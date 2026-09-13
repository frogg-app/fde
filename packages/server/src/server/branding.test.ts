import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  const brand = resolveBrandManifest({
    schemaVersion: 1,
    id: "acme",
    name: "Acme <Studio> 日本語",
    applicationId: "com.acme.studio",
    daemonPort: 10099,
    assets: { icon: "icon.png" },
  });
  return {
    brand,
    brandIdentity: { id: brand.id, name: brand.name, applicationId: brand.applicationId },
  };
});
import { brandIdentity } from "@frogg/branding";
import { resolveConfiguredHome } from "./frogg-home.js";
import { loadConfig } from "./config.js";
import { acquirePidLock, releasePidLock } from "./pid-lock.js";
import { renderExpiredPairingPage } from "./pairing-code-page.js";
import { renderClaimGatePage } from "./claim-gate-page.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function scratch() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brand server "));
  roots.push(dir);
  return dir;
}

test("custom daemon defaults use the branded port without inherited Frogg infrastructure", async () => {
  const home = await scratch();
  const config = loadConfig(home, { env: {} });
  expect(config.listen).toBe("0.0.0.0:10099");
  expect(config.relayEnabled).toBe(false);
  expect(config.relayEndpoint).toBe("");
  expect(config.appBaseUrl).toBe("");
  expect(resolveConfiguredHome({ FROGG_HOME: "/foreign" })).toBeUndefined();
  expect(resolveConfiguredHome({ ACME_HOME: "/own" })).toBe("/own");
});
test("a foreign PID record cannot be reclaimed or removed", async () => {
  const home = await scratch();
  const foreign = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    uid: 0,
    listen: null,
    brand: { id: "frogg", applicationId: "app.frogg.frogg" },
  };
  await writeFile(path.join(home, "frogg.pid"), JSON.stringify(foreign));
  await expect(acquirePidLock(home, null)).rejects.toThrow(/another product/);
  await releasePidLock(home);
  expect(JSON.parse(await readFile(path.join(home, "frogg.pid"), "utf8"))).toEqual(foreign);
  await rm(path.join(home, "frogg.pid"));
  await acquirePidLock(home, "127.0.0.1:10099");
  expect(JSON.parse(await readFile(path.join(home, "frogg.pid"), "utf8")).brand).toEqual(
    brandIdentity,
  );
  await releasePidLock(home);
});
test("pairing HTML escapes Unicode product copy and uses the custom command", () => {
  const html = renderExpiredPairingPage();
  expect(html).toContain("Acme &lt;Studio&gt; 日本語");
  expect(html).toContain("acme pair");
  expect(html).not.toContain("<Studio>");
  const claim = renderClaimGatePage({
    hostname: "test",
    serverId: "test",
    version: "1.2.3",
    pairingUrl: "acme://pair#offer=test",
    qrSvg: null,
    expiresAt: new Date().toISOString(),
    endpoints: [],
  });
  expect(claim).toContain("acme daemon pair");
  expect(claim).toContain("acme://pair#offer=test");
  expect(claim).not.toContain("Loading Acme <Studio>");
});
