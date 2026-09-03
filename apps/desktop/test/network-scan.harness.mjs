// LAN-scan harness. Three ways of probing an FDE daemon on this LAN:
//
//  1. from a page served at a private-network origin, with `fetch`: this is
//     what a browser tab on the LAN does and it must succeed (CORS is fine);
//  2. from a page whose documents are fulfilled by an interceptor at
//     `http://tauri.localhost` (no remote endpoint, like WebView2's
//     `WebResourceRequested` handler) with Chromium's Local Network Access
//     checks on: this reproduces the shell on Windows and records what the
//     browser does to the request;
//  3. the whole app scanning with the shell's Rust probe stubbed by a Node
//     `fetch`: the daemon must appear in "Servers on your network".
//
// The daemon is a stand-in with the real daemon's discovery headers
// (`serveFakeDaemon`); set `FDE_HARNESS_DAEMON=host:port` to point tests 1 and
// 2 at a real one instead. Only GET/OPTIONS requests are made.
//
// Run with `npm run test:harness` (needs `build:ui`, `build:bridge`, Chromium).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import {
  bridgeSource,
  launchChromium,
  openShellPage,
  resolveDistFile,
  serveDist,
  serveFakeDaemon,
  tauriStubSource,
} from "./harness.support.mjs";

let server;
let fakeDaemon;
let daemon;
let identityUrl;

before(async () => {
  server = await serveDist();
  fakeDaemon = await serveFakeDaemon();
  daemon = process.env.FDE_HARNESS_DAEMON ?? fakeDaemon.endpoint;
  identityUrl = `http://${daemon}/api/identity`;
});

after(async () => {
  await server?.close();
  await fakeDaemon?.close();
});

const probeInPage = async (page) =>
  page.evaluate(async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return { ok: response.ok, status: response.status, body: await response.json() };
    } catch (error) {
      return { ok: false, error: `${error.name}: ${error.message}` };
    }
  }, identityUrl);

test("1. fetch from a private-network origin reaches the daemon (CORS is not the blocker)", async () => {
  const browser = await launchChromium();
  try {
    const page = await openShellPage(browser);
    await page.goto(`${server.origin}/`, { waitUntil: "domcontentloaded" });
    const result = await probeInPage(page);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.body.product, "fde");
  } finally {
    await browser.close();
  }
});

test("2. fetch from an intercepted tauri.localhost document under Local Network Access checks", async () => {
  const results = {};
  for (const [label, args] of [
    ["chromium defaults", []],
    ["LocalNetworkAccessChecks on", ["--enable-features=LocalNetworkAccessChecks"]],
  ]) {
    const browser = await launchChromium(args);
    const seenBefore = fakeDaemon.requests.length;
    try {
      const context = await browser.newContext();
      await context.route("http://tauri.localhost/**", async (route) => {
        const file = resolveDistFile(new URL(route.request().url()).pathname);
        const type = file.endsWith(".html") ? "text/html" : "text/javascript";
        await route.fulfill({ status: 200, contentType: type, body: readFileSync(file) });
      });
      const page = await context.newPage();
      const consoleLines = [];
      page.on("console", (message) => consoleLines.push(message.text()));
      await page.addInitScript(tauriStubSource());
      await page.addInitScript(bridgeSource());
      await page.goto("http://tauri.localhost/", { waitUntil: "domcontentloaded" });
      const result = await probeInPage(page);
      results[label] = {
        ...result,
        daemonSaw: fakeDaemon.requests.slice(seenBefore),
        console: consoleLines.filter((line) => /network|CORS|blocked/i.test(line)),
      };
    } finally {
      await browser.close();
    }
  }
  console.log(`[harness] tauri.localhost probe results: ${JSON.stringify(results, null, 2)}`);
  // Evidence, not a gate: Chromium's policy differs by version and flag. The
  // shell's Rust probe exists because the request is not reliable from here.
  assert.equal(Object.keys(results).length, 2);
});

test("3. the app finds the daemon through the shell probe and shows diagnostics", async () => {
  const browser = await launchChromium();
  try {
    const page = await openShellPage(browser);
    const [ip, fakePort] = fakeDaemon.endpoint.split(":");
    // The app sweeps the default daemon port; the stand-in listens elsewhere,
    // so the stubbed Rust probe maps that port to the stand-in's.
    await page.exposeFunction("__harnessProbe", async (url) => {
      const target = new URL(url);
      if (target.port === "9999") target.port = fakePort;
      const response = await fetch(target, { signal: AbortSignal.timeout(700) });
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body };
    });
    const scanLog = [];
    page.on("console", (message) => {
      if (message.text().includes("[network-scan]")) scanLog.push(message.text());
    });
    await page.addInitScript((address) => {
      window.__harnessLocalAddresses = [{ interface: "Wi-Fi", ip: address, prefixLength: 24 }];
    }, ip);
    await page.goto(`${server.origin}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-testid=welcome-screen]", { timeout: 30_000 });
    await page.click("[data-testid=welcome-remote-host]");
    const row = page.locator(`[data-testid="network-server-${ip}:9999"]`);
    await row.waitFor({ timeout: 90_000 });
    assert.match(await row.textContent(), /harness-box/);
    await page.locator("[data-testid=network-scan-diagnostics]").waitFor({ timeout: 90_000 });
    const diagnostics = await page.textContent("[data-testid=network-scan-diagnostics]");
    console.log(`[harness] diagnostics line: ${diagnostics}`);
    console.log(`[harness] ${scanLog.join("\n[harness] ")}`);
    assert.match(diagnostics, /via shell/);
    assert.match(diagnostics, new RegExp(`${ip.replace(/\./g, "\\.")}/24`));
    const subnet = ip.split(".").slice(0, 3).join(".");
    assert.ok(scanLog.some((line) => line.includes(`subnets: ${subnet};`)));
  } finally {
    await browser.close();
  }
});
