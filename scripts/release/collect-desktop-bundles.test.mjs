import assert from "node:assert/strict";
import { test } from "node:test";

import { planBundleRenames } from "./collect-desktop-bundles.mjs";

test("linux: deb and AppImage get dashed names, signatures follow", () => {
  const renames = planBundleRenames({
    platform: "linux",
    arch: "x86_64",
    version: "1.1.5",
    files: [
      "bundle/deb/FDE_1.1.5_amd64.deb",
      "bundle/appimage/FDE_1.1.5_amd64.AppImage",
      "bundle/appimage/FDE_1.1.5_amd64.AppImage.sig",
    ],
  });
  assert.deepEqual(renames, [
    { from: "bundle/deb/FDE_1.1.5_amd64.deb", to: "FDE-1.1.5-linux-x86_64.deb" },
    {
      from: "bundle/appimage/FDE_1.1.5_amd64.AppImage",
      to: "FDE-1.1.5-linux-x86_64.AppImage",
    },
    {
      from: "bundle/appimage/FDE_1.1.5_amd64.AppImage.sig",
      to: "FDE-1.1.5-linux-x86_64.AppImage.sig",
    },
  ]);
});

test("windows: installer zip with its signature, and the portable zip", () => {
  const renames = planBundleRenames({
    platform: "windows",
    arch: "x86_64",
    version: "1.1.5",
    files: [
      "bundle/nsis/FDE_1.1.5_x64-setup.exe",
      "bundle/nsis-zip/FDE-1.1.5-x64-setup.zip",
      "bundle/nsis-zip/FDE-1.1.5-x64-setup.zip.sig",
      "fde.exe",
      "bundle/portable/FDE-1.1.5-x64-portable.zip",
    ],
  });
  assert.deepEqual(
    renames.map((entry) => entry.to),
    [
      "FDE-1.1.5-win-x64-setup.zip",
      "FDE-1.1.5-win-x64-setup.zip.sig",
      "FDE-1.1.5-win-x64-portable.zip",
    ],
  );
});

test("macos: arch comes from the caller; missing kinds are skipped", () => {
  const renames = planBundleRenames({
    platform: "macos",
    arch: "aarch64",
    version: "1.1.5",
    files: ["bundle/dmg/FDE_1.1.5_aarch64.dmg", "bundle/macos/FDE.app"],
  });
  assert.deepEqual(renames, [
    { from: "bundle/dmg/FDE_1.1.5_aarch64.dmg", to: "FDE-1.1.5-mac-aarch64.dmg" },
  ]);
});

test("older builds in the target dir do not make the rename ambiguous", () => {
  const renames = planBundleRenames({
    platform: "windows",
    arch: "x86_64",
    version: "1.1.18",
    files: [
      "bundle/portable/FDE-1.1.9-x64-portable.zip",
      "bundle/portable/FDE-1.1.18-x64-portable.zip",
      "bundle/nsis-zip/FDE-1.1.9-x64-setup.zip",
      "bundle/nsis-zip/FDE-1.1.18-x64-setup.zip",
    ],
  });
  assert.deepEqual(renames, [
    {
      from: "bundle/nsis-zip/FDE-1.1.18-x64-setup.zip",
      to: "FDE-1.1.18-win-x64-setup.zip",
    },
    {
      from: "bundle/portable/FDE-1.1.18-x64-portable.zip",
      to: "FDE-1.1.18-win-x64-portable.zip",
    },
  ]);
});

test("ambiguous bundles and unknown platforms throw", () => {
  assert.throws(
    () =>
      planBundleRenames({
        platform: "linux",
        arch: "x86_64",
        version: "1",
        files: ["bundle/deb/a.deb", "bundle/deb/b.deb"],
      }),
    /Several bundle\/deb/,
  );
  assert.throws(
    () => planBundleRenames({ platform: "freebsd", arch: "x86_64", version: "1", files: [] }),
    /Unknown platform/,
  );
});

test("legacy desktop aliases keep matching checksums and identity metadata", async () => {
  const { collectDesktopBundles } = await import("./collect-desktop-bundles.mjs");
  const { mkdtemp, mkdir, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = await mkdtemp(path.join(tmpdir(), "brand-desktop-alias-"));
  try {
    const releaseDir = path.join(dir, "release");
    const outDir = path.join(dir, "out");
    await mkdir(path.join(releaseDir, "bundle/deb"), { recursive: true });
    await writeFile(path.join(releaseDir, "bundle/deb/FDE_1.2.3_amd64.deb"), "package fixture");
    collectDesktopBundles({
      platform: "linux",
      arch: "x86_64",
      version: "1.2.3",
      releaseDir,
      outDir,
    });
    const canonical = "FDE-1.2.3-linux-x86_64.deb";
    const legacy = "FDE-1.2.3-amd64.deb";
    assert.deepEqual(
      await readFile(path.join(outDir, canonical)),
      await readFile(path.join(outDir, legacy)),
    );
    const metadata = JSON.parse(
      await readFile(path.join(outDir, `${legacy}.metadata.json`), "utf8"),
    );
    assert.equal(metadata.asset, legacy);
    assert.equal(metadata.brand.applicationId, "app.frogg.fde");
    assert.equal(
      await readFile(path.join(outDir, `${legacy}.sha256`), "utf8"),
      `${metadata.sha256}  ${legacy}\n`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
