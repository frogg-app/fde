import { execFileSync } from "node:child_process";
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { root, outputRoot, type BrandBuild } from "./resolve.mjs";
import { stageBrand } from "./stage.mjs";

/** Disposable source export for tools that require a fixed project-local config filename. */
export async function exportMobileProject(build: BrandBuild, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length)
    throw new Error(`Mobile export directory must be empty: ${destination}`);
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    const source = path.join(root, file);
    if (!(await lstat(source).catch(() => null))) continue;
    const target = path.join(destination, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { verbatimSymlinks: true });
  }
  const brandInput = await stageBrand(build.selected);
  if (!build.brand.legacyFrogg)
    await cp(path.join(root, brandInput), path.join(destination, brandInput), { recursive: true });
  const eas = JSON.parse(await readFile(path.join(outputRoot, "eas.json"), "utf8"));
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  for (const profile of Object.values(eas.build) as Array<{ env?: Record<string, string> }>) {
    profile.env = { ...profile.env, FROGG_BRAND_DIR: brandInput, FROGG_SOURCE_REVISION: revision };
  }
  await writeFile(path.join(destination, "apps/ui/eas.json"), JSON.stringify(eas, null, 2) + "\n");
  await writeFile(
    path.join(destination, ".easignore"),
    ".git\n**/node_modules\n**/.generated\n**/dist\n**/target\n**/.env\n**/.env.local\n**/.secrets\n**/*.pem\n",
  );
  // Local configuration evaluation needs the build tools. EAS excludes node_modules
  // and installs its own complete workspace tree on the build runner.
  await symlink(
    path.join(root, "node_modules"),
    path.join(destination, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await copyFile(
    path.join(outputRoot, "provenance.json"),
    path.join(destination, "brand-provenance.json"),
  );
}
