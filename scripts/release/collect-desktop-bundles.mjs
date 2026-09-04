#!/usr/bin/env node
// Copies the bundles `cargo tauri build` wrote under <release-dir>/bundle/ into one
// flat directory with the release asset names documented in docs/ci.md:
//
//   FDE-<version>-amd64.deb            FDE-<version>-x86_64.AppImage
//   FDE-<version>-x64-setup.zip        FDE-<version>-x64-portable.zip
//   FDE-<version>-aarch64.dmg          FDE-<version>-x86_64.dmg
//   FDE-<version>-<arch>.app.tar.gz    (macOS updater bundle)
//
// A `.sig` next to any bundle (present when TAURI_SIGNING_PRIVATE_KEY was set)
// is copied under the renamed name plus `.sig`.
//
// Usage: node scripts/release/collect-desktop-bundles.mjs --platform linux|windows|macos
//        --arch x86_64|aarch64 [--release-dir apps/desktop/src-tauri/target/release]
//        [--out-dir release-assets] [--version 1.2.3]

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");

/** Bundle kinds per platform: where Tauri writes them and what they become. */
const BUNDLE_RULES = {
  linux: [
    { dir: "bundle/deb", extension: ".deb", name: (v) => `FDE-${v}-amd64.deb` },
    { dir: "bundle/appimage", extension: ".AppImage", name: (v) => `FDE-${v}-x86_64.AppImage` },
  ],
  // Windows ships zipped: GitHub rejects raw .exe release assets (and Windows
  // itself blocks bare downloaded exes). scripts/release/package-windows-zips.mjs
  // writes both zips before this runs.
  windows: [
    { dir: "bundle/nsis-zip", extension: "-setup.zip", name: (v) => `FDE-${v}-x64-setup.zip` },
    { dir: "bundle/portable", extension: ".zip", name: (v) => `FDE-${v}-x64-portable.zip` },
  ],
  macos: [
    { dir: "bundle/dmg", extension: ".dmg", name: (v, arch) => `FDE-${v}-${arch}.dmg` },
    {
      dir: "bundle/macos",
      extension: ".app.tar.gz",
      name: (v, arch) => `FDE-${v}-${arch}.app.tar.gz`,
    },
  ],
};

/** `.sig` files ride along with the bundle they sign; the portable zip is never signed. */
const SIGNED_EXTENSIONS = [".AppImage", "-setup.zip", ".app.tar.gz"];

/**
 * Pure planning step: `files` lists paths relative to the release dir (as `/`-joined
 * strings). Returns `[{ from, to }]` with `to` a bare file name. Bundle kinds with
 * no matching file are skipped, so `--bundles deb` alone still works; a kind with
 * several matches throws, because the rename would be ambiguous.
 */
export function planBundleRenames({ platform, arch, version, files }) {
  const rules = BUNDLE_RULES[platform];
  if (!rules) {
    throw new Error(`Unknown platform "${platform}" (expected linux, windows, or macos)`);
  }
  const renames = [];
  for (const rule of rules) {
    const matches = files.filter((file) => {
      const dir = path.posix.dirname(file);
      const base = path.posix.basename(file);
      if (dir !== rule.dir) {
        return false;
      }
      return rule.exact ? base === rule.exact : base.endsWith(rule.extension);
    });
    if (matches.length === 0) {
      continue;
    }
    const target = rule.name(version, arch);
    // A dev checkout's target dir keeps every version ever built. When several
    // bundles match, the one already carrying this release's name wins; anything
    // else is genuinely ambiguous and the rename would be a guess.
    const named = matches.filter((file) => path.posix.basename(file) === target);
    let picked = null;
    if (named.length === 1) {
      picked = named[0];
    } else if (matches.length === 1) {
      picked = matches[0];
    } else {
      throw new Error(`Several ${rule.dir} bundles match: ${matches.join(", ")}`);
    }
    renames.push({ from: picked, to: target });
    const signable = SIGNED_EXTENSIONS.some((extension) => picked.endsWith(extension));
    if (signable && files.includes(`${picked}.sig`)) {
      renames.push({ from: `${picked}.sig`, to: `${target}.sig` });
    }
  }
  return renames;
}

function listFiles(root, relativeDir = ".") {
  const absolute = path.join(root, relativeDir);
  if (!existsSync(absolute)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relative = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isFile()) {
      out.push(relative);
    }
  }
  return out;
}

export function collectDesktopBundles({ platform, arch, version, releaseDir, outDir }) {
  const dirs = new Set(BUNDLE_RULES[platform]?.map((rule) => rule.dir) ?? []);
  const files = [...dirs].flatMap((dir) => listFiles(releaseDir, dir));
  const renames = planBundleRenames({ platform, arch, version, files });
  if (renames.length === 0) {
    throw new Error(`No bundles found under ${releaseDir}. Run the Tauri build first.`);
  }
  mkdirSync(outDir, { recursive: true });
  for (const { from, to } of renames) {
    const target = path.join(outDir, to);
    copyFileSync(path.join(releaseDir, from), target);
    // `sha256sum`-style sidecar so the in-app updater can verify what it downloads.
    if (!to.endsWith(".sig") && !to.endsWith(".sha256")) {
      const digest = createHash("sha256").update(readFileSync(target)).digest("hex");
      writeFileSync(`${target}.sha256`, `${digest}  ${to}\n`);
    }
  }
  return renames;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      platform: { type: "string" },
      arch: { type: "string" },
      version: { type: "string" },
      "release-dir": { type: "string", default: "apps/desktop/src-tauri/target/release" },
      "out-dir": { type: "string", default: "release-assets" },
    },
  });
  try {
    if (!values.platform || !values.arch) {
      throw new Error("--platform and --arch are required");
    }
    const version =
      values.version ??
      JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
    const renames = collectDesktopBundles({
      platform: values.platform,
      arch: values.arch,
      version,
      releaseDir: path.resolve(REPO_ROOT, values["release-dir"]),
      outDir: path.resolve(REPO_ROOT, values["out-dir"]),
    });
    for (const { from, to } of renames) {
      console.log(`${from} -> ${to}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
