// Inspect actual Electron package identity and app-only resources.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadBrand } from "../dev/branding/load.cjs";
const brand = loadBrand();
const root = path.resolve("apps/desktop-electron/release");
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const platform = process.platform === "win32" ? "win" : process.platform;
let folder = platform === "win" ? "win-unpacked" : "linux-unpacked";
if (platform === "darwin") folder = process.arch === "arm64" ? "mac-arm64" : "mac";
const application =
  platform === "darwin"
    ? path.join(root, folder, `${brand.name}.app`, "Contents")
    : path.join(root, folder);
const resources = path.join(application, platform === "darwin" ? "Resources" : "resources");
const plist = path.join(application, "Info.plist");
const executableName =
  platform === "darwin"
    ? execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", plist], {
        encoding: "utf8",
      }).trim()
    : brand.id;
assert.ok(
  executableName && path.basename(executableName) === executableName,
  "selected desktop executable name is a basename",
);
const binary =
  platform === "darwin"
    ? path.join(application, "MacOS", executableName)
    : path.join(application, `${brand.id}${platform === "win" ? ".exe" : ""}`);
assert.ok(existsSync(binary), "selected desktop executable was produced");
assert.ok(existsSync(path.join(resources, "app.asar")));
assert.ok(existsSync(path.join(resources, "app-dist")));
assert.equal(existsSync(path.join(resources, "daemon-bundle")), false);
const packaged = JSON.parse(await readFile(path.join(resources, "brand.json"), "utf8"));
assert.equal(packaged.id, brand.id);
assert.equal(packaged.applicationId, brand.applicationId);
const artifacts = await readdir(root);
assert.ok(artifacts.some((name) => name.startsWith(`${brand.artifactPrefix}-${version}-`)));
if (platform === "darwin") {
  const id = execFileSync("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", plist], {
    encoding: "utf8",
  }).trim();
  assert.equal(id, brand.applicationId);
}
console.log(`${brand.name}: Electron package identity and app-only resources verified`);
