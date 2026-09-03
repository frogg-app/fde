import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  bundleAssetName,
  ChecksumMismatchError,
  detectBundleTarget,
  downloadFile,
  parseChecksumSidecar,
  verifyBundleChecksum,
} from "./bundle.js";

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fde-self-update-bundle-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bundle naming", () => {
  test("matches the installer's asset names per platform", () => {
    expect(bundleAssetName("0.1.14", { platform: "linux", arch: "x64" })).toBe(
      "fde-daemon-0.1.14-linux-x64.tar.gz",
    );
    expect(bundleAssetName("0.1.14", { platform: "win", arch: "arm64" })).toBe(
      "fde-daemon-0.1.14-win-arm64.zip",
    );
    expect(detectBundleTarget("darwin", "arm64")).toEqual({ platform: "darwin", arch: "arm64" });
    expect(detectBundleTarget("win32", "x64")).toEqual({ platform: "win", arch: "x64" });
    expect(() => detectBundleTarget("freebsd", "x64")).toThrow(/unsupported operating system/);
  });
});

describe("checksum verification", () => {
  test("accepts the sidecar formats sha256sum and the release pipeline write", async () => {
    const dir = makeDir();
    const archive = path.join(dir, "bundle.tar.gz");
    writeFileSync(archive, "not really a tarball");
    const digest = createHash("sha256").update("not really a tarball").digest("hex");
    const sidecar = path.join(dir, "bundle.tar.gz.sha256");
    writeFileSync(sidecar, `${digest}  bundle.tar.gz\n`);
    await expect(verifyBundleChecksum(archive, sidecar)).resolves.toBe(digest);
    expect(parseChecksumSidecar(digest.toUpperCase())).toBe(digest);
    expect(() => parseChecksumSidecar("garbage")).toThrow(/sha256/);
  });

  test("rejects a tampered archive with both digests in the error", async () => {
    const dir = makeDir();
    const archive = path.join(dir, "bundle.tar.gz");
    writeFileSync(archive, "tampered");
    const expected = "a".repeat(64);
    const sidecar = path.join(dir, "bundle.tar.gz.sha256");
    writeFileSync(sidecar, expected);
    const failure = await verifyBundleChecksum(archive, sidecar).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChecksumMismatchError);
    expect((failure as ChecksumMismatchError).expected).toBe(expected);
    expect((failure as ChecksumMismatchError).actual).toHaveLength(64);
  });
});

describe("downloadFile", () => {
  test("streams the body to disk, reports progress, and fails on HTTP errors", async () => {
    const dir = makeDir();
    const destination = path.join(dir, "nested", "asset.bin");
    const body = Buffer.alloc(3000, 7);
    const fetchImpl = (async () =>
      new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length) },
      })) as unknown as typeof fetch;
    const progress: Array<[number, number | null]> = [];
    await downloadFile({
      url: "http://example/asset.bin",
      destination,
      fetchImpl,
      onProgress: (received, total) => progress.push([received, total]),
    });
    expect(readFileSync(destination)).toEqual(body);
    expect(progress.at(-1)).toEqual([3000, 3000]);

    const failing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(
      downloadFile({ url: "http://example/missing", destination, fetchImpl: failing }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
