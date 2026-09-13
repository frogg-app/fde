import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  SUPPORTED_TARGETS,
  WINDOWS_LAUNCHER,
  daemonAssetName,
  parseTarget,
} from "./build-daemon-bundle.mjs";
import { nodeArchiveName, nodeBinaryPath } from "./daemon-bundle-node-runtime.mjs";
import { createZipFromDirectory, extractZipStripped, findSymlinks } from "./daemon-bundle-zip.mjs";

test("parseTarget maps bundle names to npm and node-pty names", () => {
  assert.deepEqual(parseTarget("win-x64"), {
    platform: "win",
    arch: "x64",
    npmPlatform: "win32",
    isWindows: true,
  });
  assert.deepEqual(parseTarget("linux-arm64"), {
    platform: "linux",
    arch: "arm64",
    npmPlatform: "linux",
    isWindows: false,
  });
  assert.throws(() => parseTarget("freebsd-x64"), /Unsupported target/);
  assert.ok(SUPPORTED_TARGETS.includes("win-arm64"));
});

test("node runtime names follow nodejs.org", () => {
  assert.equal(nodeArchiveName("22.23.2", "win", "x64"), "node-v22.23.2-win-x64.zip");
  assert.equal(nodeArchiveName("22.23.2", "darwin", "arm64"), "node-v22.23.2-darwin-arm64.tar.gz");
  assert.equal(nodeBinaryPath("/r", "win"), path.join("/r", "node.exe"));
  assert.equal(nodeBinaryPath("/r", "linux"), path.join("/r", "bin", "node"));
});

test("daemon assets use platform-first public names", () => {
  assert.equal(daemonAssetName("1.2.3", "linux", "arm64"), "Frogg-1.2.3-linux-arm64-daemon.tar.gz");
  assert.equal(daemonAssetName("1.2.3", "darwin", "x64"), "Frogg-1.2.3-mac-x86_64-daemon.tar.gz");
  assert.equal(daemonAssetName("1.2.3", "win", "x64"), "Frogg-1.2.3-win-x64-daemon.zip");
});

test("Windows launcher keeps the CLI launch contract", () => {
  const lines = WINDOWS_LAUNCHER.split("\r\n");
  assert.equal(lines[0], "@echo off");
  assert.ok(lines.includes('if not defined FROGG_NODE_ENV set "FROGG_NODE_ENV=production"'));
  const exec = lines.find((line) => line.includes("node.exe"));
  assert.ok(exec, "launcher runs node.exe");
  assert.match(exec, /--disable-warning=DEP0040/);
  assert.match(exec, /\\daemon\\apps\\cli\\dist\\index\.js" %\*$/);
  assert.ok(!WINDOWS_LAUNCHER.includes("\n\n"), "CRLF line endings only");
});

test("zip helpers round-trip a tree and refuse symlinks", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-zip-test-"));
  try {
    const source = path.join(dir, "bundle");
    await mkdir(path.join(source, "bin"), { recursive: true });
    await writeFile(path.join(source, "manifest.json"), "{}");
    await writeFile(path.join(source, "bin", "frogg.cmd"), "@echo off\r\n");

    const archive = path.join(dir, "out", "bundle.zip");
    await createZipFromDirectory(source, "frogg-daemon-1-win-x64", archive);
    const extracted = path.join(dir, "extracted");
    await extractZipStripped(archive, extracted);
    assert.equal(await readFile(path.join(extracted, "manifest.json"), "utf8"), "{}");
    assert.equal(await readFile(path.join(extracted, "bin", "frogg.cmd"), "utf8"), "@echo off\r\n");

    await symlink("manifest.json", path.join(source, "link.json"));
    assert.deepEqual(await findSymlinks(source), ["link.json"]);
    await assert.rejects(
      createZipFromDirectory(source, "x", path.join(dir, "out", "bad.zip")),
      /symlinks are not allowed/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("daemon archives preserve their internal layout and publish owned legacy aliases", async () => {
  const { packBundle } = await import("./build-daemon-bundle.mjs");
  const { loadBrand } = await import("../dev/branding/load.cjs");
  const { readdir } = await import("node:fs/promises");
  const brand = loadBrand();
  const dir = await mkdtemp(path.join(os.tmpdir(), "brand-daemon-alias-"));
  try {
    const bundleName = `${brand.daemonArtifactPrefix}-1.2.3-linux-x64`;
    const stagingDir = path.join(dir, "staging", bundleName);
    const outDir = path.join(dir, "out");
    await mkdir(stagingDir, { recursive: true });
    await mkdir(outDir);
    await writeFile(path.join(stagingDir, "manifest.json"), JSON.stringify({ version: "1.2.3" }));
    const archiveName = daemonAssetName("1.2.3", "linux", "x64");
    await packBundle({ stagingDir, bundleName, archiveName, outDir, isWindows: false });
    const canonical = await readFile(path.join(outDir, archiveName));
    if (brand.legacyFrogg) {
      const legacy = `${bundleName}.tar.gz`;
      assert.deepEqual(await readFile(path.join(outDir, legacy)), canonical);
      const checksum = await readFile(path.join(outDir, `${legacy}.sha256`), "utf8");
      assert.ok(checksum.endsWith(`  ${legacy}\n`));
    } else {
      assert.equal((await readdir(outDir)).filter((name) => name.endsWith(".tar.gz")).length, 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
