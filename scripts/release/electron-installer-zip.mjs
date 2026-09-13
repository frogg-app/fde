import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createZip } from "./package-windows-zips.mjs";

// Browsers and SmartScreen flag directly downloaded .exe files, so people get the
// NSIS installer inside `Frogg-<v>-win-<arch>-installer.zip`. The bare installer stays
// beside it because electron-latest.yml points electron-updater at that exact file.
// Do not name this `-setup.zip`: Tauri 0.5.x clients update from that exact asset
// name and would run this installer as a same-path replacement.
export async function writeElectronInstallerZips(directory) {
  const installers = (await readdir(directory)).filter((name) =>
    /-win-(x64|arm64)\.exe$/.test(name),
  );
  const written = [];
  for (const name of installers) {
    const source = path.join(directory, name);
    const zipName = name.replace(/\.exe$/, "-installer.zip");
    const entry = { name, data: await readFile(source), mtime: (await stat(source)).mtime };
    await writeFile(path.join(directory, zipName), createZip([entry]));
    written.push(zipName);
  }
  return written;
}
