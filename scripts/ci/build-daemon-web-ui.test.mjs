import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { packageDaemonWebUi } from "./build-daemon-web-ui.mjs";

test("packages a shared export with intact assets and valid compressed representations", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fde-web-package-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(join(source, "assets"), { recursive: true });
  await mkdir(target);
  await writeFile(join(source, "index.html"), "<html>Current UI</html>");
  await writeFile(join(source, "assets", "app.js"), "console.log('current UI');");
  const binary = Buffer.from([0, 1, 2, 255]);
  await writeFile(join(source, "assets", "icon.png"), binary);
  await writeFile(join(target, "stale.js"), "old");
  const sizes = await packageDaemonWebUi(source, target);
  for (const file of ["index.html", "assets/app.js"]) {
    const original = await readFile(join(source, file));
    assert.deepEqual(await readFile(join(target, file)), original);
    assert.deepEqual(gunzipSync(await readFile(join(target, `${file}.gz`))), original);
    assert.deepEqual(brotliDecompressSync(await readFile(join(target, `${file}.br`))), original);
  }
  assert.deepEqual(await readFile(join(target, "assets/icon.png")), binary);
  await assert.rejects(readFile(join(target, "stale.js")), { code: "ENOENT" });
  assert.equal(sizes.raw, 23 + 26 + binary.length);
});

test("rejects a missing or incomplete shared export before removing the previous package", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "fde-web-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(target);
  await writeFile(join(target, "index.html"), "Previous UI");
  await assert.rejects(packageDaemonWebUi(source, target), /export not found/);
  await mkdir(source);
  await assert.rejects(packageDaemonWebUi(source, target), { code: "ENOENT" });
  assert.equal(await readFile(join(target, "index.html"), "utf8"), "Previous UI");
});
