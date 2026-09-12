import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateAssets } from "./assets.mjs";
import { generateConfig } from "./config.mjs";
import { outputRoot, root, uiOutput, resolveBrand } from "./resolve.mjs";

export async function prepareBrand(directory?: string): Promise<ReturnType<typeof resolveBrand>> {
  const build = resolveBrand(directory);
  const lock = path.join(root, ".generated/branding.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    throw new Error(
      "Another brand preparation is active in this worktree. Use separate worktrees for concurrent brand builds.",
      { cause: error },
    );
  }
  try {
    const stamp = path.join(outputRoot, "fingerprint");
    const same = existsSync(stamp) && (await readFile(stamp, "utf8")).trim() === build.fingerprint;
    if (!same || !existsSync(path.join(uiOutput, "assets.ts"))) {
      await rm(outputRoot, { recursive: true, force: true });
      await rm(uiOutput, { recursive: true, force: true });
      await mkdir(outputRoot, { recursive: true });
      await generateAssets(build);
    }
    await generateConfig(build);
    await writeFile(stamp, build.fingerprint + "\n");
    return build;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
