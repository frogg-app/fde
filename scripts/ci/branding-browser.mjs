// Runs on browser-capable CI runners; never installs a browser on the shared VM.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadBrand } from "../dev/branding/load.cjs";
const brand = loadBrand();
const directory = path.resolve("apps/ui/dist");
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(
      directory,
      "." + decodeURIComponent(new URL(req.url, "http://test.invalid").pathname),
    );
    if (!file.startsWith(directory + path.sep) && file !== directory) {
      res.writeHead(403).end();
      return;
    }
    if (!(await stat(file).catch(() => null))?.isFile()) file = path.join(directory, "index.html");
    res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage();
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
  assert.deepEqual(errors, [], "no startup errors");
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, undefined, {
    timeout: 20000,
  });
  assert.ok((await page.title()).includes(brand.name));
  assert.ok(
    (await page.locator("body").innerText()).trim().length > 20,
    "the app renders usable content",
  );
  await mkdir(".generated/browser", { recursive: true });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.screenshot({
      path: `.generated/browser/${brand.id}-${colorScheme}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `.generated/browser/${brand.id}-narrow.png`, fullPage: true });
  assert.deepEqual(errors, [], "no uncaught browser errors");
  console.log(`${brand.name}: browser rendering, title, themes, and narrow viewport verified`);
} catch (error) {
  await mkdir(".generated/browser", { recursive: true });
  await page.screenshot({ path: `.generated/browser/${brand.id}-failure.png`, fullPage: true });
  console.error({ startupErrors: errors, body: await page.locator("body").innerText() });
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
