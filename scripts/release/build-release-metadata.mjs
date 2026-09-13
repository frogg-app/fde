import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { buildElectronReleaseManifests } from "./electron-release-manifests.mjs";

/** Product discovery is stable; packaging adapters supply versioned update protocols. */
export async function buildReleaseMetadata(options) {
  const update = await buildElectronReleaseManifests(options);
  const descriptor = {
    schemaVersion: 1,
    version: options.version,
    channel: options.version.includes("-") ? "beta" : "stable",
    updatePaths: {
      "electron-updater": update,
      "tauri-updater": {
        mode: "manual",
        message:
          "Install this release manually: the installed updater cannot replace the new application layout safely.",
      },
    },
  };
  await writeFile(
    path.join(options.out, "release.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  return descriptor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      assets: { type: "string" },
      out: { type: "string" },
      "retain-desktop-from": { type: "string" },
    },
  });
  if (!values.version || !values.assets || !values.out)
    throw new Error("Required: --version --assets --out");
  const platformVersions = {};
  if (values["retain-desktop-from"]) {
    const previous = JSON.parse(await readFile(values["retain-desktop-from"], "utf8"));
    for (const platform of ["-linux", "-mac"]) {
      const entry = previous.updatePaths?.["electron-updater"]?.platforms?.[platform];
      if (!entry) throw new Error(`Missing previous platform: ${platform}`);
      platformVersions[platform] = entry.version ?? previous.version;
    }
  }
  await buildReleaseMetadata({ ...values, platformVersions });
}
