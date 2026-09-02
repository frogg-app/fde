// Zip archive helpers for the Windows daemon bundle. Windows has no tar
// tradition and the desktop app extracts the bundle itself, so the Windows
// artifact is a plain .zip. The Node runtime for Windows also ships as a zip.
//
// Uses fflate (pure JS, synchronous) so the build works on any runner without
// `zip`/`unzip` binaries. Bundles are a couple of hundred MB unpacked, which is
// fine to hold in memory on a build machine.

import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { unzipSync, zipSync } from "fflate";

/**
 * Extracts `archivePath` into `targetDir`, dropping the first path component
 * of every entry (the same effect as `tar --strip-components=1`).
 */
export async function extractZipStripped(archivePath, targetDir) {
  const entries = unzipSync(new Uint8Array(await readFile(archivePath)));
  await mkdir(targetDir, { recursive: true });
  for (const [name, data] of Object.entries(entries)) {
    const parts = name.split("/").filter(Boolean);
    if (parts.length < 2 || parts.includes("..")) continue;
    const relativePath = parts.slice(1).join("/");
    const destination = path.join(targetDir, relativePath);
    if (name.endsWith("/")) {
      await mkdir(destination, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, data);
  }
}

/** Returns every symlink below `root` (relative paths); empty when there are none. */
export async function findSymlinks(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        found.push(path.relative(root, entryPath));
      } else if (entry.isDirectory()) {
        await walk(entryPath);
      }
    }
  }
  await walk(root);
  return found;
}

/**
 * Writes `archivePath` containing `sourceDir` under the top-level directory
 * name `rootName` (so unpacking yields `rootName/...`, like the tarballs).
 * Refuses symlinks: a zip cannot carry them portably and Windows would not
 * resolve them anyway.
 */
export async function createZipFromDirectory(sourceDir, rootName, archivePath) {
  const symlinks = await findSymlinks(sourceDir);
  if (symlinks.length > 0) {
    throw new Error(
      `Refusing to zip ${sourceDir}: symlinks are not allowed in the Windows bundle:\n  ${symlinks
        .slice(0, 10)
        .join("\n  ")}${symlinks.length > 10 ? `\n  ... (${symlinks.length} total)` : ""}`,
    );
  }
  const files = {};
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile()) {
        const zipPath = `${rootName}/${path.relative(sourceDir, entryPath).split(path.sep).join("/")}`;
        const info = await lstat(entryPath);
        files[zipPath] = [
          new Uint8Array(await readFile(entryPath)),
          { mtime: info.mtime, level: 6 },
        ];
      }
    }
  }
  await walk(sourceDir);
  if (!existsSync(path.dirname(archivePath))) {
    await mkdir(path.dirname(archivePath), { recursive: true });
  }
  await writeFile(archivePath, zipSync(files));
}
