#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { portableCommand } from "../dev/npm-command.mjs";

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    "cache-state": { type: "string", default: "existing" },
    out: { type: "string", default: ".dev/build-benchmarks" },
  },
});
if (!/^(linux|win|darwin)-(x64|arm64)$/.test(values.target ?? "")) {
  throw new Error("Provide --target linux-x64, win-x64, darwin-arm64 or another supported target.");
}
const root = path.resolve(import.meta.dirname, "../..");
const started = new Date();
const directory = path.resolve(
  values.out,
  `${started.toISOString().replaceAll(":", "-")}-${values.target}`,
);
mkdirSync(directory, { recursive: true });
const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim();
const metadata = {
  target: values.target,
  host: {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    memoryBytes: os.totalmem(),
    node: process.version,
  },
  mode: values.target.startsWith(`${process.platform === "win32" ? "win" : process.platform}-`)
    ? "native"
    : "cross",
  revision: git(["rev-parse", "HEAD"]),
  dirty: Boolean(git(["status", "--porcelain"])),
  version: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version,
  cacheState: values["cache-state"],
  dependencyInstallIncluded: false,
  uploadIncluded: false,
  startedAt: started.toISOString(),
};
const command = portableCommand("npm", ["run", "build:desktop", "--", "--target", values.target]);
const fd = openSync(path.join(directory, "build.log"), "w");
const before = performance.now();
const result = spawnSync(command.command, command.args, {
  cwd: root,
  stdio: ["ignore", fd, fd],
  shell: false,
});
closeSync(fd);
Object.assign(metadata, {
  elapsedSeconds: (performance.now() - before) / 1000,
  exitCode: result.status,
  error: result.error?.message ?? null,
  finishedAt: new Date().toISOString(),
});
writeFileSync(path.join(directory, "result.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify({ directory, ...metadata }, null, 2));
process.exitCode = result.status ?? 1;
