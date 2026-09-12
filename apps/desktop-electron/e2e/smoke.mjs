#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktop = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desktop, "../..");
const state = await mkdtemp(path.join(os.tmpdir(), "fde-electron-smoke-"));
const profile = path.join(state, "profile");
await mkdir(profile);
await writeFile(
  path.join(profile, "desktop-settings.json"),
  JSON.stringify({
    version: 1,
    settings: {
      releaseChannel: "stable",
      notifications: { playSound: true },
      daemon: { manageBuiltInDaemon: true, keepRunningAfterQuit: true },
      updates: { autoCheck: false },
    },
    migrations: {
      legacyRendererSettingsImported: true,
      daemonStopOnQuitDefaultApplied: true,
    },
  }),
);
const env = {
  ...process.env,
  FDE_ELECTRON_USER_DATA_DIR: profile,
  FDE_ELECTRON_UI_DIR: path.join(root, "apps/ui/dist"),
  FDE_HOME: path.join(state, "daemon"),
  PASEO_HOME: path.join(state, "daemon"),
  PASEO_LISTEN: "0.0.0.0:0",
  FDE_LISTEN: "0.0.0.0:0",
  PASEO_RELAY_ENABLED: "false",
  FDE_RELAY_ENABLED: "false",
  PASEO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
  PASEO_ENABLE_REACT_DEVTOOLS: "0",
};
delete env.ELECTRON_RUN_AS_NODE;
const args = process.env.FDE_ELECTRON_SMOKE_NO_SANDBOX === "1" ? ["--no-sandbox"] : [];
const executablePath = process.env.FDE_ELECTRON_SMOKE_EXECUTABLE;
if (executablePath) delete env.FDE_ELECTRON_UI_DIR;
const output = process.env.FDE_ELECTRON_SMOKE_OUTPUT;
const report = { launches: [], screenshot: null };
let application;
async function assertNoServerState() {
  const entries = await readdir(env.FDE_HOME).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  assert.deepEqual(
    entries.filter((entry) => entry !== "desktop-attachments"),
    [],
  );
}

try {
  for (let launch = 0; launch < 2; launch += 1) {
    application = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...args, ...(executablePath ? [] : [desktop])],
      env,
      timeout: 45_000,
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => document.body.innerText.trim().length > 20);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("@paseo:e2e", "1");
    });
    await page.goto("paseo://app/welcome");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.paseoDesktop?.invoke));
    await page.waitForFunction(() => document.body.innerText.trim().length > 20);
    const security = await application.evaluate(({ BrowserWindow }) => {
      const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        sandbox: preferences.sandbox,
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
      };
    });
    assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    const runtime = await page.evaluate(() =>
      window.paseoDesktop.invoke("desktop_get_runtime_info"),
    );
    assert.equal(typeof runtime.appVersion, "string");
    const settings = await page.evaluate(() => window.paseoDesktop.invoke("get_desktop_settings"));
    assert.equal(settings.daemon.manageBuiltInDaemon, false);
    assert.equal(settings.daemon.keepRunningAfterQuit, false);
    assert.equal(await page.evaluate(() => window.paseoDesktop.supportsLocalDaemon), false);
    assert.equal(settings.notifications.playSound, launch === 0);
    if (launch === 0) {
      const patched = await page.evaluate(() =>
        window.paseoDesktop.invoke("patch_desktop_settings", {
          notifications: { playSound: false },
        }),
      );
      assert.equal(patched.notifications.playSound, false);
    }
    await assert.rejects(
      page.evaluate(() => window.paseoDesktop.invoke("smoke_unknown_command")),
      /Unknown desktop command/,
    );
    const addresses = await page.evaluate(() => window.paseoDesktop.network.localAddresses());
    assert.equal(Array.isArray(addresses), true);
    assert.equal(
      await page.evaluate(() => window.paseoDesktop.window.getCurrentWindow().isFullscreen()),
      false,
    );
    for (const command of ["start_desktop_daemon", "install_local_daemon_bundle", "install_cli"]) {
      await assert.rejects(page.evaluate((name) => window.paseoDesktop.invoke(name), command));
    }
    assert.equal(await page.getByText("Run agents on this machine", { exact: true }).count(), 0);
    await page.getByTestId("welcome-remote-ssh").waitFor();
    await page.getByTestId("welcome-direct-connection").waitFor();
    await assertNoServerState();
    if (launch === 0 && output) {
      await mkdir(output, { recursive: true });
      report.screenshot = path.join(output, "electron-smoke.png");
      await page.screenshot({ path: report.screenshot });
    }
    assert.deepEqual(errors, []);
    report.launches.push({
      runtime,
      security,
      supportsLocalDaemon: false,
      rendererErrors: errors,
      profilePersisted: launch > 0,
    });
    await application.close();
    application = null;
    await assertNoServerState();
  }
  report.daemonStateCreated = false;
  if (output)
    await writeFile(
      path.join(output, "electron-smoke.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (application) await application.close();
  await rm(state, { recursive: true, force: true });
}
