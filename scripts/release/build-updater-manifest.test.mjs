import assert from "node:assert/strict";
import { test } from "node:test";

import { buildUpdaterManifest } from "./build-updater-manifest.mjs";

test("manifest lists only platforms with a signature", () => {
  const manifest = buildUpdaterManifest({
    version: "0.1.5",
    tag: "v0.1.5",
    repo: "frogg-app/fde",
    pubDate: "2026-09-02T00:00:00.000Z",
    notes: "notes",
    signatures: {
      "FDE-0.1.5-x86_64.AppImage": "sig-linux\n",
      "FDE-0.1.5-aarch64.app.tar.gz": "sig-mac",
      "FDE-0.1.5-amd64.deb": "not an updater asset",
    },
  });
  assert.deepEqual(manifest, {
    version: "0.1.5",
    notes: "notes",
    pub_date: "2026-09-02T00:00:00.000Z",
    platforms: {
      "linux-x86_64": {
        signature: "sig-linux",
        url: "https://github.com/frogg-app/fde/releases/download/v0.1.5/FDE-0.1.5-x86_64.AppImage",
      },
      "darwin-aarch64": {
        signature: "sig-mac",
        url: "https://github.com/frogg-app/fde/releases/download/v0.1.5/FDE-0.1.5-aarch64.app.tar.gz",
      },
    },
  });
});

test("no signatures is an error", () => {
  assert.throws(
    () => buildUpdaterManifest({ version: "1", tag: "v1", repo: "a/b", signatures: {} }),
    /No signed updater assets/,
  );
});
