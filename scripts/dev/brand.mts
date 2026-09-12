import { parseArgs } from "node:util";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "brand.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  await copyFile(path.resolve(values.icon), path.join(destination, filename));
  process.stdout.write(
    `Brand created at ${destination}. Build with FDE_BRAND_DIR=${destination}\n`,
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
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      path.join(root, "packages/branding/tsconfig.json"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  process.stdout.write(`Brand prepared: ${build.brand.name} (${build.fingerprint.slice(0, 12)})\n`);
} else if (command === "schema") {
  await writeFile(
    path.join(root, "packages/branding/brand.schema.json"),
    JSON.stringify(z.toJSONSchema(BrandManifestSchema), null, 2) + "\n",
  );
} else {
  throw new Error("Usage: brand.ts init|check|prepare|schema [--brand <directory>]");
}
