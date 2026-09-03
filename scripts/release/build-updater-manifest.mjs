#!/usr/bin/env node
// Writes the `latest.json` that tauri-plugin-updater fetches (see
// `plugins.updater.endpoints` in apps/desktop/src-tauri/tauri.conf.json) from the
// renamed release assets and their minisign `.sig` files.
//
// Usage: node scripts/release/build-updater-manifest.mjs --version 1.2.3 --tag v1.2.3
//        --repo frogg-app/fde [--assets-dir release-assets] [--out latest.json]
//        [--notes-file notes.md]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** Updater platform key -> the asset that platform installs (names from collect-desktop-bundles). */
export const UPDATER_ASSETS = {
  "linux-x86_64": (v) => `FDE-${v}-x86_64.AppImage`,
  "windows-x86_64": (v) => `FDE-${v}-x64-setup.exe`,
  "darwin-aarch64": (v) => `FDE-${v}-aarch64.app.tar.gz`,
  "darwin-x86_64": (v) => `FDE-${v}-x86_64.app.tar.gz`,
};

/**
 * Pure: `signatures` maps asset file name -> signature text. Platforms whose asset has no
 * signature are left out, so a partial release (one platform re-run) still yields a valid
 * manifest for the platforms that were signed.
 */
export function buildUpdaterManifest({ version, tag, repo, signatures, notes = "", pubDate }) {
  const platforms = {};
  for (const [key, assetName] of Object.entries(UPDATER_ASSETS)) {
    const name = assetName(version);
    const signature = signatures[name];
    if (!signature) {
      continue;
    }
    platforms[key] = {
      signature: signature.trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    };
  }
  if (Object.keys(platforms).length === 0) {
    throw new Error("No signed updater assets found; nothing to put in latest.json");
  }
  return {
    version,
    notes,
    pub_date: pubDate ?? new Date().toISOString(),
    platforms,
  };
}

function readSignatures(assetsDir) {
  const signatures = {};
  for (const entry of readdirSync(assetsDir)) {
    if (entry.endsWith(".sig")) {
      signatures[entry.slice(0, -".sig".length)] = readFileSync(
        path.join(assetsDir, entry),
        "utf8",
      );
    }
  }
  return signatures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      tag: { type: "string" },
      repo: { type: "string" },
      "assets-dir": { type: "string", default: "release-assets" },
      out: { type: "string", default: "latest.json" },
      "notes-file": { type: "string" },
    },
  });
  try {
    if (!values.version || !values.tag || !values.repo) {
      throw new Error("--version, --tag and --repo are required");
    }
    const notes =
      values["notes-file"] && existsSync(values["notes-file"])
        ? readFileSync(values["notes-file"], "utf8").trim()
        : "";
    const manifest = buildUpdaterManifest({
      version: values.version,
      tag: values.tag,
      repo: values.repo,
      signatures: readSignatures(path.resolve(values["assets-dir"])),
      notes,
    });
    writeFileSync(path.resolve(values.out), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote ${values.out} for ${Object.keys(manifest.platforms).join(", ")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
