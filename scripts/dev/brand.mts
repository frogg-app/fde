import { stageBrand } from "./branding/stage.mjs";
import { parseArgs } from "node:util";
import { mkdir, copyFile, writeFile, mkdtemp, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BrandManifestSchema } from "../../packages/branding/src/schema.js";
import { validateAssets } from "./branding/assets.mjs";
import { prepareBrand } from "./branding/prepare.mjs";
import { root, resolveBrand } from "./branding/resolve.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string" },
    dir: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    "app-id": { type: "string" },
    port: { type: "string" },
    icon: { type: "string" },
    json: { type: "boolean" },
  },
});
const command = positionals[0];
if (command === "init") {
  if (!values.dir || !values.icon)
    throw new Error("brand:init requires --dir, --id, --name, --app-id, --port and --icon");
  const filename = `icon${path.extname(values.icon)}`;
  const manifest = BrandManifestSchema.parse({
    schemaVersion: 1,
    id: values.id,
    name: values.name,
    applicationId: values["app-id"],
    daemonPort: Number(values.port),
    assets: { icon: `./${filename}` },
  });
  const destination = path.resolve(values.dir);
  if (await lstat(destination).catch(() => null)) {
    throw new Error(`Brand destination already exists: ${destination}. Choose a new directory.`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), ".brand-init-"));
  try {
    await copyFile(path.resolve(values.icon), path.join(staging, filename));
    await writeFile(path.join(staging, "brand.json"), JSON.stringify(manifest, null, 2) + "\n");
    await validateAssets(resolveBrand(staging));
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  process.stdout.write(
    `Brand created at ${destination}. Build with FROGG_BRAND_DIR=${destination}\n`,
  );
} else if (command === "check") {
  const build = resolveBrand(values.brand);
  await validateAssets(build);
  process.stdout.write(
    values.json
      ? JSON.stringify(build.brand, null, 2) + "\n"
      : `${build.brand.name}: valid (${build.brand.applicationId}); updates ${build.brand.distribution.updateMode}\n`,
  );
} else if (command === "prepare") {
  const build = await prepareBrand(values.brand);
  process.stdout.write(`Brand prepared: ${build.brand.name} (${build.fingerprint.slice(0, 12)})\n`);
} else if (command === "stage") {
  process.stdout.write((await stageBrand(values.brand)) + "\n");
} else if (command === "schema") {
  await writeFile(
    path.join(root, "packages/branding/brand.schema.json"),
    JSON.stringify(z.toJSONSchema(BrandManifestSchema), null, 2) + "\n",
  );
} else {
  throw new Error("Usage: brand.ts init|check|prepare|schema [--brand <directory>]");
}
