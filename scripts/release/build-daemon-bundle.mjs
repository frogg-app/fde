#!/usr/bin/env node
// Builds a self-contained daemon bundle for one platform/arch:
//
//   dist/bundles/fde-daemon-<version>-<platform>-<arch>.tar.gz
//
// Layout inside the tarball (one top-level directory of the same name):
//   node/      official Node.js runtime from nodejs.org (verified, trimmed)
//   daemon/    packages/server, apps/cli and the workspace libraries they need,
//              plus a production node_modules resolved for the target platform
//   bin/fde    launcher: exec node/bin/node daemon/apps/cli/dist/index.js "$@"
//   bin/paseo  same launcher under the upstream name
//   manifest.json
//
// The launcher runs the CLI, and the CLI starts the daemon through
// packages/server/dist/scripts/supervisor-entrypoint.js — the same launch
// contract the Nix package and Docker image follow (see
// scripts/ci/daemon-launch-contract.test.mjs). Nothing here starts
// daemon-worker directly.
//
// Prerequisites: `npm run build:server && npm run build:daemon-web-ui`.
// Usage: node scripts/release/build-daemon-bundle.mjs [--target linux-x64]
//        [--node-version 22.x.y] [--out-dir dist/bundles] [--keep-staging]

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_NODE_VERSION,
  fetchNodeRuntime,
  installNodeRuntime,
} from "./daemon-bundle-node-runtime.mjs";
import {
  installPlatformPackages,
  prunePlatformPackages,
} from "./daemon-bundle-platform-packages.mjs";
import { copyTree, directorySize, formatMiB, run, sha256File } from "./daemon-bundle-utils.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const SUPPORTED_TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];

// Workspaces that make up the daemon. Order does not matter for the copy;
// npm resolves them from the narrowed root package.json written below.
const DAEMON_WORKSPACES = [
  "packages/protocol",
  "packages/client",
  "packages/relay",
  "packages/highlight",
  "packages/plugin",
  "packages/server",
  "apps/cli",
];

// Files inside a workspace that are needed at runtime.
const WORKSPACE_KEEP = ["package.json", "dist", "bin", ".env.example", "README.md"];

const LAUNCHER = `#!/bin/sh
# FDE daemon bundle launcher. Resolves its own location through symlinks so
# ~/.local/bin/fde -> .../current/bin/fde keeps working after upgrades.
self="$0"
while [ -L "$self" ]; do
  link="$(readlink "$self")"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
root="$(cd "$(dirname "$self")/.." && pwd)"
PASEO_NODE_ENV="\${PASEO_NODE_ENV:-production}"
export PASEO_NODE_ENV
exec "$root/node/bin/node" --disable-warning=DEP0040 "$root/daemon/apps/cli/dist/index.js" "$@"
`;

function parseTarget(value) {
  const [platform, arch] = value.split("-");
  if (!SUPPORTED_TARGETS.includes(value)) {
    throw new Error(
      `Unsupported target "${value}". Expected one of: ${SUPPORTED_TARGETS.join(", ")}`,
    );
  }
  return { platform, arch };
}

function parseCli() {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: `${process.platform}-${process.arch}` },
      "node-version": { type: "string", default: DEFAULT_NODE_VERSION },
      "out-dir": { type: "string", default: path.join(REPO_ROOT, "dist", "bundles") },
      "keep-staging": { type: "boolean", default: false },
    },
  });
  return {
    ...parseTarget(values.target),
    nodeVersion: values["node-version"],
    outDir: path.resolve(values["out-dir"]),
    keepStaging: values["keep-staging"],
  };
}

function assertBuilt() {
  const required = [
    "packages/server/dist/scripts/supervisor-entrypoint.js",
    "apps/cli/dist/index.js",
    "packages/protocol/dist",
    "packages/client/dist",
  ];
  for (const relativePath of required) {
    if (!existsSync(path.join(REPO_ROOT, relativePath))) {
      throw new Error(`Missing ${relativePath}. Run \`npm run build:server\` first.`);
    }
  }
  if (!existsSync(path.join(REPO_ROOT, "packages/server/dist/server/web-ui/index.html"))) {
    console.warn(
      "warning: web UI not built (npm run build:daemon-web-ui); bundle will not serve it",
    );
  }
}

function excludeBuildArtifacts(relativePath) {
  return (
    relativePath.endsWith(".map") ||
    relativePath.endsWith(".tsbuildinfo") ||
    relativePath.endsWith(".d.ts") ||
    relativePath.endsWith(".d.mts") ||
    relativePath.endsWith(".test.js") ||
    relativePath.endsWith(".e2e.test.js")
  );
}

