import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Daemon bundle acquisition: the asset naming, checksum sidecar, and archive
 * layout are the ones scripts/release/build-daemon-bundle.mjs produces and
 * deploy/install.sh consumes (`fde-daemon-<v>-<platform>-<arch>.tar.gz`, a
 * `.sha256` sidecar whose first token is the digest, one top-level directory).
 */
export type BundlePlatform = "linux" | "darwin" | "win";
export type BundleArch = "x64" | "arm64";

export interface BundleTarget {
  platform: BundlePlatform;
  arch: BundleArch;
}

export interface BundleManifest {
  version: string;
  platform: string;
  arch: string;
}

const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export function detectBundleTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): BundleTarget {
  const platforms: Partial<Record<NodeJS.Platform, BundlePlatform>> = {
    linux: "linux",
    darwin: "darwin",
    win32: "win",
  };
  const arches: Record<string, BundleArch | undefined> = { x64: "x64", arm64: "arm64" };
  const bundlePlatform = platforms[platform];
  const bundleArch = arches[arch];
  if (!bundlePlatform) throw new Error(`unsupported operating system: ${platform}`);
  if (!bundleArch) throw new Error(`unsupported architecture: ${arch}`);
  return { platform: bundlePlatform, arch: bundleArch };
}

export function bundleAssetName(version: string, target: BundleTarget): string {
  const extension = target.platform === "win" ? "zip" : "tar.gz";
  return `fde-daemon-${version}-${target.platform}-${target.arch}.${extension}`;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/** First whitespace-separated token of the sidecar (`<hex>  <name>` or bare). */
export function parseChecksumSidecar(content: string): string {
  const token = content.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    throw new Error("checksum sidecar does not contain a sha256 digest");
  }
  return token.toLowerCase();
}

export class ChecksumMismatchError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`checksum mismatch for ${path.basename(filePath)} (expected ${expected}, got ${actual})`);
    this.name = "ChecksumMismatchError";
  }
}

export async function verifyBundleChecksum(
  archivePath: string,
  sidecarPath: string,
): Promise<string> {
  const expected = parseChecksumSidecar(readFileSync(sidecarPath, "utf8"));
  const actual = await sha256File(archivePath);
  if (actual !== expected) throw new ChecksumMismatchError(archivePath, expected, actual);
  return actual;
}

export interface DownloadOptions {
  url: string;
  destination: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

export async function downloadFile(options: DownloadOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetchImpl(options.url, {
      headers: options.headers,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      throw new Error(`download failed: HTTP ${response.status} for ${options.url}`);
    }
    const lengthHeader = response.headers.get("content-length");
    const total = lengthHeader ? Number(lengthHeader) : null;
    let received = 0;
    await mkdir(path.dirname(options.destination), { recursive: true });
    const partial = `${options.destination}.part`;
    const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
    source.on("data", (chunk: Buffer) => {
      received += chunk.length;
      options.onProgress?.(received, total);
    });
    await pipeline(source, createWriteStream(partial));
    await rename(partial, options.destination);
  } finally {
    clearTimeout(timer);
  }
}

export function readBundleManifest(versionRoot: string): BundleManifest {
  const manifestPath = path.join(versionRoot, "manifest.json");
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<BundleManifest>;
  if (
    typeof parsed.version !== "string" ||
    typeof parsed.platform !== "string" ||
    typeof parsed.arch !== "string"
  ) {
    throw new Error(`invalid bundle manifest at ${manifestPath}`);
  }
  return { version: parsed.version, platform: parsed.platform, arch: parsed.arch };
}

export function bundleLauncherPath(versionRoot: string, platform: BundlePlatform): string {
  return path.join(versionRoot, "bin", platform === "win" ? "fde.cmd" : "fde");
}

function runOrThrow(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}: ${result.stderr.trim()}`,
    );
  }
}

/**
 * Unpacks the archive's single top-level directory into `destination`
 * (created empty). tar on unix; PowerShell's Expand-Archive on Windows, since
 * the zip carries no symlinks and node ships no zip reader.
 */
export async function extractBundle(
  archivePath: string,
  destination: string,
  platform: BundlePlatform,
): Promise<void> {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  if (platform === "win") {
    const scratch = `${destination}.unzip`;
    await rm(scratch, { recursive: true, force: true });
    runOrThrow("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${scratch.replace(/'/g, "''")}' -Force`,
    ]);
    const entries = readdirSync(scratch);
    const top = entries.length === 1 ? path.join(scratch, entries[0] as string) : scratch;
    for (const entry of readdirSync(top)) {
      await rename(path.join(top, entry), path.join(destination, entry));
    }
    await rm(scratch, { recursive: true, force: true });
  } else {
    runOrThrow("tar", ["-xzf", archivePath, "--strip-components=1", "-C", destination]);
  }
  if (!existsSync(bundleLauncherPath(destination, platform))) {
    throw new Error("bundle is missing bin/fde");
  }
  readBundleManifest(destination);
}
