import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const rootPackagePath = path.join(rootDir, "package.json");

const rootPackage = JSON.parse(readFileSync(rootPackagePath, "utf8"));
const rootVersion = rootPackage.version;
const workspaceGlobs = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
// Expand `dir/*` entries; anything else is taken as a literal path.
const workspacePaths = workspaceGlobs.flatMap((entry) => {
  if (!entry.endsWith("/*")) {
    return [entry];
  }
  const parent = entry.slice(0, -2);
  const parentDir = path.join(rootDir, parent);
  if (!existsSync(parentDir)) {
    return [];
  }
  return readdirSync(parentDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => path.join(parent, dirent.name));
});

if (typeof rootVersion !== "string" || rootVersion.length === 0) {
  throw new Error('Root package.json must contain a valid "version"');
}

const dependencySections = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const touched = [];

/** Rewrites `version = "..."` in the `[package]` table only. */
export function syncCargoPackageVersion(manifest, version) {
  const packageTable = /^\[package\][^[]*/m;
  return manifest.replace(packageTable, (table) =>
    table.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`),
  );
}

for (const workspacePath of workspacePaths) {
  const packagePath = path.join(rootDir, workspacePath, "package.json");
  if (!existsSync(packagePath)) {
    continue;
  }

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  let changed = false;

  if (pkg.version !== rootVersion) {
    pkg.version = rootVersion;
    changed = true;
  }

  // Private workspaces (ui) keep "*" for internal deps so npm always
  // resolves the local sibling, never a registry artifact. Publishable workspaces
  // get the root version so their published tarballs reference real npm versions.
  const internalDepRange = pkg.private === true ? "*" : rootVersion;

  for (const section of dependencySections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== "object") {
      continue;
    }

    for (const name of Object.keys(deps)) {
      if (!name.startsWith("@fde/")) {
        continue;
      }
      if (name === pkg.name) {
        continue;
      }
      if (deps[name] !== internalDepRange) {
        deps[name] = internalDepRange;
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    touched.push(path.relative(rootDir, packagePath));
  }
}

// The Tauri shell keeps its version in two Rust-side files that npm never
// touches. Root package.json stays the source of truth for both.
const tauriConfigPath = path.join(rootDir, "apps/desktop/src-tauri/tauri.conf.json");
if (existsSync(tauriConfigPath)) {
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  if (tauriConfig.version !== rootVersion) {
    tauriConfig.version = rootVersion;
    writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
    touched.push(path.relative(rootDir, tauriConfigPath));
  }
}

const cargoManifestPath = path.join(rootDir, "apps/desktop/src-tauri/Cargo.toml");
if (existsSync(cargoManifestPath)) {
  const cargoManifest = readFileSync(cargoManifestPath, "utf8");
  const nextManifest = syncCargoPackageVersion(cargoManifest, rootVersion);
  if (nextManifest !== cargoManifest) {
    writeFileSync(cargoManifestPath, nextManifest);
    touched.push(path.relative(rootDir, cargoManifestPath));
  }
}

if (touched.length === 0) {
  console.log(`Workspace versions and internal deps already synced to ${rootVersion}`);
} else {
  console.log(`Synced to ${rootVersion}:`);
  for (const file of touched) {
    console.log(`- ${file}`);
  }
}
