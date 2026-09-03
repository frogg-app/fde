import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  buildReadme,
  createZip,
  listZip,
  packagePortableWindows,
  packageWindowsInstallerZip,
} from "./package-windows-zips.mjs";

test("createZip writes entries that inflate back to their contents", () => {
  const zip = createZip([
    { name: "dir/a.txt", data: "hello", mtime: new Date(2026, 0, 2, 3, 4, 6) },
    { name: "dir/b.bin", data: Buffer.from([0, 1, 2, 3]), mtime: new Date(2026, 0, 2) },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(listZip(zip), [
    { name: "dir/a.txt", size: 5 },
    { name: "dir/b.bin", size: 4 },
  ]);
  // Inflate the first local entry by hand.
  const nameLength = zip.readUInt16LE(26);
  const compressedSize = zip.readUInt32LE(18);
  const start = 30 + nameLength;
  assert.equal(inflateRawSync(zip.subarray(start, start + compressedSize)).toString(), "hello");
});

test("packagePortableWindows lays out the portable folder and README", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fde-portable-"));
  const exePath = path.join(dir, "fde.exe");
  writeFileSync(exePath, Buffer.alloc(1024, 7));
  const result = packagePortableWindows({
    version: "1.2.3",
    exePath,
    outputDir: path.join(dir, "out"),
  });
  assert.equal(path.basename(result.zipPath), "FDE-1.2.3-x64-portable.zip");
  assert.equal(result.exeByteSize, 1024);
  const entries = listZip(readFileSync(result.zipPath));
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["FDE-1.2.3-portable/FDE.exe", "FDE-1.2.3-portable/README.txt"],
  );
  assert.equal(entries[1].size, Buffer.byteLength(buildReadme("1.2.3")));
  assert.match(buildReadme("1.2.3"), /WebView2/);
  assert.match(buildReadme("1.2.3"), /%APPDATA%\\app\.frogg\.fde/);
  assert.match(buildReadme("1.2.3"), /SmartScreen/);
});

test("packagePortableWindows fails clearly without a binary", () => {
  assert.throws(
    () =>
      packagePortableWindows({
        version: "0.0.0",
        exePath: "/nonexistent/fde.exe",
        outputDir: tmpdir(),
      }),
    /Windows binary not found/,
  );
});

test("packageWindowsInstallerZip wraps the NSIS installer under its release name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fde-setup-"));
  const nsisDir = path.join(dir, "bundle/nsis");
  mkdirSync(nsisDir, { recursive: true });
  writeFileSync(path.join(nsisDir, "FDE_1.2.3_x64-setup.exe"), Buffer.alloc(2048, 9));
  const result = packageWindowsInstallerZip({
    version: "1.2.3",
    nsisDir,
    outputDir: path.join(dir, "out"),
  });
  assert.equal(path.basename(result.zipPath), "FDE-1.2.3-x64-setup.zip");
  assert.equal(result.installerByteSize, 2048);
  assert.deepEqual(listZip(readFileSync(result.zipPath)), [
    { name: "FDE-1.2.3-x64-setup.exe", size: 2048 },
  ]);
});

test("packageWindowsInstallerZip fails clearly on no or several installers", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "fde-setup-"));
  const nsisDir = path.join(dir, "bundle/nsis");
  assert.throws(
    () => packageWindowsInstallerZip({ version: "1.2.3", nsisDir, outputDir: dir }),
    /No NSIS installer found/,
  );
  mkdirSync(nsisDir, { recursive: true });
  writeFileSync(path.join(nsisDir, "FDE_1.2.3_x64-setup.exe"), "a");
  writeFileSync(path.join(nsisDir, "FDE_1.2.4_x64-setup.exe"), "b");
  assert.throws(
    () => packageWindowsInstallerZip({ version: "1.2.3", nsisDir, outputDir: dir }),
    /Several NSIS installers/,
  );
});
