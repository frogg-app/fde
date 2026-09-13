import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandManifestSchema, resolveBrandManifest } from "./schema.js";
import { brandEnv, matchesBrand, storageKey } from "./identity.js";
import { daemonArtifactName } from "./artifacts.js";

const minimal = {
  schemaVersion: 1,
  id: "acme",
  name: "Acme Studio",
  applicationId: "com.acme.studio",
  daemonPort: 10099,
  assets: { icon: "./icon.png" },
};

test("custom defaults have independent identities and no upstream services", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(brand.homeDir, ".acme");
  assert.equal(brand.desktopBinaryName, "acme-desktop");
  assert.notEqual(brand.desktopBinaryName, brand.cliName);
  assert.equal(brand.scheme, "acme");
  assert.equal(brand.serviceName, "acme-daemon");
  assert.equal(brand.envPrefix, "ACME");
  assert.equal(brand.distribution.updateMode, "disabled");
  assert.equal(brand.distribution.releaseBase, null);
  assert.equal(brand.services.pairingUrl, null);
  assert.equal(brand.distribution.iosStoreId, null);
  assert.equal(brand.links.docs, null);
  assert.equal(storageKey(brand, "settings"), "com.acme.studio:settings");
});
test("invalid identity, unsupported version, unknown fields and bad contrast are rejected", () => {
  for (const patch of [
    { id: "../fde" },
    { applicationId: "not-valid" },
    { daemonPort: 99999 },
    { schemaVersion: 2 },
    { secret: "not-a-brand-field" },
  ]) {
    assert.equal(BrandManifestSchema.safeParse({ ...minimal, ...patch }).success, false);
  }
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        colors: {
          light: {
            accent: "#ffffff",
            accentForeground: "#ffffff",
            background: "#ffffff",
            foreground: "#000000",
          },
        },
      }),
    /contrast/,
  );
});
test("updates require a source and signed mode requires a public key", () => {
  assert.throws(
    () => resolveBrandManifest({ ...minimal, distribution: { updates: "github-release" } }),
    /repository/,
  );
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        distribution: { updates: "tauri-signed", repository: "acme/studio" },
      }),
    /updaterPublicKey/,
  );
  const brand = resolveBrandManifest({ ...minimal, distribution: { repository: "acme/studio" } });
  assert.equal(brand.distribution.releasesApi, "https://api.github.com/repos/acme/studio/releases");
});
test("custom home selection ignores inherited FDE homes", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(brandEnv(brand, { FDE_HOME: "/fde" }, "HOME"), undefined);
  assert.equal(brandEnv(brand, { ACME_HOME: " /acme " }, "HOME"), "/acme");
  const official = resolveBrandManifest({ ...minimal, id: "fde", envPrefix: "FDE" });
  assert.equal(brandEnv(official, { FDE_HOME: "/official" }, "HOME"), "/official");
});
test("management accepts legacy metadata only for FDE and rejects other products", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(matchesBrand(brand, null), false);
  assert.equal(matchesBrand(brand, { id: "other", applicationId: brand.applicationId }), false);
  assert.equal(matchesBrand(brand, { id: brand.id, applicationId: brand.applicationId }), true);
  assert.equal(matchesBrand({ id: "fde", applicationId: "app.frogg.fde" }, null), true);
});
test("artifact names carry the selected brand across daemon targets", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(
    daemonArtifactName(brand, "1.2.3", "win", "arm64"),
    "acme-daemon-1.2.3-win-arm64.zip",
  );
  assert.equal(
    daemonArtifactName(brand, "1.2.3", "linux", "x64"),
    "acme-daemon-1.2.3-linux-x64.tar.gz",
  );
});
