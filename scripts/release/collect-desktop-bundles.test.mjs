import assert from "node:assert/strict";
import { test } from "node:test";

import { planBundleRenames } from "./collect-desktop-bundles.mjs";

test("linux: deb and AppImage get dashed names, signatures follow", () => {
  const renames = planBundleRenames({
    platform: "linux",
    arch: "x86_64",
    version: "0.1.5",
    files: [
      "bundle/deb/FDE_0.1.5_amd64.deb",
      "bundle/appimage/FDE_0.1.5_amd64.AppImage",
      "bundle/appimage/FDE_0.1.5_amd64.AppImage.sig",
    ],
  });
  assert.deepEqual(renames, [
    { from: "bundle/deb/FDE_0.1.5_amd64.deb", to: "FDE-0.1.5-amd64.deb" },
    { from: "bundle/appimage/FDE_0.1.5_amd64.AppImage", to: "FDE-0.1.5-x86_64.AppImage" },
    {
      from: "bundle/appimage/FDE_0.1.5_amd64.AppImage.sig",
      to: "FDE-0.1.5-x86_64.AppImage.sig",
    },
  ]);
});

test("windows: installer zip with its signature, and the portable zip", () => {
  const renames = planBundleRenames({
    platform: "windows",
    arch: "x86_64",
    version: "0.1.5",
    files: [
      "bundle/nsis/FDE_0.1.5_x64-setup.exe",
      "bundle/nsis-zip/FDE-0.1.5-x64-setup.zip",
      "bundle/nsis-zip/FDE-0.1.5-x64-setup.zip.sig",
      "fde.exe",
      "bundle/portable/FDE-0.1.5-x64-portable.zip",
    ],
  });
  assert.deepEqual(
    renames.map((entry) => entry.to),
    ["FDE-0.1.5-x64-setup.zip", "FDE-0.1.5-x64-setup.zip.sig", "FDE-0.1.5-x64-portable.zip"],
  );
});

test("macos: arch comes from the caller; missing kinds are skipped", () => {
  const renames = planBundleRenames({
    platform: "macos",
    arch: "aarch64",
    version: "0.1.5",
    files: ["bundle/dmg/FDE_0.1.5_aarch64.dmg", "bundle/macos/FDE.app"],
  });
  assert.deepEqual(renames, [
    { from: "bundle/dmg/FDE_0.1.5_aarch64.dmg", to: "FDE-0.1.5-aarch64.dmg" },
  ]);
});

test("older builds in the target dir do not make the rename ambiguous", () => {
  const renames = planBundleRenames({
    platform: "windows",
    arch: "x86_64",
    version: "0.1.18",
    files: [
      "bundle/portable/FDE-0.1.9-x64-portable.zip",
      "bundle/portable/FDE-0.1.18-x64-portable.zip",
      "bundle/nsis-zip/FDE-0.1.9-x64-setup.zip",
      "bundle/nsis-zip/FDE-0.1.18-x64-setup.zip",
    ],
  });
  assert.deepEqual(renames, [
    { from: "bundle/nsis-zip/FDE-0.1.18-x64-setup.zip", to: "FDE-0.1.18-x64-setup.zip" },
    { from: "bundle/portable/FDE-0.1.18-x64-portable.zip", to: "FDE-0.1.18-x64-portable.zip" },
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
