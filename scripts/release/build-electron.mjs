#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { portableCommand } from "../dev/npm-command.mjs";
import { writeElectronChecksums } from "./electron-checksums.mjs";
import { writeElectronInstallerZips } from "./electron-installer-zip.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const desktop = path.join(root, "apps/desktop-electron");
const { values } = parseArgs({
  options: {
    target: {
      type: "string",
      default: `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
    },
    dir: { type: "boolean", default: false },
  },
});
const [platform, arch] = values.target.split("-");
if (!/^(linux|darwin|win)-(x64|arm64)$/.test(values.target)) {
  throw new Error("Expected --target <linux|darwin|win>-<x64|arm64> (for example win-x64)");
}
if (platform === "darwin" && process.platform !== "darwin") {
  throw new Error("macOS artifacts must be built on macOS.");
}
function run(script, args = []) {
  const npm = portableCommand("npm", ["run", script, ...args]);
  const result = spawnSync(npm.command, npm.args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
}
run("build:ui");
run("build:main", ["--workspace=@fde/desktop-electron"]);
const builder = path.join(root, "node_modules/electron-builder/cli.js");
const platformFlag = platform === "darwin" ? "--mac" : `--${platform}`;
rmSync(path.join(desktop, "release"), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    builder,
    "--config",
    "electron-builder.cjs",
    platformFlag,
    `--${arch}`,
    "--publish",
    "never",
    ...(values.dir ? ["--dir"] : []),
  ],
  {
    cwd: desktop,
    stdio: "inherit",
    env: process.env,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!values.dir) {
  if (platform === "win") await writeElectronInstallerZips(path.join(desktop, "release"));
  await writeElectronChecksums(path.join(desktop, "release"));
}
