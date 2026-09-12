import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
const root = path.resolve(import.meta.dirname, "../../..");
const desktop = path.join(root, "apps/desktop-electron");
const require = createRequire(import.meta.url);
function configFor(brand) {
  const context = {
    module: { exports: {} },
    __dirname: desktop,
    require(name) {
      return name.includes("branding/load") ? { loadBrand: () => brand } : require(name);
    },
  };
  vm.runInNewContext(readFileSync(path.join(desktop, "electron-builder.cjs"), "utf8"), context);
  return context.module.exports;
}
test("comparison packages separate identity and never publish or claim Tauri links", () => {
  const config = configFor({
    name: "Sample",
    id: "sample",
    artifactPrefix: "Sample",
    applicationId: "app.sample",
    publisher: "Sample",
  });
  assert.equal(config.appId, "app.sample.electron");
  assert.equal(config.productName, "Sample Electron");
  assert.match(config.artifactName, /^Sample-Electron-/);
  assert.equal(config.publish, null);
  assert.equal(config.win.icon, path.join(root, ".generated/branding/icons/icon.ico"));
  assert.equal(config.mac.icon, path.join(root, ".generated/branding/icons/icon.icns"));
  assert.equal(config.protocols, undefined);
  assert.deepEqual(Array.from(config.extraResources, (item) => item.to).sort(), [
    "app-dist",
    "brand.json",
    "icon.png",
  ]);
  assert.ok(config.win.target.includes("nsis"));
  assert.ok(config.win.target.includes("zip"));
  assert.ok(config.mac.target.includes("dmg"));
  assert.ok(config.linux.target.includes("AppImage"));
});
test("root aliases default to Electron and preserve Tauri comparison commands", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(scripts["dev:desktop"], /@fde\/desktop-electron/);
  assert.match(scripts["build:desktop"], /@fde\/desktop-electron/);
  assert.match(scripts["dev:desktop:tauri"], /@fde\/desktop --/);
  assert.match(scripts["build:desktop:tauri:win"], /@fde\/desktop/);
});
