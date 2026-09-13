import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const root = path.resolve(import.meta.dirname, "../..");
const { renderWindowsInstaller, nsisString, installDirectoryName } = await tsImport(
  "./branding/windows-installer.mts",
  import.meta.url,
);
const { resolveBrandManifest } = await tsImport(
  "../../packages/branding/src/schema.ts",
  import.meta.url,
);
const stockDirectory = (await import("node:fs")).existsSync(path.join(root, "brands/frogg"))
  ? "brands/frogg"
  : "brands/fde";

async function render(brandDirectory) {
  const directory = path.join(root, brandDirectory);
  const manifest = JSON.parse(await readFile(path.join(directory, "brand.json"), "utf8"));
  const brand = resolveBrandManifest(manifest);
  const output = await mkdtemp(path.join(tmpdir(), "windows-installer-"));
  const files = await renderWindowsInstaller(
    brand,
    path.resolve(directory, manifest.assets.icon),
    output,
  );
  const contents = Object.fromEntries(
    await Promise.all(files.map(async (file) => [path.basename(file), await readFile(file)])),
  );
  return { brand, output, contents };
}

test("a non-default brand produces different Windows installer assets", async () => {
  const stock = await render(stockDirectory);
  const custom = await render("brands/example");
  try {
    assert.deepEqual(Object.keys(custom.contents).sort(), Object.keys(stock.contents).sort());
    // The template is shared; everything brand-specific must differ.
    assert.equal(
      custom.contents["installer.nsh"].toString(),
      stock.contents["installer.nsh"].toString(),
    );
    for (const name of Object.keys(stock.contents).filter((file) => file !== "installer.nsh"))
      assert.notDeepEqual(custom.contents[name], stock.contents[name], name);
    const defines = custom.contents["brand.nsh"].toString();
    assert.match(defines, /!define BRAND_INSTALLER_NAME "Acme Studio"/);
    assert.match(defines, /!define BRAND_INSTALLER_COPY_READY "Acme Studio is ready"/);
    assert.match(defines, /!define BRAND_INSTALLER_COLORREF_ACCENT "0x00FDB5C4"/);
    assert.equal(defines.includes(`"${stock.brand.name}"`), false);
    const bitmap = custom.contents["background-200.bmp"];
    assert.equal(bitmap.toString("ascii", 0, 2), "BM");
    assert.equal(bitmap.readInt32LE(18), 880);
  } finally {
    await rm(stock.output, { recursive: true, force: true });
    await rm(custom.output, { recursive: true, force: true });
  }
});

test("the installer template carries no product strings or colours", async () => {
  const template = await readFile(
    path.join(root, "packages/branding/templates/windows-installer.nsh"),
    "utf8",
  );
  const stock = resolveBrandManifest(
    JSON.parse(await readFile(path.join(root, stockDirectory, "brand.json"), "utf8")),
  );
  const forbidden = [
    stock.name,
    stock.publisher,
    "frogg",
    ...Object.values(stock.installer.colors).map((color) => color.slice(1)),
  ];
  for (const value of forbidden) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(template, new RegExp(`\\b${escaped}\\b`, "i"), value);
  }
});

test("brand text is escaped for NSIS string literals", () => {
  assert.equal(nsisString('Say "hi" for $5 `now`'), 'Say $\\"hi$\\" for $$5 $\\`now$\\`');
  assert.equal(installDirectoryName({ name: "Acme Studio", id: "acme" }), "Acme Studio");
  assert.equal(installDirectoryName({ name: "Acmé: Studio", id: "acme" }), "acme");
});
