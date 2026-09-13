import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { buildElectronReleaseManifests } from "./electron-release-manifests.mjs";

test("Electron manifests require every platform and carry real hashes for both Mac architectures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fde-update-manifest-"));
  const out = path.join(dir, "metadata");
  try {
    await assert.rejects(
      buildElectronReleaseManifests({ version: "0.6.0", assets: dir, out }),
      /Expected/,
    );
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"]) {
      await writeFile(path.join(dir, `FDE-0.6.0-${suffix}`), suffix);
    }
    await buildElectronReleaseManifests({ version: "0.6.0", assets: dir, out });
    const manifest = JSON.parse(await readFile(path.join(out, "electron-latest-mac.yml"), "utf8"));
    assert.equal(manifest.version, "0.6.0");
    const linux = JSON.parse(await readFile(path.join(out, "electron-latest-linux.yml"), "utf8"));
    assert.equal(linux.path, "FDE-0.6.0-linux-x86_64.AppImage");
    assert.equal(linux.files[0].url, linux.path);
    assert.equal(manifest.files.length, 2);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(dir, file.url));
      assert.equal(file.sha512, createHash("sha512").update(bytes).digest("base64"));
      assert.equal(file.size, bytes.length);
    }
    assert.match(
      await readFile(path.join(out, "SHA256SUMS-desktop"), "utf8"),
      /FDE-0.6.0-win-x64.exe/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
