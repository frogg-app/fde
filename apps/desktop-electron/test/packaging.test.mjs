import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
const root = path.resolve(import.meta.dirname, "../../..");
const desktop = path.join(root, "apps/desktop-electron");
const require = createRequire(import.meta.url);
function configFor(brand, env = {}) {
  const context = {
    module: { exports: {} },
    __dirname: desktop,
    process: { env },
    require(name) {
      return name.includes("branding/load") ? { loadBrand: () => brand } : require(name);
    },
  };
  vm.runInNewContext(readFileSync(path.join(desktop, "electron-builder.cjs"), "utf8"), context);
  return context.module.exports;
}
test("production packages use branded identity and register branded deep links", () => {
  const config = configFor({
    name: "Sample",
    id: "sample",
    artifactPrefix: "Sample",
    applicationId: "app.sample",
    publisher: "Sample",
    scheme: "sample",
  });
  assert.equal(config.appId, "app.sample");
  assert.equal(config.productName, "Sample");
  assert.match(config.artifactName, /^Sample-\$\{version\}-/);
  assert.equal(config.publish, null);
  assert.equal(config.win.icon, path.join(root, ".generated/branding/icons/icon.ico"));
  assert.equal(config.mac.icon, path.join(root, ".generated/branding/icons/icon.icns"));
  assert.equal(config.executableName, "sample");
  assert.deepEqual(Array.from(config.protocols[0].schemes), ["sample"]);
  assert.deepEqual(Array.from(config.extraResources, (item) => item.to).sort(), [
    "app-dist",
    "brand.json",
    "icon.png",
  ]);
  assert.ok(config.win.target.includes("nsis"));
  assert.ok(config.win.target.includes("zip"));
  assert.equal(config.nsis.oneClick, true);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(
    config.nsis.include,
    path.join(root, ".generated/branding/windows-installer/installer.nsh"),
  );
  assert.equal(config.nsis.shortcutName, "Sample");
  assert.ok(config.mac.target.includes("dmg"));
  assert.ok(config.linux.target.includes("AppImage"));
});
test("root aliases default to Electron and preserve Tauri comparison commands", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(scripts["dev:desktop"], /@frogg\/desktop-electron/);
  assert.match(scripts["build:desktop"], /@frogg\/desktop-electron/);
  assert.match(scripts["dev:desktop:tauri"], /@frogg\/desktop --/);
  assert.match(scripts["build:desktop:tauri:win"], /@frogg\/desktop/);
});

test("configured Windows Trusted Signing carries through to Electron packaging", () => {
  const brand = {
    name: "Sample",
    id: "sample",
    artifactPrefix: "Sample",
    applicationId: "app.sample",
    publisher: "Sample Publisher",
  };
  assert.equal(configFor(brand).win.azureSignOptions, undefined);
  assert.throws(
    () => configFor(brand, { TRUSTED_SIGNING_ACCOUNT: "account" }),
    /requires endpoint/,
  );
  const config = configFor(brand, {
    TRUSTED_SIGNING_ACCOUNT: "account",
    TRUSTED_SIGNING_ENDPOINT: "https://example.com",
    TRUSTED_SIGNING_PROFILE: "profile",
  });
  assert.equal(config.win.azureSignOptions.codeSigningAccountName, "account");
  assert.equal(config.win.azureSignOptions.certificateProfileName, "profile");
  assert.equal(config.win.azureSignOptions.publisherName, "Sample Publisher");
});
