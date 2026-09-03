// Evaluates the built bridge bundle against a stubbed Tauri runtime and checks
// the `window.paseoDesktop` surface. Run `npm run build:bridge` first.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(path.join(here, "../src-tauri/bridge.js"), "utf8");

function loadBridge(hostInfo) {
  const invocations = [];
  const listeners = [];
  const sandbox = {
    __FROGG_DESKTOP_HOST__: hostInfo,
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: (callback) => {
        listeners.push(callback);
        return listeners.length;
      },
      invoke: async (cmd, args) => {
        invocations.push({ cmd, args });
        if (cmd === "desktop_invoke") return { echoed: args };
        if (cmd === "agent_navigation_ready") return { serverId: "s", agentId: "a" };
        if (cmd === "plugin:event|listen") return 42;
        return null;
      },
    },
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox, { filename: "bridge.js" });
  return { bridge: sandbox.window.paseoDesktop, invocations, listeners };
}

test("bridge exposes the essential members and none of menu/editor/browser", () => {
  const { bridge } = loadBridge({ platform: "linux", windowChromeMode: "custom-linux" });
  assert.ok(bridge, "window.paseoDesktop is set");
  assert.equal(bridge.platform, "linux");
  assert.equal(bridge.windowChromeMode, "custom-linux");
  for (const member of ["invoke", "getPendingOpenProject"]) {
    assert.equal(typeof bridge[member], "function", member);
  }
  assert.equal(typeof bridge.agentNavigation.ready, "function");
  assert.equal(typeof bridge.events.on, "function");
  assert.equal(typeof bridge.window.getCurrentWindow, "function");
  for (const member of ["ask", "askWithCheckbox", "open"]) {
    assert.equal(typeof bridge.dialog[member], "function", `dialog.${member}`);
  }
  for (const member of ["localAddresses", "reverseLookup"]) {
    assert.equal(typeof bridge.network[member], "function", `network.${member}`);
  }
  for (const member of ["isSupported", "sendNotification"]) {
    assert.equal(typeof bridge.notification[member], "function", `notification.${member}`);
  }
  assert.equal(typeof bridge.opener.openUrl, "function");
  assert.equal(typeof bridge.webUtils.getPathForFile, "function");
  for (const absent of ["menu", "editor", "browser"]) {
    assert.equal(bridge[absent], undefined, `${absent} must be absent in milestone 1`);
  }
  assert.equal(bridge.window.openNew, undefined);

  const win = bridge.window.getCurrentWindow();
  assert.equal(win.label, "main");
  for (const member of [
    "minimize",
    "close",
    "toggleMaximize",
    "isMaximized",
    "setFullscreen",
    "isFullscreen",
    "updateChrome",
    "onResized",
    "setBadgeCount",
    "onDragDropEvent",
  ]) {
    assert.equal(typeof win[member], "function", `window.${member}`);
  }
});

test("invoke routes through desktop_invoke with the command and args", async () => {
  const { bridge, invocations } = loadBridge({
    platform: "win32",
    windowChromeMode: "custom-windows",
  });
  const result = await bridge.invoke("get_desktop_settings");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    echoed: { command: "get_desktop_settings", args: {} },
  });
  await bridge.invoke("patch_desktop_settings", { releaseChannel: "beta" });
  assert.deepEqual(JSON.parse(JSON.stringify(invocations.at(-1))), {
    cmd: "desktop_invoke",
    args: { command: "patch_desktop_settings", args: { releaseChannel: "beta" } },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await bridge.agentNavigation.ready())), {
    serverId: "s",
    agentId: "a",
  });
});

test("network members call the Rust commands and normalise their answers", async () => {
  const { bridge, invocations } = loadBridge({
    platform: "linux",
    windowChromeMode: "custom-linux",
  });
  // The stub echoes the args (not a list), which must read as "no addresses".
  assert.deepEqual(JSON.parse(JSON.stringify(await bridge.network.localAddresses())), []);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations.at(-1))), {
    cmd: "desktop_invoke",
    args: { command: "network_local_addresses", args: {} },
  });
  assert.equal(await bridge.network.reverseLookup("192.168.1.20"), null);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations.at(-1))), {
    cmd: "desktop_invoke",
    args: { command: "network_reverse_lookup", args: { ip: "192.168.1.20" } },
  });
});

test("events.on returns a promise resolving to an unlisten function", async () => {
  const { bridge, invocations } = loadBridge({
    platform: "darwin",
    windowChromeMode: "native-mac",
  });
  const pending = bridge.events.on("open-agent", () => {});
  assert.equal(typeof pending.then, "function", "returns a promise");
  const unlisten = await pending;
  assert.equal(typeof unlisten, "function");
  const listenCall = invocations.find((entry) => entry.cmd === "plugin:event|listen");
  assert.ok(listenCall, "registers a Tauri event listener");
  assert.equal(listenCall.args.event, "paseo:event:open-agent");
});

test("opener rejects non-http(s) urls before reaching the plugin", async () => {
  const { bridge, invocations } = loadBridge({
    platform: "linux",
    windowChromeMode: "custom-linux",
  });
  await assert.rejects(() => bridge.opener.openUrl("file:///etc/passwd"), /Only HTTP\(S\)/);
  await assert.rejects(() => bridge.opener.openUrl("not a url"), /Only HTTP\(S\)/);
  assert.ok(!invocations.some((entry) => entry.cmd.startsWith("plugin:opener")));
});

test("platform falls back to the injected host info", () => {
  const { bridge } = loadBridge({ platform: "darwin", windowChromeMode: "native-mac" });
  assert.equal(bridge.platform, "darwin");
  assert.equal(bridge.windowChromeMode, "native-mac");
});

test("events.on hands listeners the payload, not Tauri's event envelope", async () => {
  const { bridge, listeners } = loadBridge({
    platform: "win32",
    windowChromeMode: "custom-windows",
  });
  const received = [];
  await bridge.events.on("local-daemon-transport-event", (payload) => received.push(payload));
  const listener = listeners.at(-1);
  assert.equal(typeof listener, "function", "registers a Tauri callback");
  const payload = { sessionId: "local-session-1", kind: "open" };
  listener({ event: "paseo:event:local-daemon-transport-event", id: 42, payload });
  assert.deepEqual(received, [payload]);
});
