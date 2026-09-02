#!/usr/bin/env node
// Packages the cross-compiled Windows binary as a portable zip next to the
// NSIS installer: FDE-<version>-x64-portable.zip containing
// FDE-<version>-portable/{FDE.exe,README.txt}. No dependencies: the zip is
// written with Node's zlib (deflate + crc32).

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");
// Default is the cargo-xwin cross-compile layout. A native Windows build (CI on
// windows-latest) writes to target/release instead; point at it with
// FDE_WINDOWS_RELEASE_DIR or `--release-dir <dir>`.
const WINDOWS_RELEASE_DIR = resolveReleaseDir(process.env.FDE_WINDOWS_RELEASE_DIR);

function resolveReleaseDir(override) {
  if (override) {
    return path.resolve(REPO_ROOT, override);
  }
  return path.join(REPO_ROOT, "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release");
}

export function buildReadme(version) {
  return [
    `FDE ${version} (portable, Windows x64)`,
    "",
    "This is the portable build: no installer, no registry entries, no shortcuts.",
    "Keep FDE.exe wherever you like and run it from there.",
    "",
    "Requirements",
    "  - Windows 10 or 11 (64-bit).",
    "  - Microsoft Edge WebView2 Runtime. It ships with Windows 11 and most",
    "    Windows 10 installs; if FDE reports it is missing, install it from",
    "    https://developer.microsoft.com/microsoft-edge/webview2/",
    "",
    "Settings and data",
    "  Settings, attachments and logs live under %APPDATA%\\app.frogg.fde and",
    "  %LOCALAPPDATA%\\app.frogg.fde, shared with the installed version if you",
    "  also use one. Delete those folders to reset the app.",
    "",
    "SmartScreen",
    "  The binary is not code-signed yet. On first launch Windows SmartScreen may",
    '  show "Windows protected your PC": click "More info", then "Run anyway".',
    "",
    "Source and releases: https://github.com/frogg-app/frogg-de",
    "",
  ].join("\r\n");
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

/**
 * Minimal zip writer: `entries` is `[{ name, data, mtime? }]`, names use `/`.
 * Every entry is deflated and flagged UTF-8. Returns the archive as a Buffer.
 */
export function createZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const { time, day } = dosDateTime(entry.mtime ?? new Date());

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by (MS-DOS)
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0x20, 38); // external attrs: FILE_ATTRIBUTE_ARCHIVE
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, buffer) => sum + buffer.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Lists `[{ name, size }]` from a zip's central directory (for tests and dry runs). */
export function listZip(buffer) {
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    entries.push({
      name: buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      size: buffer.readUInt32LE(cursor + 24),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function packagePortableWindows({
  version,
  releaseDir = WINDOWS_RELEASE_DIR,
  exePath = path.join(releaseDir, "fde.exe"),
  outputDir = path.join(releaseDir, "bundle/portable"),
} = {}) {
  const resolvedVersion =
    version ?? JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
  let exe;
  try {
    exe = readFileSync(exePath);
  } catch {
    throw new Error(`Windows binary not found at ${exePath}. Run the Tauri Windows build first.`);
  }
  const folder = `FDE-${resolvedVersion}-portable`;
  const mtime = statSync(exePath).mtime;
  const zip = createZip([
    { name: `${folder}/FDE.exe`, data: exe, mtime },
    { name: `${folder}/README.txt`, data: buildReadme(resolvedVersion), mtime },
  ]);
  mkdirSync(outputDir, { recursive: true });
  const zipPath = path.join(outputDir, `FDE-${resolvedVersion}-x64-portable.zip`);
  writeFileSync(zipPath, zip);
  return { zipPath, byteSize: zip.length, exeByteSize: exe.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flagIndex = process.argv.indexOf("--release-dir");
    const releaseDir =
      flagIndex === -1 ? WINDOWS_RELEASE_DIR : resolveReleaseDir(process.argv[flagIndex + 1]);
    const result = packagePortableWindows({ releaseDir });
    console.log(`Wrote ${result.zipPath} (${(result.byteSize / 1024 / 1024).toFixed(1)} MB)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
