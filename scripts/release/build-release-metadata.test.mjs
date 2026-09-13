import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { verifyReleaseAssets, verifyReleasePayloads } from "./verify-release-assets.mjs";
import { buildReleaseMetadata } from "./build-release-metadata.mjs";

test("Electron manifests require every platform and carry real hashes for both Mac architectures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-update-manifest-"));
  const out = path.join(dir, "metadata");
  try {
    await assert.rejects(buildReleaseMetadata({ version: "0.6.0", assets: dir, out }), /Expected/);
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"]) {
      await writeFile(path.join(dir, `Frogg-0.6.0-${suffix}`), suffix);
    }
    await buildReleaseMetadata({ version: "0.6.0", assets: dir, out });
    const descriptor = JSON.parse(await readFile(path.join(out, "release.json"), "utf8"));
    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(Object.hasOwn(descriptor, "runtime"), false);
    assert.equal(descriptor.channel, "stable");
    assert.equal(descriptor.version, "0.6.0");
    assert.equal(descriptor.updatePaths["tauri-updater"].mode, "manual");
    for (const platform of Object.values(descriptor.updatePaths["electron-updater"].platforms)) {
      const channel = JSON.parse(await readFile(path.join(out, platform.manifest), "utf8"));
      assert.deepEqual(platform.files, channel.files);
      for (const file of platform.files)
        assert.equal((await readFile(path.join(dir, file.url))).length, file.size);
    }
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const platform of Object.values(descriptor.updatePaths["electron-updater"].platforms)) {
      manifests[platform.manifest] = JSON.parse(
        await readFile(path.join(out, platform.manifest), "utf8"),
      );
      assets.push({ name: platform.manifest });
      for (const file of platform.files) {
        const bytes = await readFile(path.join(dir, file.url));
        assets.push({
          name: file.url,
          size: bytes.length,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        });
      }
    }
    const release = { tag_name: "v0.6.0", assets };
    verifyReleaseAssets({ descriptor, manifests, release });
    const previousDescriptor = { updatePaths: { "future-updater": { mode: "automatic" } } };
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor }),
      /Missing upgrade path/,
    );
    const migrating = structuredClone(descriptor);
    migrating.updatePaths["future-updater"] = {
      mode: "manual",
      message: "Install the replacement package manually.",
    };
    verifyReleaseAssets({ descriptor: migrating, manifests, release, previousDescriptor });
    const unknownAutomatic = structuredClone(migrating);
    unknownAutomatic.updatePaths["future-updater"] = { mode: "automatic" };
    assert.throws(
      () => verifyReleaseAssets({ descriptor: unknownAutomatic, manifests, release }),
      /No publication verifier/,
    );

    await verifyReleasePayloads(descriptor, dir);
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor: {
            ...descriptor,
            updatePaths: {
              ...descriptor.updatePaths,
              "electron-updater": {
                ...descriptor.updatePaths["electron-updater"],
                minimumClientVersion: "invalid",
              },
            },
          },
          manifests,
          release,
        }),
      /minimum/,
    );
    const wrongHash = structuredClone(descriptor);
    wrongHash.updatePaths["electron-updater"].platforms["-win"].files[0].sha512 =
      Buffer.alloc(64).toString("base64");
    await assert.rejects(verifyReleasePayloads(wrongHash, dir), /byte verification/);
    for (const changes of [{ name: "renamed.exe" }, { size: 0 }, { digest: "sha256:incorrect" }]) {
      const broken = structuredClone(release);
      const payload = broken.assets.find((asset) => asset.name.endsWith(".exe"));
      Object.assign(payload, changes);
      assert.throws(
        () => verifyReleaseAssets({ descriptor, manifests, release: broken }),
        /Missing payload|mismatch/,
      );
    }
    const brokenManifests = structuredClone(manifests);
    brokenManifests["electron-latest.yml"].files[0].url = "different.exe";
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests: brokenManifests, release }),
      /inconsistent/,
    );
    const manifest = JSON.parse(await readFile(path.join(out, "electron-latest-mac.yml"), "utf8"));
    assert.equal(manifest.version, "0.6.0");
    const linux = JSON.parse(await readFile(path.join(out, "electron-latest-linux.yml"), "utf8"));
    assert.equal(linux.path, "Frogg-0.6.0-linux-x86_64.AppImage");
    assert.equal(linux.files[0].url, linux.path);
    assert.equal(manifest.files.length, 2);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(dir, file.url));
      assert.equal(file.sha512, createHash("sha512").update(bytes).digest("base64"));
      assert.equal(file.size, bytes.length);
    }
    assert.match(
      await readFile(path.join(out, "SHA256SUMS-desktop"), "utf8"),
      /Frogg-0.6.0-win-x64.exe/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects two Mac payloads for the same architecture", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-mac-coverage-"));
  try {
    for (const name of [
      "Frogg-0.6.0-win-x64.exe",
      "Frogg-0.6.0-linux-x86_64.AppImage",
      "Frogg-0.6.0-mac-x64.zip",
      "Other-0.6.0-mac-x64.zip",
    ]) {
      await writeFile(path.join(dir, name), name);
    }
    await assert.rejects(
      buildReleaseMetadata({
        version: "0.6.0",
        assets: dir,
        out: path.join(dir, "metadata"),
      }),
      /one x64 and one arm64/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selected releases retain exact preceding platform payloads and versions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-retained-platforms-"));
  const out = path.join(dir, "metadata");
  try {
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"])
      await writeFile(path.join(dir, `Frogg-0.6.13-${suffix}`), suffix);
    const previousDescriptor = await buildReleaseMetadata({ version: "0.6.13", assets: dir, out });
    await writeFile(path.join(dir, "Frogg-0.6.19-win-x64.exe"), "new installer");
    const descriptor = await buildReleaseMetadata({
      version: "0.6.19",
      assets: dir,
      out,
      platformVersions: { "-linux": "0.6.13", "-mac": "0.6.13" },
    });
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const [key, platform] of Object.entries(
      descriptor.updatePaths["electron-updater"].platforms,
    )) {
      const manifest = JSON.parse(await readFile(path.join(out, platform.manifest), "utf8"));
      assert.equal(manifest.version, key === "-win" ? "0.6.19" : "0.6.13");
      manifests[platform.manifest] = manifest;
      assets.push({ name: platform.manifest });
      for (const file of platform.files)
        assets.push({ name: file.url, size: file.size, digest: `sha256:${file.sha256}` });
    }
    const release = { tag_name: "v0.6.19", assets };
    verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor });
    await verifyReleasePayloads(descriptor, dir);
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release }),
      /Retained platform/,
    );
    const altered = structuredClone(previousDescriptor);
    altered.updatePaths["electron-updater"].platforms["-linux"].files[0].sha256 = "0".repeat(64);
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor: altered }),
      /Retained platform/,
    );
    await assert.rejects(
      buildReleaseMetadata({
        version: "0.6.19",
        assets: dir,
        out,
        platformVersions: { "-linux": "0.6.20" },
      }),
      /Invalid retained/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
