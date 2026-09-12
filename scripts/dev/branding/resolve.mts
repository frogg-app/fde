import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrandManifestSchema,
  resolveBrandManifest,
} from "../../../packages/branding/src/schema.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const outputRoot = path.join(root, ".generated/branding");
export const uiOutput = path.join(root, "apps/ui/.generated/branding");

export function resolveBrand(directory?: string) {
  const selected = path.resolve(root, directory ?? process.env.FDE_BRAND_DIR ?? "brands/fde");
  const manifest = BrandManifestSchema.parse(
    JSON.parse(readFileSync(path.join(selected, "brand.json"), "utf8")),
  );
  const official = realpathSync(selected) === realpathSync(path.join(root, "brands/fde"));
  const brand = resolveBrandManifest(manifest);
  if (
    !official &&
    (brand.id === "fde" ||
      brand.id === "paseo" ||
      [brand.cliName, brand.desktopBinaryName, brand.scheme].some((name) =>
        ["fde", "paseo"].includes(name),
      ) ||
      [".fde", ".paseo"].includes(brand.homeDir) ||
      ["FDE", "PASEO"].includes(brand.envPrefix) ||
      brand.applicationId.startsWith("app.frogg.") ||
      ["fde-daemon", "paseo"].includes(brand.serviceName) ||
      ["app.frogg.fde", "sh.paseo.daemon"].includes(brand.launchdLabel))
  ) {
    throw new Error(
      "Custom brands must use independent identities; FDE/Paseo identities are reserved",
    );
  }
  const hash = createHash("sha256");
  hash.update("fde-brand-generator-v1\0");
  hash.update(JSON.stringify({ ...manifest, assets: Object.keys(manifest.assets).sort() }));
  const assetFiles: Record<string, string> = {};
  for (const [key, value] of Object.entries(manifest.assets)) {
    const file = path.resolve(selected, value);
    assetFiles[key] = file;
    hash.update(key).update(readFileSync(file));
  }
  for (const file of readdirSync(path.dirname(fileURLToPath(import.meta.url)))
    .filter((name) => name.endsWith(".mts"))
    .sort()) {
    hash.update(readFileSync(new URL(file, import.meta.url)));
  }
  function hashTree(treeDirectory: string): void {
    for (const entry of readdirSync(path.join(root, treeDirectory), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === "generated") continue;
      const file = path.join(treeDirectory, entry.name);
      hash.update(file);
      if (entry.isDirectory()) hashTree(file);
      else if (entry.isFile()) hash.update(readFileSync(path.join(root, file)));
    }
  }
  hashTree("packages/branding/src");
  hashTree("skills");
  const version: string = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  hash.update(version);
  for (const file of [
    "install.sh",
    "uninstall.sh",
    "install-docker.sh",
    "uninstall-docker.sh",
    "probe.sh.in",
  ])
    hash.update(readFileSync(path.join(root, "deploy", file)));
  if (official) {
    for (const assetDirectory of [
      "apps/ui/assets/images",
      "apps/ui/public",
      "apps/desktop/src-tauri/icons",
    ]) {
      for (const file of readdirSync(path.join(root, assetDirectory), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        hash.update(readFileSync(path.join(root, assetDirectory, file.name)));
      }
    }
  }
  return { brand, manifest, assetFiles, selected, version, fingerprint: hash.digest("hex") };
}
export type BrandBuild = ReturnType<typeof resolveBrand>;
