import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandManifestSchema, resolveBrandManifest } from "./schema.js";
import { brandEnv, matchesBrand, normalizeBrandEnvironment, storageKey } from "./identity.js";
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
test("installer presentation defaults to the dark palette and accepts overrides", () => {
  const brand = resolveBrandManifest({
    ...minimal,
    colors: {
      dark: {
        accent: "#c4b5fd",
        accentForeground: "#27143d",
        background: "#20152e",
        foreground: "#faf5ff",
      },
    },
  });
  assert.equal(brand.installer.colors.background, "#20152e");
  assert.equal(brand.installer.colors.accent, "#c4b5fd");
  assert.equal(brand.installer.copy.ready, "Acme Studio is ready");
  const custom = resolveBrandManifest({
    ...minimal,
    installer: {
      tagline: "Build with {name}",
      colors: { success: "#00ff00" },
      copy: { installing: "Setting up {name}" },
    },
  });
  assert.equal(custom.installer.tagline, "Build with Acme Studio");
  assert.equal(custom.installer.colors.success, "#00ff00");
  assert.equal(custom.installer.copy.installing, "Setting up Acme Studio");
  for (const installer of [
    { colors: { success: "green" } },
    { copy: { unknown: "x" } },
    { tagline: "x".repeat(81) },
  ]) {
    assert.equal(BrandManifestSchema.safeParse({ ...minimal, installer }).success, false);
  }
  assert.throws(
    () =>
      resolveBrandManifest({
        ...minimal,
        installer: { colors: { background: "#ffffff", foreground: "#fefefe" } },
      }),
    /installer colors require text contrast/,
  );
});

test("invalid identity, unsupported version, unknown fields and bad contrast are rejected", () => {
  for (const patch of [
    { id: "../frogg" },
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
    () =>
      resolveBrandManifest({
        ...minimal,
        distribution: { updates: "github-release" },
      }),
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
  const brand = resolveBrandManifest({
    ...minimal,
    distribution: { repository: "acme/studio" },
  });
  assert.equal(brand.distribution.releasesApi, "https://api.github.com/repos/acme/studio/releases");
});
test("custom home selection ignores inherited Frogg homes", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(brandEnv(brand, { FROGG_HOME: "/frogg" }, "HOME"), undefined);
  assert.equal(brandEnv(brand, { ACME_HOME: " /acme " }, "HOME"), "/acme");
  const official = resolveBrandManifest({
    ...minimal,
    id: "frogg",
    envPrefix: "FROGG",
  });
  assert.equal(brandEnv(official, { FROGG_HOME: "/official" }, "HOME"), "/official");
});

test("normalizes branded environment variables to internal names", () => {
  const brand = resolveBrandManifest(minimal);
  const env: Record<string, string | undefined> = { ACME_LISTEN: "0.0.0.0:1234" };
  normalizeBrandEnvironment(brand, env);
  assert.equal(env.FROGG_LISTEN, "0.0.0.0:1234");
});

test("branded normalization rejects the legacy FROGG namespace", () => {
  const brand = resolveBrandManifest(minimal);
  const env: Record<string, string | undefined> = {
    ACME_LISTEN: "0.0.0.0:1234",
    FROGG_LISTEN: "127.0.0.1:1",
  };
  normalizeBrandEnvironment(brand, env);
  assert.equal(env.FROGG_LISTEN, undefined);
});
test("management accepts legacy metadata only for Frogg and rejects other products", () => {
  const brand = resolveBrandManifest(minimal);
  assert.equal(matchesBrand(brand, null), false);
  assert.equal(matchesBrand(brand, { id: "other", applicationId: brand.applicationId }), false);
  assert.equal(matchesBrand(brand, { id: brand.id, applicationId: brand.applicationId }), true);
  assert.equal(matchesBrand({ id: "frogg", applicationId: "app.frogg.frogg" }, null), true);
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
