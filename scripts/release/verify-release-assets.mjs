import { electronUpdateProtocol } from "./verify-electron-update-path.mjs";
import { valid, lt, rcompare } from "semver";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export function verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor }) {
  if (
    descriptor.schemaVersion !== 1 ||
    !valid(descriptor.version) ||
    release.tag_name !== `v${descriptor.version}`
  )
    throw new Error("Release identity mismatch");
  if (descriptor.channel !== (descriptor.version.includes("-") ? "beta" : "stable"))
    throw new Error("Release channel mismatch");
  if (
    !descriptor.updatePaths ||
    typeof descriptor.updatePaths !== "object" ||
    Array.isArray(descriptor.updatePaths) ||
    !Object.keys(descriptor.updatePaths).length
  )
    throw new Error("Missing update paths");
  for (const protocol of Object.keys(previousDescriptor?.updatePaths ?? {})) {
    if (!Object.hasOwn(descriptor.updatePaths, protocol))
      throw new Error(`Missing upgrade path for previously supported protocol: ${protocol}`);
  }
  verifyRetainedPlatforms(descriptor, previousDescriptor);
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const [protocol, update] of Object.entries(descriptor.updatePaths)) {
    verifyUpdateProtocol({ protocol, update, version: descriptor.version, manifests, assets });
  }
  if (!assets.has("release.json")) throw new Error("Release descriptor is not uploaded");
}

function verifyRetainedPlatforms(descriptor, previousDescriptor) {
  const platforms = descriptor.updatePaths["electron-updater"]?.platforms ?? {};
  for (const [platform, entry] of Object.entries(platforms)) {
    if (!entry.version || entry.version === descriptor.version) continue;
    const previous = previousDescriptor?.updatePaths?.["electron-updater"]?.platforms?.[platform];
    const previousVersion = previous?.version ?? previousDescriptor?.version;
    if (
      !previous ||
      entry.version !== previousVersion ||
      entry.manifest !== previous.manifest ||
      JSON.stringify(entry.files) !== JSON.stringify(previous.files)
    )
      throw new Error(`Retained platform differs from preceding release: ${platform}`);
  }
}

function verifyUpdateProtocol({ protocol, update, version, manifests, assets }) {
  if (!update || typeof update !== "object") throw new Error("Invalid update path");
  if (update.mode === "manual") {
    if (typeof update.message !== "string" || !update.message.trim())
      throw new Error("Manual update path requires migration instructions");
    return;
  }
  if (update.mode !== "automatic") throw new Error("Unknown update mode");
  const verify = Object.hasOwn(protocolVerifiers, protocol)
    ? protocolVerifiers[protocol]
    : undefined;
  if (!verify) throw new Error(`No publication verifier registered for ${protocol}`);
  verify.verifyMetadata({ version, update, manifests, assets });
}

const protocolVerifiers = { "electron-updater": electronUpdateProtocol };

function automaticUpdates(descriptor) {
  return Object.entries(descriptor.updatePaths)
    .filter(([, update]) => update.mode === "automatic")
    .map(([protocol, update]) => {
      const adapter = Object.hasOwn(protocolVerifiers, protocol)
        ? protocolVerifiers[protocol]
        : undefined;
      if (!adapter) throw new Error(`No publication verifier registered for ${protocol}`);
      return { adapter, update };
    });
}

export async function verifyReleasePayloads(descriptor, directory) {
  for (const { adapter, update } of automaticUpdates(descriptor))
    await adapter.verifyPayloads(update, directory);
}

export function listReleases(gh, repo) {
  const output = gh([
    "api",
    "--paginate",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    ".[] | @json",
  ]);
  return output.trim()
    ? output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

async function loadPreviousDescriptor(gh, repo, version, directory) {
  const releases = listReleases(gh, repo);
  const previous = releases
    .filter(
      (release) =>
        !release.draft &&
        valid(release.tag_name) &&
        lt(release.tag_name, version) &&
        (version.includes("-") || !release.prerelease),
    )
    .sort((a, b) => rcompare(a.tag_name, b.tag_name))[0];
  if (!previous?.assets.some((asset) => asset.name === "release.json")) return undefined;
  const destination = path.join(directory, "previous");
  gh([
    "release",
    "download",
    previous.tag_name,
    "--repo",
    repo,
    "--dir",
    destination,
    "--pattern",
    "release.json",
  ]);
  return JSON.parse(await readFile(path.join(destination, "release.json"), "utf8"));
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
  const releases = listReleases(gh, values.repo);
  const release = releases.find((candidate) => candidate.tag_name === values.tag);
  if (!release) throw new Error(`Release not found: ${values.tag}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), "frogg-release-verify-"));
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
      "release.json",
    ]);
    const descriptor = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
    const manifests = {};
    const names = automaticUpdates(descriptor).flatMap(({ adapter, update }) =>
      adapter.manifestNames(update),
    );
    for (const name of new Set(names)) {
      if (typeof name !== "string" || path.basename(name) !== name)
        throw new Error("Invalid manifest filename");
      gh([
        "release",
        "download",
        values.tag,
        "--repo",
        values.repo,
        "--dir",
        directory,
        "--pattern",
        name,
      ]);
      manifests[name] = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    }
    const previousDescriptor = await loadPreviousDescriptor(
      gh,
      values.repo,
      descriptor.version,
      directory,
    );
    verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor });
    if (!values["assets-dir"] && automaticUpdates(descriptor).length) {
      const payloadNames = automaticUpdates(descriptor).flatMap(({ adapter, update }) =>
        adapter.payloadNames(update),
      );
      if (payloadNames.some((name) => typeof name !== "string" || path.basename(name) !== name))
        throw new Error("Invalid payload filename");
      const patterns = payloadNames.flatMap((name) => ["--pattern", name]);
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
