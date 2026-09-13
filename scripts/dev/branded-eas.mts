import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareBrand } from "./branding/prepare.mjs";
import { exportMobileProject } from "./branding/export.mjs";
import { acquireLock } from "./branding/locks.mjs";
import { resolveBrand } from "./branding/resolve.mjs";

const build = resolveBrand();
const release = await acquireLock("build", build);
try {
  process.env.FROGG_BRAND_BUILD_OWNER ||= String(process.pid);
  await prepareBrand(build.selected);
  const destination = await mkdtemp(path.join(os.tmpdir(), `${build.brand.id}-mobile-`));
  await exportMobileProject(build, destination);
  process.stdout.write(`Mobile source and EAS configuration exported to ${destination}\n`);
  const args = process.argv.slice(2);
  if (!args.includes("--prepare-only")) {
    if (!args.length)
      throw new Error("Usage: npm run brand:eas -- <eas arguments> | --prepare-only");
    const cli = createRequire(import.meta.url).resolve("eas-cli/bin/run");
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: path.join(destination, "apps/ui"),
      stdio: "inherit",
      env: {
        ...process.env,
        FROGG_BRAND_DIR: build.brand.legacyFrogg
          ? "brands/frogg"
          : `.branding-input/${build.brand.id}`,
        FROGG_BRAND_BUILD_OWNER: "",
        EAS_NO_VCS: "1",
        EAS_PROJECT_ROOT: destination,
      },
    });
    process.exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  }
} finally {
  await release();
}
