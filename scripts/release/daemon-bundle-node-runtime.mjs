// Fetches an official Node.js runtime tarball from nodejs.org for a target
// platform, verifies it against the release's SHASUMS256.txt, and unpacks a
// trimmed copy (no npm/corepack/headers) into the bundle staging directory.
//
// Used by build-daemon-bundle.mjs. Downloads are cached under the bundle
// output directory so repeated builds do not re-fetch the same runtime.

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { run } from "./daemon-bundle-utils.mjs";

export const DEFAULT_NODE_VERSION = "22.23.2";
const NODE_DIST_BASE = process.env.FDE_NODE_DIST_BASE ?? "https://nodejs.org/dist";

// Parts of the official tarball the daemon never uses at runtime.
const TRIM_PATHS = [
  "include",
  "share",
  "lib/node_modules",
  "bin/npm",
  "bin/npx",
  "bin/corepack",
  "CHANGELOG.md",
  "README.md",
];

function nodeArchiveName(version, platform, arch) {
  return `node-v${version}-${platform}-${arch}.tar.gz`;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}): ${url}`);
  }
  const partial = `${destination}.part`;
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, destination);
}

async function expectedChecksum(cacheDir, version, archiveName) {
  const sumsPath = path.join(cacheDir, `SHASUMS256-v${version}.txt`);
  if (!existsSync(sumsPath)) {
    await download(`${NODE_DIST_BASE}/v${version}/SHASUMS256.txt`, sumsPath);
  }
  const sums = await readFile(sumsPath, "utf8");
  for (const line of sums.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === archiveName) {
      return hash;
    }
  }
  throw new Error(`${archiveName} is not listed in SHASUMS256.txt for Node v${version}`);
}

/**
 * Ensures the Node archive for the target is in the cache and verified.
 * Returns the archive path.
 */
export async function fetchNodeRuntime({ version, platform, arch, cacheDir }) {
  const archiveName = nodeArchiveName(version, platform, arch);
  const archivePath = path.join(cacheDir, archiveName);
  const expected = await expectedChecksum(cacheDir, version, archiveName);

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${archiveName}...`);
    await download(`${NODE_DIST_BASE}/v${version}/${archiveName}`, archivePath);
  }

  const actual = await sha256File(archivePath);
  if (actual !== expected) {
    await rm(archivePath, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${archiveName}: expected ${expected}, got ${actual} (cached file removed)`,
    );
  }
  console.log(`Verified ${archiveName} (sha256 ${expected.slice(0, 12)}...)`);
  return archivePath;
}

/** Unpacks the verified archive into `targetDir` and removes non-runtime files. */
export async function installNodeRuntime(archivePath, targetDir) {
  await mkdir(targetDir, { recursive: true });
  await run("tar", ["-xzf", archivePath, "--strip-components=1", "-C", targetDir]);
  for (const relativePath of TRIM_PATHS) {
    await rm(path.join(targetDir, relativePath), { recursive: true, force: true });
  }
  const nodeBinary = path.join(targetDir, "bin", "node");
  if (!existsSync(nodeBinary)) {
    throw new Error(`Node runtime unpack failed: ${nodeBinary} is missing`);
  }
}
