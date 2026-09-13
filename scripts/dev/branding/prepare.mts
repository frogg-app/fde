import { generateDeployment } from "./deployment.mjs";
import { generateSkills } from "./skills.mjs";
import { generateInstallers } from "./installers.mjs";
import { generateWindowsInstaller } from "./windows-installer.mjs";
import { execFileSync } from "node:child_process";
import { acquireLock, assertBuildAvailable } from "./locks.mjs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateAssets } from "./assets.mjs";
import { generateConfig } from "./config.mjs";
import { outputRoot, root, uiOutput, resolveBrand } from "./resolve.mjs";

export async function prepareBrand(directory?: string): Promise<ReturnType<typeof resolveBrand>> {
  const build = resolveBrand(directory);
  await assertBuildAvailable(build);
  const release = await acquireLock("prepare", build);
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
    await generateInstallers(build);
    await generateWindowsInstaller(build);
    await generateSkills(build);
    await generateDeployment(build);
    if (!same || !existsSync(path.join(root, "packages/branding/dist/runtime.js"))) {
      execFileSync(
        process.execPath,
        [
          path.join(root, "node_modules/typescript/bin/tsc"),
          "-p",
          path.join(root, "packages/branding/tsconfig.json"),
        ],
        { cwd: root, stdio: "inherit" },
      );
    }
    if (!same) await writeFile(stamp, build.fingerprint + "\n");
    return build;
  } finally {
    await release();
  }
}
