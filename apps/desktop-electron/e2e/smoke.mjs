#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const desktop = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desktop, "../..");
const state = await mkdtemp(path.join(os.tmpdir(), "fde-electron-smoke-"));
const profile = path.join(state, "profile");
await mkdir(profile);
await mkdir(path.join(state, "daemon"));
await writeFile(
  path.join(state, "daemon/config.json"),
  JSON.stringify({ daemon: { listen: "0.0.0.0:0" } }),
);
await writeFile(
  path.join(profile, "desktop-settings.json"),
  JSON.stringify({
    version: 1,
    settings: {
      releaseChannel: "stable",
      notifications: { playSound: true },
      daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: false },
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
const execute = promisify(execFile);
const cli = path.join(root, "apps/cli/dist/index.js");
const cliOptions = { env, timeout: 30_000 };
let application;
let externalDaemonStarted = false;
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return false;
  }
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
    assert.equal(settings.daemon.manageBuiltInDaemon, launch > 0);
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
    const bundle = await page.evaluate(() =>
      window.paseoDesktop.invoke("local_daemon_bundle_status"),
    );
    assert.equal(bundle.installed, true);
    if (launch === 0) {
      await page.getByText("Run agents on this machine", { exact: true }).click();
    }
    await page.waitForFunction(
      async () => {
        const status = await window.paseoDesktop.invoke("desktop_daemon_status");
        if (status.status === "errored") throw new Error(status.error);
        return status.status === "running";
      },
      undefined,
      { timeout: 60_000 },
    );
    const daemon = await page.evaluate(() => window.paseoDesktop.invoke("desktop_daemon_status"));
    assert.equal(daemon.home, env.FDE_HOME);
    assert.equal(typeof daemon.pid, "number", JSON.stringify(daemon));
    assert.equal(daemon.desktopManaged, true);
    assert.equal(typeof daemon.serverId, "string");
    assert.notEqual(daemon.serverId, "");
    if (launch === 0 && output) {
      await mkdir(output, { recursive: true });
      report.screenshot = path.join(output, "electron-smoke.png");
      await page.screenshot({ path: report.screenshot });
    }
    assert.deepEqual(errors, []);
    report.launches.push({
      runtime,
      security,
      daemon,
      rendererErrors: errors,
      profilePersisted: launch > 0,
    });
    await application.close();
    application = null;
    const shutdownDeadline = Date.now() + 15_000;
    let daemonAlive = isProcessAlive(daemon.pid);
    while (daemonAlive && Date.now() < shutdownDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      daemonAlive = isProcessAlive(daemon.pid);
    }
    assert.equal(daemonAlive, false, "Desktop-owned daemon survived app close");
  }
  await execute(
    process.execPath,
    [cli, "start", "--home", env.FDE_HOME, "--listen", "0.0.0.0:0", "--no-relay"],
    cliOptions,
  );
  externalDaemonStarted = true;
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [...args, ...(executablePath ? [] : [desktop])],
    env,
    timeout: 45_000,
  });
  const externalPage = await application.firstWindow();
  await externalPage.waitForFunction(() => Boolean(window.paseoDesktop?.invoke));
  const externalStatus = await externalPage.evaluate(() =>
    window.paseoDesktop.invoke("desktop_daemon_status"),
  );
  assert.equal(externalStatus.status, "running");
  assert.equal(externalStatus.desktopManaged, false);
  await application.close();
  application = null;
  const result = await execute(
    process.execPath,
    [cli, "daemon", "status", "--json", "--home", env.FDE_HOME],
    cliOptions,
  );
  assert.equal(JSON.parse(result.stdout).localDaemon, "running");
  report.externalDaemonSurvivedClose = true;
  if (output)
    await writeFile(
      path.join(output, "electron-smoke.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (application) await application.close();
  if (externalDaemonStarted) {
    await execute(process.execPath, [cli, "stop", "--home", env.FDE_HOME], cliOptions);
  }
  await rm(state, { recursive: true, force: true });
}
