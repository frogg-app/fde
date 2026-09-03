// Browser harness for the shell's injected bridge: serves the exported web UI
// (`apps/ui/dist`) on the LAN, launches headless Chromium through Playwright,
// and installs a stubbed Tauri runtime plus the built `bridge.js` before the
// page scripts run, the way the shell's initialization script does.
//
// Requires `npm run build:ui` and `npm run build:bridge` to have run, and a
// Playwright Chromium (`npx playwright install chromium` in apps/ui).

import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST_DIR = path.resolve(here, "../../ui/dist");
export const BRIDGE_PATH = path.resolve(here, "../src-tauri/bridge.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** Resolves a request path inside `dist`, falling back to index.html (SPA). */
export function resolveDistFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = path.normalize(path.join(DIST_DIR, clean));
  if (candidate.startsWith(DIST_DIR) && existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return path.join(DIST_DIR, "index.html");
}

/** Serves `dist` on 0.0.0.0 at the first free port from 9990 upwards. */
export async function serveDist(startPort = 9990) {
  const server = http.createServer((req, res) => {
    const file = resolveDistFile(req.url ?? "/");
    res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    createReadStream(file).pipe(res);
  });
  for (let port = startPort; port < startPort + 50; port += 1) {
    const bound = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "0.0.0.0", () => resolve(true));
    });
    if (bound) {
      return {
        port,
        origin: `http://${lanAddress()}:${port}`,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    }
  }
  throw new Error("no free port for the dist server");
}

/** This machine's first non-internal IPv4 address (the AGENTS.md rule: never localhost). */
export function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

/**
 * Source of the `__TAURI_INTERNALS__` stub. Every `invoke` is appended to
 * `window.__harnessInvocations` as `{cmd, args}`; `desktop_invoke` answers a
 * few commands the startup path needs so the landing screen renders as it
 * does in the shell without a daemon bundle. `network_probe_identity` is
 * routed to `window.__harnessProbe` when the test exposes one.
 */
export function tauriStubSource({ platform = "win32", chromeMode = "custom-windows" } = {}) {
  return `
    window.__FROGG_DESKTOP_HOST__ = {
      platform: ${JSON.stringify(platform)},
      windowChromeMode: ${JSON.stringify(chromeMode)},
      appVersion: "0.0.0-harness",
      windowLabel: "main",
    };
    window.__harnessInvocations = [];
    const desktopAnswers = {
      desktop_daemon_status: () => ({
        serverId: null, status: "stopped", listen: null, hostname: null, pid: null,
        home: "", version: null, desktopManaged: true,
        error: "Local daemon bundle is not installed",
      }),
      local_daemon_bundle_status: () => ({ installed: false }),
      get_desktop_settings: () => ({}),
      desktop_get_runtime_info: () => ({ platform: ${JSON.stringify(platform)} }),
      desktop_get_system_idle_time: () => 0,
      network_local_addresses: () => window.__harnessLocalAddresses ?? [],
      network_reverse_lookup: () => null,
      network_probe_identity: (args) =>
        window.__harnessProbe ? window.__harnessProbe(args.url) : Promise.reject(new Error("no probe")),
      pairing_offer_ready: () => null,
      get_cli_install_status: () => ({ installed: false }),
      check_app_update: () => ({ status: "up-to-date" }),
      garbage_collect_attachment_files: () => ({ deleted: 0 }),
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const windowAnswers = {
      "plugin:window|is_fullscreen": () => false,
      "plugin:window|is_maximized": () => false,
      "plugin:window|start_dragging": () => null,
      "plugin:window|toggle_maximize": () => null,
      "plugin:window|minimize": () => null,
      "plugin:window|close": () => null,
      "plugin:event|listen": () => 1,
      "plugin:event|unlisten": () => null,
      "plugin:os|platform": () => ${JSON.stringify(platform === "win32" ? "windows" : platform)},
      "get_pending_open_project": () => null,
      "agent_navigation_ready": () => null,
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback) => { const id = Math.floor(Math.random() * 1e9); window["_" + id] = callback; return id; },
      invoke: async (cmd, args) => {
        window.__harnessInvocations.push({ cmd, args });
        if (cmd === "desktop_invoke") {
          const answer = desktopAnswers[args?.command];
          if (answer) return answer(args?.args ?? {});
          throw new Error("Unknown desktop command: " + args?.command);
        }
        const answer = windowAnswers[cmd];
        return answer ? answer(args) : null;
      },
      convertFileSrc: (p) => p,
    };
  `;
}

/**
 * A stand-in for `fde daemon`'s discovery endpoints with the exact headers the
 * real daemon (packages/server, 0.1.14) sends: `/api/identity` carries
 * `Access-Control-Allow-Origin: *`, and OPTIONS is answered 204 by the CORS
 * middleware with no `Access-Control-Allow-Private-Network` header. Bound on
 * 0.0.0.0 so a LAN-origin page can reach it.
 */
export async function serveFakeDaemon(startPort = 9980) {
  const identity = {
    product: "fde",
    serverId: "srv_harness",
    hostname: "harness-box",
    version: "0.1.14",
    listen: "0.0.0.0:0",
    pairingRequired: false,
  };
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, origin: req.headers.origin ?? null });
    if (req.method === "OPTIONS") {
      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Credentials", "true");
      }
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.url === "/api/identity") {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(identity));
      return;
    }
    if (req.url === "/api/health") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  for (let port = startPort; port < startPort + 10; port += 1) {
    const bound = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "0.0.0.0", () => resolve(true));
    });
    if (bound) {
      return {
        endpoint: `${lanAddress()}:${port}`,
        identity,
        requests,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      };
    }
  }
  throw new Error("no free port for the fake daemon");
}

export function bridgeSource() {
  return readFileSync(BRIDGE_PATH, "utf8");
}

/** Launches headless Chromium; `args` are extra Chromium switches. */
export async function launchChromium(args = []) {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, args });
}

/** A page with the Tauri stub and the bridge installed before any page script. */
export async function openShellPage(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.addInitScript(tauriStubSource(options));
  await page.addInitScript(bridgeSource());
  return page;
}

export async function invocations(page, cmd) {
  const all = await page.evaluate(() => window.__harnessInvocations);
  return cmd ? all.filter((entry) => entry.cmd === cmd) : all;
}
