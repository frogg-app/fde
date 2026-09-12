import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export async function buildElectronReleaseManifests({ version, assets, out }) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error("Invalid release version");
  const names = (await readdir(assets)).sort();
  const groups = {
    "": names.filter((name) => name.endsWith(`-${version}-win-x64.exe`)),
    "-linux": names.filter((name) => name.endsWith(`-${version}-linux-x64.AppImage`)),
    "-mac": names.filter((name) =>
      new RegExp(`-${version.replaceAll(".", "\\.")}-mac-(x64|arm64)\\.zip$`).test(name),
    ),
  };
  for (const [platform, files] of Object.entries(groups)) {
    const expected = platform === "-mac" ? 2 : 1;
    if (files.length !== expected)
      throw new Error(
        `Expected ${expected} Electron update assets for ${platform || "Windows"}, found ${files.length}`,
      );
  }
  await mkdir(out, { recursive: true });
  const channel = version.includes("-") ? "electron-beta" : "electron-latest";
  const releaseDate = new Date().toISOString();
  for (const [platform, groupNames] of Object.entries(groups)) {
    const files = [];
    for (const url of groupNames) {
      const file = path.join(assets, url);
      const hash = createHash("sha512");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      files.push({ url, sha512: hash.digest("base64"), size: (await stat(file)).size });
    }
    // JSON is valid YAML; the generic Electron provider reads these channel files.
    const manifest = { version, files, path: files[0].url, sha512: files[0].sha512, releaseDate };
    await writeFile(
      path.join(out, `${channel}${platform}.yml`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }
  const sums = [];
  for (const name of names) {
    const file = path.join(assets, name);
    if (!(await stat(file)).isFile()) continue;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    sums.push(`${hash.digest("hex")}  ${name}`);
  }
  await writeFile(path.join(out, "SHA256SUMS-desktop"), `${sums.join("\n")}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { version: { type: "string" }, assets: { type: "string" }, out: { type: "string" } },
  });
  if (!values.version || !values.assets || !values.out)
    throw new Error("Required: --version --assets --out");
  await buildElectronReleaseManifests(values);
}
