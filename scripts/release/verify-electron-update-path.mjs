import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { valid, gte, lte } from "semver";

export function verifyElectronUpdatePath({ version, update, manifests, assets }) {
  const descriptor = { ...update, version };
  if (
    !valid(descriptor.version) ||
    !valid(descriptor.minimumClientVersion) ||
    !gte(descriptor.version, descriptor.minimumClientVersion)
  )
    throw new Error("Invalid minimum client version");
  const channel = descriptor.version.includes("-") ? "electron-beta" : "electron-latest";
  if (descriptor.channel !== channel) throw new Error("Release channel mismatch");

  for (const [platform, count] of [
    ["-win", 1],
    ["-linux", 1],
    ["-mac", 2],
  ]) {
    verifyPlatform({ descriptor, manifests, assets, channel, platform, count });
  }
}

function verifyPlatform({ descriptor, manifests, assets, channel, platform, count }) {
  const entry = descriptor.platforms?.[platform];
  const platformVersion = entry?.version ?? descriptor.version;
  if (!valid(platformVersion) || !lte(platformVersion, descriptor.version))
    throw new Error(`Invalid platform version for ${platform}`);
  const name = `${channel}${platform === "-win" ? "" : platform}.yml`;
  const manifest = manifests[name];
  if (
    entry?.manifest !== name ||
    !manifest ||
    !assets.has(name) ||
    manifest.version !== platformVersion ||
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

async function verifyElectronPayloads(update, directory) {
  for (const platform of Object.values(update.platforms)) {
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

export const electronUpdateProtocol = {
  verifyMetadata: verifyElectronUpdatePath,
  manifestNames: (update) => Object.values(update.platforms).map((platform) => platform.manifest),
  payloadNames: (update) =>
    Object.values(update.platforms).flatMap((platform) => platform.files.map((file) => file.url)),
  verifyPayloads: verifyElectronPayloads,
};
