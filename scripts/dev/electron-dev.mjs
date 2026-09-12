#!/usr/bin/env node
// Own only the children and state of this checkout; the Tauri dev loop can run alongside it.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { loadBrand } from "./branding/load.cjs";
import { electronDevEnvironment } from "./electron-dev-env.mjs";
import { portableCommand } from "./npm-command.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../..");
const state = path.join(root, ".dev/electron");
const offset = createHash("sha256").update(root).digest().readUInt16BE(0) % 1000;
const port = Number(process.env.FDE_ELECTRON_UI_PORT ?? 18000 + offset);
mkdirSync(state, { recursive: true });
const env = electronDevEnvironment({ state, port, brand: loadBrand() });
for (const args of [
  ["run", "install:electron", "--workspace=@fde/desktop-electron"],
  ["run", "build:app-deps"],
  ["run", "build:main", "--workspace=@fde/desktop-electron"],
]) {
  const npm = portableCommand("npm", args);
  const result = spawnSync(npm.command, npm.args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(port, "0.0.0.0", () => probe.close(resolve));
});
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) continue;
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  }
  process.exitCode = code;
}
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop());
function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(error);
    stop(1);
  });
  child.once("exit", (code) => stop(code ?? 0));
  return child;
}
launch(
  process.execPath,
  [
    path.join(root, "node_modules/expo/bin/cli"),
    "start",
    "--web",
    "--host",
    "lan",
    "--port",
    String(port),
  ],
  path.join(root, "apps/ui"),
);
const deadline = Date.now() + 120000;
while (!stopping) {
  try {
    if ((await fetch(env.FDE_DESKTOP_DEV_URL)).ok) break;
  } catch {}
  if (Date.now() > deadline) {
    console.error("Electron UI did not become ready within two minutes.");
    stop(1);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!stopping) launch(require("electron"), [path.join(root, "apps/desktop-electron")], root);