async function stageWorkspaces(daemonDir, rootPackage) {
  for (const workspace of DAEMON_WORKSPACES) {
    const source = path.join(REPO_ROOT, workspace);
    const target = path.join(daemonDir, workspace);
    await mkdir(target, { recursive: true });
    for (const entry of WORKSPACE_KEEP) {
      const entrySource = path.join(source, entry);
      if (!existsSync(entrySource)) continue;
      await copyTree(entrySource, path.join(target, entry), excludeBuildArtifacts);
    }
    const pkgPath = path.join(target, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    delete pkg.scripts;
    delete pkg.devDependencies;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const narrowed = {
    name: rootPackage.name,
    version: rootPackage.version,
    private: true,
    workspaces: DAEMON_WORKSPACES,
    overrides: rootPackage.overrides,
    engines: rootPackage.engines,
  };
  await writeFile(path.join(daemonDir, "package.json"), `${JSON.stringify(narrowed, null, 2)}\n`);
  await copyTree(
    path.join(REPO_ROOT, "package-lock.json"),
    path.join(daemonDir, "package-lock.json"),
    () => false,
  );
}

async function installProductionDependencies(daemonDir, platform, arch) {
  console.log(`Installing production dependencies for ${platform}-${arch}...`);
  await run(
    "npm",
    [
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--os",
      platform,
      "--cpu",
      arch,
      "--workspace=@fde/server",
      "--workspace=@fde/cli",
    ],
    { cwd: daemonDir, env: { ...process.env, ONNXRUNTIME_NODE_INSTALL: "skip" } },
  );
  await rm(path.join(daemonDir, "package-lock.json"), { force: true });
}

// Re-applies the repo's patch-package patches that touch daemon dependencies.
// `npm install --ignore-scripts` skips the root postinstall that normally does this.
async function applyDependencyPatches(daemonDir) {
  const patchesDir = path.join(REPO_ROOT, "patches");
  const patchBin = path.join(REPO_ROOT, "node_modules", ".bin", "patch-package");
  const sdkDir = path.join(daemonDir, "node_modules", "@opencode-ai", "sdk");
  if (!existsSync(patchBin) || !existsSync(sdkDir)) return;
  const tempPatchDir = path.join(daemonDir, ".bundle-patches");
  await mkdir(tempPatchDir, { recursive: true });
  for (const file of await readdir(patchesDir)) {
    if (file.startsWith("@opencode-ai+sdk+")) {
      await copyFile(path.join(patchesDir, file), path.join(tempPatchDir, file));
    }
  }
  try {
    await run(patchBin, ["--patch-dir", ".bundle-patches"], { cwd: daemonDir });
  } finally {
    await rm(tempPatchDir, { recursive: true, force: true });
  }
}

async function writeLaunchers(stagingDir) {
  const binDir = path.join(stagingDir, "bin");
  await mkdir(binDir, { recursive: true });
  for (const name of ["fde", "paseo"]) {
    const launcherPath = path.join(binDir, name);
    await writeFile(launcherPath, LAUNCHER);
    await chmod(launcherPath, 0o755);
  }
}

async function main() {
  const { platform, arch, nodeVersion, outDir, keepStaging } = parseCli();
  const rootPackage = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  const version = rootPackage.version;
  const bundleName = `fde-daemon-${version}-${platform}-${arch}`;
  const stagingDir = path.join(outDir, "staging", bundleName);
  const daemonDir = path.join(stagingDir, "daemon");

  assertBuilt();
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(daemonDir, { recursive: true });

  const nodeArchive = await fetchNodeRuntime({
    version: nodeVersion,
    platform,
    arch,
    cacheDir: path.join(outDir, "cache"),
  });
  await installNodeRuntime(nodeArchive, path.join(stagingDir, "node"));

  await stageWorkspaces(daemonDir, rootPackage);
  await installProductionDependencies(daemonDir, platform, arch);
  await installPlatformPackages(daemonDir, platform, arch);
  await prunePlatformPackages(daemonDir, platform, arch);
  await applyDependencyPatches(daemonDir);
  await writeLaunchers(stagingDir);

  const manifest = {
    name: "fde-daemon",
    version,
    platform,
    arch,
    node: nodeVersion,
    builtAt: new Date().toISOString(),
  };
  await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const tarballPath = path.join(outDir, `${bundleName}.tar.gz`);
  console.log(`Packing ${path.relative(REPO_ROOT, tarballPath)}...`);
  await rm(tarballPath, { force: true });
  await run("tar", ["-czf", tarballPath, "-C", path.dirname(stagingDir), bundleName]);
  const digest = await sha256File(tarballPath);
  await writeFile(`${tarballPath}.sha256`, `${digest}  ${bundleName}.tar.gz\n`);

  const unpacked = await directorySize(stagingDir);
  const packed = (await readFile(tarballPath)).byteLength;
  console.log(`Bundle: ${tarballPath}`);
  console.log(
    `  unpacked: ${formatMiB(unpacked)}  tarball: ${formatMiB(packed)}  sha256: ${digest}`,
  );

  if (!keepStaging) {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
