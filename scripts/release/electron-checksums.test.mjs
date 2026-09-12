import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { writeElectronChecksums } from "./electron-checksums.mjs";

test("checksum manifest hashes artifacts and excludes unpacked directories and build metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "electron-checksums-"));
  try {
    await writeFile(path.join(root, "FDE-Electron-win.zip"), "abc");
    await writeFile(path.join(root, "builder-debug.yml"), "not an artifact");
    await mkdir(path.join(root, "linux-unpacked"));
    await writeElectronChecksums(root);
    assert.equal(
      await readFile(path.join(root, "SHA256SUMS"), "utf8"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  FDE-Electron-win.zip\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty output cannot generate a successful artifact manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "electron-checksums-"));
  try {
    await assert.rejects(writeElectronChecksums(root), /No Electron artifacts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
