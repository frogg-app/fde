import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const artifactExtension = /\.(exe|zip|dmg|AppImage|deb|tar\.gz)$/;
export async function writeElectronChecksums(directory) {
  const artifacts = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && artifactExtension.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (artifacts.length === 0) throw new Error(`No Electron artifacts found in ${directory}`);
  const lines = [];
  for (const name of artifacts) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(directory, name))) hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${name}`);
  }
  await writeFile(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
}
