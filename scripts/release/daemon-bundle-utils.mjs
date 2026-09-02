// Small filesystem/process helpers shared by the daemon bundle build scripts.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

export function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      shell: false,
      ...options,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve(output);
    });
  });
}

/** Copies a directory tree, skipping files for which `exclude(relativePath)` is true. */
export async function copyTree(source, destination, exclude) {
  await cp(source, destination, {
    recursive: true,
    filter: (candidate) => !exclude(path.relative(source, candidate)),
  });
}

export async function directorySize(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/** Recursively finds directories named `node_modules` below `root`. */
export async function findNodeModulesDirs(root) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.name === "node_modules") {
        found.push(entryPath);
        await walkPackages(entryPath);
      } else {
        await walk(entryPath);
      }
    }
  }
  async function walkPackages(nodeModulesDir) {
    const entries = await readdir(nodeModulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const entryPath = path.join(nodeModulesDir, entry.name);
      if (entry.name.startsWith("@")) {
        await walkPackages(entryPath);
      } else {
        await walk(entryPath);
      }
    }
  }
  await walk(root);
  return found;
}
