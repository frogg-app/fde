import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveBrand, root } from "./resolve.mjs";

/** Explicit self-contained input for Docker contexts and Nix source derivations. */
export async function stageBrand(directory?: string): Promise<string> {
  const build = resolveBrand(directory);
  if (build.brand.legacyFrogg) return "brands/frogg";
  const relative = `.branding-input/${build.brand.id}`;
  const target = path.join(root, relative);
  if (build.selected === target) return relative;
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const assets: Record<string, string> = {};
  for (const [key, file] of Object.entries(build.assetFiles)) {
    const name = `${key}${path.extname(file)}`;
    await copyFile(file, path.join(target, name));
    assets[key] = `./${name}`;
  }
  await writeFile(
    path.join(target, "brand.json"),
    JSON.stringify({ ...build.manifest, assets }, null, 2) + "\n",
  );
  return relative;
}
