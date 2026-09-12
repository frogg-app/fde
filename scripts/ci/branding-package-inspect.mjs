// Inspect actual native packages; interactive/device acceptance remains a separate check.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadBrand } from "../dev/branding/load.cjs";
const brand = loadBrand();
const root = path.resolve("apps/desktop/src-tauri/target/release");
const installName = brand.legacyFde ? brand.name : brand.id;
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const binary = path.join(
  root,
  brand.desktopBinaryName + (process.platform === "win32" ? ".exe" : ""),
);
assert.ok(existsSync(binary), "the selected desktop executable was produced");
if (process.platform === "linux") {
  const directory = path.join(root, "bundle/deb");
  const packages = (await readdir(directory)).filter(
    (name) => name.endsWith(".deb") && name.includes(`_${version}_`),
  );
  assert.equal(packages.length, 1);
  const archive = path.join(directory, packages[0]);
  const pkg = execFileSync("dpkg-deb", ["-f", archive, "Package"], { encoding: "utf8" }).trim();
  assert.equal(pkg, brand.legacyFde ? "fde" : brand.id);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "brand-package-"));
  try {
    execFileSync("dpkg-deb", ["-x", archive, scratch]);
    const entry = await readFile(
      path.join(scratch, `usr/share/applications/${installName}.desktop`),
      "utf8",
    );
    assert.ok(entry.includes(`Name=${brand.name.replaceAll("\\", "\\\\")}\n`));
    assert.ok(
      entry.includes(`Exec=/usr/bin/${brand.desktopBinaryName} %U\n`),
      "launches the desktop directly and forwards URLs",
    );
    assert.ok(entry.includes(`x-scheme-handler/${brand.scheme};`));
    if (!brand.distribution.releaseBase) {
      const resources = path.join(scratch, `usr/lib/${installName}/daemon-bundle`);
      const daemon = (await readdir(resources)).find((name) => name.endsWith(".tar.gz"));
      assert.ok(daemon, "offline distributions embed their local daemon");
      const manifest = JSON.parse(
        execFileSync(
          "tar",
          ["-xOf", path.join(resources, daemon), `${daemon.slice(0, -7)}/manifest.json`],
          { encoding: "utf8" },
        ),
      );
      assert.equal(manifest.brand.id, brand.id);
      assert.equal(manifest.brand.applicationId, brand.applicationId);
      assert.equal(manifest.version, version);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} else if (process.platform === "darwin") {
  const plist = path.join(root, `bundle/macos/${installName}.app/Contents/Info.plist`);
  const field = (key) =>
    execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" }).trim();
  assert.equal(field("CFBundleIdentifier"), brand.applicationId);
  assert.equal(field("CFBundleDisplayName"), brand.name);
  assert.equal(field("CFBundleExecutable"), brand.desktopBinaryName);
} else if (process.platform === "win32") {
  const installers = await readdir(path.join(root, "bundle/nsis"));
  assert.ok(
    installers.some(
      (name) => name.startsWith(`${installName}_${version}_`) && name.endsWith("-setup.exe"),
    ),
  );
}
console.log(`${brand.name}: native package identity, executable, and platform metadata verified`);
