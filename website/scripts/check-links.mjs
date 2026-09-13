// Checks every internal link and asset reference in dist/ resolves to a built file,
// and that #fragments point at an element id. External links are not fetched.
// Usage: npm run build && npm run linkcheck
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "..", "dist");
if (!existsSync(dist)) {
  console.error("dist/ not found. Run `npm run build` first.");
  process.exit(2);
}

const htmlFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".html")) htmlFiles.push(full);
  }
})(dist);

const idCache = new Map();
function idsOf(file) {
  if (!idCache.has(file)) {
    const html = readFileSync(file, "utf8");
    idCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idCache.get(file);
}

function resolveTarget(urlPath) {
  const clean = decodeURIComponent(urlPath).replace(/^\//, "");
  const candidates = [
    path.join(dist, clean),
    path.join(dist, clean, "index.html"),
    path.join(dist, `${clean.replace(/\/$/, "")}.html`),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

// Paths served by other Workers on the same zone (deploy/install-worker).
const externalRoutes = new Set(["/install.sh", "/uninstall.sh", "/install-docker.sh"]);

const problems = [];
let checked = 0;
for (const file of htmlFiles) {
  if (path.basename(file) === "404.html" && file !== path.join(dist, "404.html")) continue;
  const html = readFileSync(file, "utf8");
  const page = "/" + path.relative(dist, file).replace(/index\.html$/, "").replace(/\\/g, "/");
  for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = match[1].replaceAll("&amp;", "&");
    if (/^(?:[a-z]+:|\/\/)/i.test(raw) || raw.startsWith("data:")) continue;
    const url = new URL(raw, `https://frogg.app${page}`);
    if (externalRoutes.has(url.pathname)) continue;
    checked++;
    const target = resolveTarget(url.pathname);
    if (!target) {
      problems.push(`${page}  ->  ${raw}  (missing page or asset)`);
      continue;
    }
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (fragment && target.endsWith(".html") && !idsOf(target).has(fragment)) {
      problems.push(`${page}  ->  ${raw}  (no element with id "${fragment}")`);
    }
  }
}

const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`Broken internal links (${unique.length}):\n  ${unique.join("\n  ")}`);
  process.exit(1);
}
console.log(`Link check passed: ${checked} internal references across ${htmlFiles.length} pages.`);
