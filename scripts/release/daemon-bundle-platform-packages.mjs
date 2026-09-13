// Cross-platform handling for the daemon bundle's node_modules.
//
// The repo lockfile only records the optional platform packages that were
// resolved on the machine that generated it (linux-x64). When bundling for
// another target, `npm install --os/--cpu` therefore leaves out packages such
// as @esbuild/darwin-arm64 or @anthropic-ai/claude-agent-sdk-darwin-arm64.
// `installPlatformPackages` scans every installed package's
// optionalDependencies for entries that name the target platform and fetches
// the missing ones straight from the registry with `npm pack`.
//
// `prunePlatformPackages` then removes what the bundle should not carry:
// sherpa-onnx voice runtimes for other platforms, musl variants, and node-pty
// prebuilds for other platforms.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { findNodeModulesDirs, run, runCapture } from "./daemon-bundle-utils.mjs";

// The local speech runtime (sherpa-onnx) ships in the bundle so dictation and
// voice mode work out of the box; only the target platform's native package is
// kept. sherpa names Windows "win" where npm says "win32", and it has no
// win-arm64 build (that bundle simply has no local speech).
export function sherpaPackageForTarget(platform, arch) {
  return `sherpa-onnx-${platform === "win32" ? "win" : platform}-${arch}`;
}

function isSherpaNative(name) {
  return name.startsWith("sherpa-onnx-") && name !== "sherpa-onnx-node";
}

function isExcluded(name, platform, arch) {
  return isSherpaNative(name) && name !== sherpaPackageForTarget(platform, arch);
}

async function listPackageDirs(nodeModulesDir) {
  const dirs = [];
  const entries = await readdir(nodeModulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const entryPath = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      const scoped = await readdir(entryPath, { withFileTypes: true });
      for (const child of scoped) {
        if (child.isDirectory()) dirs.push(path.join(entryPath, child.name));
      }
    } else {
      dirs.push(entryPath);
    }
  }
  return dirs;
}

function isResolvable(name, fromNodeModulesDir, daemonDir) {
  let current = fromNodeModulesDir;
  while (current.startsWith(daemonDir)) {
    if (existsSync(path.join(current, name, "package.json"))) return true;
    const parent = path.dirname(path.dirname(current));
    const next = path.join(parent, "node_modules");
    if (next === current) break;
    current = next;
  }
  return false;
}

function matchesTarget(name, platform, arch) {
  return (
    name.endsWith(`-${platform}-${arch}`) ||
    name.endsWith(`/${platform}-${arch}`) ||
    name === sherpaPackageForTarget(platform, arch)
  );
}

async function packAndExtract(spec, name, nodeModulesDir) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "frogg-bundle-pack-"));
  try {
    const packed = (
      await runCapture("npm", ["pack", spec, "--pack-destination", tempDir, "--silent"])
    ).trim();
    const tarball = path.join(tempDir, packed.split("\n").pop());
    const target = path.join(nodeModulesDir, name);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await run("tar", ["-xzf", tarball, "--strip-components=1", "-C", target]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function installPlatformPackages(daemonDir, platform, arch) {
  const nodeModulesDirs = await findNodeModulesDirs(daemonDir);
  const missing = new Map();

  for (const nodeModulesDir of nodeModulesDirs) {
    for (const packageDir of await listPackageDirs(nodeModulesDir)) {
      let pkg;
      try {
        pkg = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
      } catch {
        continue;
      }
      for (const [name, range] of Object.entries(pkg.optionalDependencies ?? {})) {
        if (!matchesTarget(name, platform, arch) || isExcluded(name, platform, arch)) continue;
        if (isResolvable(name, nodeModulesDir, daemonDir)) continue;
        missing.set(`${nodeModulesDir}\0${name}`, {
          name,
          spec: `${name}@${range}`,
          nodeModulesDir,
        });
      }
    }
  }

  for (const { name, spec, nodeModulesDir } of missing.values()) {
    console.log(`Fetching platform package ${spec} -> ${path.relative(daemonDir, nodeModulesDir)}`);
    await packAndExtract(spec, name, nodeModulesDir);
  }
}

async function pruneNodePtyPrebuilds(packageDir, target) {
  const prebuilds = path.join(packageDir, "prebuilds");
  if (!existsSync(path.join(prebuilds, target))) {
    throw new Error(`node-pty has no prebuild for ${target} at ${prebuilds}`);
  }
  for (const entry of await readdir(prebuilds)) {
    if (entry !== target) {
      await rm(path.join(prebuilds, entry), { recursive: true, force: true });
    }
  }
}

export async function prunePlatformPackages(daemonDir, platform, arch) {
  const target = `${platform}-${arch}`;
  for (const nodeModulesDir of await findNodeModulesDirs(daemonDir)) {
    for (const packageDir of await listPackageDirs(nodeModulesDir)) {
      const name = path.relative(nodeModulesDir, packageDir);
      if (isExcluded(name, platform, arch) || name.endsWith("-musl")) {
        await rm(packageDir, { recursive: true, force: true });
      } else if (name === "node-pty") {
        await pruneNodePtyPrebuilds(packageDir, target);
      }
    }
  }
}
