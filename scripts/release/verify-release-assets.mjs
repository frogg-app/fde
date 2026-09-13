import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { valid, gte } from "semver";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export function verifyReleaseAssets({ descriptor, manifests, release }) {
  if (
    descriptor.schemaVersion !== 1 ||
    descriptor.runtime !== "electron" ||
    release.tag_name !== `v${descriptor.version}`
  )
    throw new Error("Release identity mismatch");
  if (
    !valid(descriptor.version) ||
    !valid(descriptor.minimumClientVersion) ||
    !gte(descriptor.version, descriptor.minimumClientVersion)
  )
    throw new Error("Invalid minimum client version");
  const channel = descriptor.version.includes("-") ? "electron-beta" : "electron-latest";
  if (descriptor.channel !== channel) throw new Error("Release channel mismatch");
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const [platform, count] of [
    ["-win", 1],
    ["-linux", 1],
    ["-mac", 2],
  ]) {
    verifyPlatform({ descriptor, manifests, assets, channel, platform, count });
  }
  if (!assets.has("electron-release.json")) throw new Error("Release descriptor is not uploaded");
}

function verifyPlatform({ descriptor, manifests, assets, channel, platform, count }) {
  const entry = descriptor.platforms?.[platform];
  const name = `${channel}${platform === "-win" ? "" : platform}.yml`;
  const manifest = manifests[name];
  if (
    entry?.manifest !== name ||
    !manifest ||
    !assets.has(name) ||
    manifest.version !== descriptor.version ||
    entry.files?.length !== count ||
    JSON.stringify(entry.files) !== JSON.stringify(manifest.files)
  ) {
    throw new Error(`Missing or inconsistent metadata for ${platform}`);
  }
  if (manifest.path !== entry.files[0].url || manifest.sha512 !== entry.files[0].sha512) {
    throw new Error(`Inconsistent primary payload for ${platform}`);
  }
  if (
    platform === "-mac" &&
    (!entry.files.some((file) => file.url.endsWith("-mac-x64.zip")) ||
      !entry.files.some((file) => file.url.endsWith("-mac-arm64.zip")))
  )
    throw new Error("Missing Mac architecture");
  verifyPayloadInventory(entry.files, assets);
}

function verifyPayloadInventory(files, assets) {
  const seen = new Set();
  for (const file of files) {
    if (!file.url || path.basename(file.url) !== file.url || seen.has(file.url))
      throw new Error("Invalid or duplicate payload name");
    seen.add(file.url);
    const remote = assets.get(file.url);
    if (
      !remote ||
      remote.size !== file.size ||
      !/^[a-f0-9]{64}$/.test(file.sha256 ?? "") ||
      remote.digest !== `sha256:${file.sha256}` ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512 ?? "")
    ) {
      throw new Error(`Missing payload or size/hash mismatch: ${file.url}`);
    }
  }
}

export async function verifyReleasePayloads(descriptor, directory) {
  for (const platform of Object.values(descriptor.platforms)) {
    for (const file of platform.files) {
      if (path.basename(file.url) !== file.url) throw new Error("Invalid payload path");
      const sha256 = createHash("sha256");
      const sha512 = createHash("sha512");
      let size = 0;
      for await (const chunk of createReadStream(path.join(directory, file.url))) {
        size += chunk.length;
        sha256.update(chunk);
        sha512.update(chunk);
      }
      if (
        size !== file.size ||
        sha256.digest("hex") !== file.sha256 ||
        sha512.digest("base64") !== file.sha512
      )
        throw new Error(`Payload byte verification failed: ${file.url}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      tag: { type: "string" },
      "assets-dir": { type: "string" },
    },
  });
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(values.repo ?? "") ||
    !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(values.tag ?? "")
  )
    throw new Error("Provide --repo OWNER/REPO --tag vVERSION");
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const release = JSON.parse(gh(["api", `repos/${values.repo}/releases/tags/${values.tag}`]));
  const directory = await mkdtemp(path.join(os.tmpdir(), "fde-release-verify-"));
  try {
    gh([
      "release",
      "download",
      values.tag,
      "--repo",
      values.repo,
      "--dir",
      directory,
      "--pattern",
      "electron-release.json",
      "--pattern",
      "electron-*.yml",
    ]);
    const descriptor = JSON.parse(
      await readFile(path.join(directory, "electron-release.json"), "utf8"),
    );
    const manifests = {};
    for (const channel of ["", "-linux", "-mac"]) {
      const name = `${descriptor.channel}${channel}.yml`;
      manifests[name] = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    }
    verifyReleaseAssets({ descriptor, manifests, release });
    if (!values["assets-dir"]) {
      const patterns = Object.values(descriptor.platforms).flatMap((platform) =>
        platform.files.flatMap((file) => ["--pattern", file.url]),
      );
      gh([
        "release",
        "download",
        values.tag,
        "--repo",
        values.repo,
        "--dir",
        directory,
        ...patterns,
      ]);
    }
    await verifyReleasePayloads(descriptor, values["assets-dir"] ?? directory);
    console.log(
      `Verified ${values.tag}: exact desktop payload names, sizes and SHA-256/SHA-512 hashes match payload bytes and GitHub assets.`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
