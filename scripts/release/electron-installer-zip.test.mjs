import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeElectronInstallerZips } from "./electron-installer-zip.mjs";
import { listZip } from "./package-windows-zips.mjs";

test("zips the Windows installer beside the bare exe electron-updater needs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "electron-installer-zip-"));
  try {
    await writeFile(path.join(root, "FDE-0.6.11-win-x64.exe"), "MZ installer");
    await writeFile(path.join(root, "FDE-0.6.11-win-x64.zip"), "portable");
    assert.deepEqual(await writeElectronInstallerZips(root), ["FDE-0.6.11-win-x64-installer.zip"]);
    const names = await readdir(root);
    assert.ok(names.includes("FDE-0.6.11-win-x64.exe"));
    assert.ok(!names.some((name) => name.endsWith("-setup.zip") || name.endsWith("-portable.zip")));
    const entries = listZip(await readFile(path.join(root, "FDE-0.6.11-win-x64-installer.zip")));
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ["FDE-0.6.11-win-x64.exe"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
