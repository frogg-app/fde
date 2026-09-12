import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, copyFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const selected = process.env.FDE_BRAND_DIR ?? "brands/fde";
const scratch = await mkdtemp(path.join(os.tmpdir(), "brand acceptance "));
function prepare(directory) {
  execFileSync(
    process.execPath,
    ["--import", "tsx", "scripts/dev/brand.mts", "prepare", "--brand", directory],
    { cwd: root, stdio: "pipe" },
  );
}
async function resolved() {
  return JSON.parse(await readFile(path.join(root, ".generated/branding/brand.json"), "utf8"));
}
async function fingerprint() {
  return (await readFile(path.join(root, ".generated/branding/fingerprint"), "utf8")).trim();
}
const before = execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root });
try {
  prepare(selected);
  const initial = await fingerprint();
  prepare(selected);
  assert.equal(await fingerprint(), initial, "repeated generation is deterministic");
  await copyFile(path.join(root, "brands/example/icon.svg"), path.join(scratch, "icon.svg"));
  const manifest = {
    schemaVersion: 1,
    id: "atlas",
    name: "株式会社 Atlas Studio",
    applicationId: "com.atlas.studio",
    daemonPort: 11099,
    assets: { icon: "./icon.svg" },
  };
  await writeFile(path.join(scratch, "brand.json"), JSON.stringify(manifest));
  prepare(scratch);
  const b = await resolved();
  assert.equal(b.name, manifest.name);
  assert.equal(b.homeDir, ".atlas");
  assert.equal(b.scheme, "atlas");
  assert.equal(b.distribution.updateMode, "disabled");
  assert.equal(b.services.pairingUrl, null);
  assert.equal(b.services.relayEndpoint, null);
  const nativeBefore = JSON.parse(
    await readFile(path.join(root, ".generated/branding/tauri.conf.json"), "utf8"),
  );
  assert.equal(nativeBefore.productName, manifest.id, "native package identity is stable");
  manifest.name = "新しい Atlas Studio";
  manifest.publisher = "A different publisher";
  await writeFile(path.join(scratch, "brand.json"), JSON.stringify(manifest));
  prepare(scratch);
  const nativeAfter = JSON.parse(
    await readFile(path.join(root, ".generated/branding/tauri.conf.json"), "utf8"),
  );
  assert.equal(nativeAfter.productName, nativeBefore.productName);
  assert.equal(nativeAfter.identifier, nativeBefore.identifier);
  assert.equal(nativeAfter.mainBinaryName, nativeBefore.mainBinaryName);
  const installer = await readFile(nativeAfter.bundle.windows.nsis.template, "utf8");
  assert.ok(installer.includes("Uninstall\\${BUNDLEID}"));
  assert.ok(installer.includes("$LOCALAPPDATA\\${BUNDLEID}"));
  assert.equal(nativeAfter.bundle.shortDescription, manifest.name);
  const previous = await fingerprint();
  const artwork = await readFile(path.join(scratch, "icon.svg"), "utf8");
  await writeFile(
    path.join(scratch, "icon.svg"),
    artwork.replace("</svg>", "<!-- changed artwork revision --></svg>"),
  );
  prepare(scratch);
  assert.notEqual(await fingerprint(), previous, "artwork changes invalidate outputs");
  const sentinel = path.join(root, ".generated/branding/stale-file");
  await writeFile(sentinel, "old brand asset");
  prepare(selected);
  await assert.rejects(access(sentinel));
  assert.equal(await fingerprint(), initial, "switching back restores the original build inputs");
  assert.deepEqual(
    execFileSync("git", ["diff", "--binary", "HEAD"], { cwd: root }),
    before,
    "preparation must leave tracked source untouched",
  );
  console.log(
    "Brand generation: deterministic, isolated, Unicode/space paths, artwork invalidation, and clean source verified.",
  );
} finally {
  prepare(selected);
  await rm(scratch, { recursive: true, force: true });
}
