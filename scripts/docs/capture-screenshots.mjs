#!/usr/bin/env node
// Captures documentation screenshots from a running daemon's web UI with headless
// Chromium, and renders real command output as terminal images.
//
// Usage:
//   node scripts/docs/capture-screenshots.mjs --url http://127.0.0.1:17900 [--only a,b] [--list]
//     [--out website/src/assets/docs] [--brand-tag frogg]
//
// Prerequisites (see skills/frogg-docs/SKILL.md, "Screenshots"):
//   - A daemon built from this checkout with its web UI (`npm run build:server &&
//     npm run build:daemon-web-ui`), started on its own port and FROGG_HOME with
//     `--web-ui`. Never point this at a daemon you did not start.
//   - For the workspace shots, a project with at least one agent. `--seed` creates
//     a demo git repository and project through the CLI; running the demo agent is
//     left to the operator because it spends provider credits.
//   - Playwright's Chromium (`npx playwright install chromium`).
//
// Images are written as optimised PNGs. Shots that need state the daemon does not
// have are skipped with a warning rather than captured half-rendered.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    url: { type: "string" },
    out: { type: "string", default: path.join(root, "website/src/assets/docs") },
    only: { type: "string" },
    "brand-tag": { type: "string", default: "frogg" },
    seed: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

const VIEWPORT = { width: 1280, height: 800 };
const MAX_BYTES = 300 * 1024;

/** Real command output rendered as a terminal image. Commands run from the repo root. */
const terminalShots = {
  "fork/brand-check": {
    title: "brand:check",
    commands: [
      ["npm", "run", "--silent", "brand:check", "--", "--brand", "brands/example"],
      ["npm", "run", "--silent", "brand:check", "--", "--brand", "brands/frogg"],
      [
        "npm",
        "run",
        "--silent",
        "brand:check",
        "--",
        "--brand",
        ".generated/docs-fixtures/reserved",
      ],
      [
        "npm",
        "run",
        "--silent",
        "brand:check",
        "--",
        "--brand",
        ".generated/docs-fixtures/low-contrast",
      ],
    ],
    setup: writeBrandFixtures,
  },
};

/** Web UI shots. `path` is relative to the daemon URL; `{serverId}` is substituted. */
const webShots = {
  "app/home": { path: "/" },
  "app/agent-timeline": {
    path: "/",
    steps: async (page) => {
      await clickText(page, "main");
      await page.keyboard.press("End");
    },
  },
  "app/hosts": { path: "/", steps: (page) => clickText(page, "Hosts") },
  "app/direct-connection": {
    path: "/",
    crop: "dialog",
    steps: async (page) => {
      await clickText(page, "Hosts");
      await clickText(page, "Direct connection");
    },
  },
  "app/settings-general": { path: "/settings", crop: "dialog" },
  "app/host-overview": { path: "/settings/hosts/{serverId}/host", crop: "dialog" },
  "app/host-providers": { path: "/settings/hosts/{serverId}/providers", crop: "dialog" },
  "app/pair-device": {
    path: "/settings/hosts/{serverId}/pair-device",
    crop: "dialog",
    steps: (page) => clickText(page, "Pair a device"),
  },
  "app/connections": { path: "/settings/hosts/{serverId}/connections", crop: "dialog" },
  "app/companion-settings": {
    path: "/settings",
    crop: "dialog",
    steps: async (page) => {
      await page.getByText("Enable Companion (preview)", { exact: true }).scrollIntoViewIfNeeded();
    },
  },
  "app/companion": {
    path: "/settings",
    crop: "dialog",
    steps: async (page) => {
      // Companion is off per device; enable it, then launch it from the composer.
      await page.getByText("Enable Companion (preview)", { exact: true }).scrollIntoViewIfNeeded();
      await page.getByRole("switch").last().click();
      await page.waitForTimeout(1000);
      await page.goto(new URL("/", page.url()).href, { waitUntil: "networkidle" });
      await page.waitForTimeout(3000);
      await clickText(page, "main");
      await page.getByLabel("Start Companion").click();
      await page.waitForTimeout(4000);
    },
  },
  "fork/home": { path: "/", file: (tag) => `fork/home-${tag}` },
};

if (values.list) {
  for (const name of [...Object.keys(terminalShots), ...Object.keys(webShots)]) console.log(name);
  process.exit(0);
}

const only = values.only ? new Set(values.only.split(",")) : null;
const wanted = (name) => !only || only.has(name);

async function main() {
  // Fake media devices let Companion open without a microphone on a headless host.
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  try {
    for (const [name, shot] of Object.entries(terminalShots)) {
      if (!wanted(name)) continue;
      await shot.setup?.();
      const transcript = shot.commands.map((argv) => runForTranscript(argv)).join("\n");
      await renderTerminal(browser, name, shot.title, transcript);
    }
    const webNames = Object.keys(webShots).filter(wanted);
    if (!webNames.length) return;
    if (!values.url) throw new Error("--url is required for web UI shots");
    const base = values.url.replace(/\/$/, "");
    const identity = await (await fetch(`${base}/api/identity`)).json();
    if (values.seed) seedDemoProject(base);
    for (const name of webNames) {
      const shot = webShots[name];
      const context = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: "dark",
        permissions: ["microphone"],
      });
      const page = await context.newPage();
      try {
        await page.goto(base + shot.path.replace("{serverId}", identity.serverId), {
          waitUntil: "networkidle",
        });
        await page.waitForTimeout(3500);
        if (shot.steps) {
          await shot.steps(page);
          await page.waitForTimeout(2500);
        }
        await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height / 2);
        await page.waitForTimeout(800);
        let clip;
        if (shot.crop === "dialog") {
          clip = (await page.locator('[role="dialog"]').last().boundingBox()) ?? undefined;
        }
        const buffer = await page.screenshot({ clip });
        const file = shot.file ? shot.file(values["brand-tag"]) : name;
        await writeImage(file, buffer);
      } catch (error) {
        console.warn(`skipped ${name}: ${error.message.split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function clickText(page, text) {
  await page.getByText(text, { exact: true }).first().click();
  await page.waitForTimeout(2500);
}

function runForTranscript(argv) {
  let output;
  try {
    output = execFileSync(argv[0], argv.slice(1), {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Keep only the final error line of a thrown stack; that is what a user acts on.
    const stderr = String(error.stderr ?? "");
    output = stderr.split("\n").find((line) => /^\w*Error:/.test(line)) ?? stderr.trim();
  }
  return `$ ${argv.join(" ")}\n${output.trimEnd()}`;
}

function writeBrandFixtures() {
  const fixtures = path.join(root, ".generated/docs-fixtures");
  const icon = "../../../brands/example/icon.svg";
  const base = { schemaVersion: 1, daemonPort: 11200, assets: { icon } };
  const manifests = {
    reserved: { ...base, id: "studio", name: "Studio", applicationId: "app.frogg.studio" },
    "low-contrast": {
      ...base,
      id: "dim",
      name: "Dim",
      applicationId: "com.example.dim",
      colors: {
        dark: {
          accent: "#3f3f46",
          accentForeground: "#27272a",
          background: "#18181b",
          foreground: "#fafafa",
        },
      },
    },
  };
  for (const [name, manifest] of Object.entries(manifests)) {
    mkdirSync(path.join(fixtures, name), { recursive: true });
    writeFileSync(path.join(fixtures, name, "brand.json"), JSON.stringify(manifest, null, 2));
  }
}

function seedDemoProject(base) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "frogg-docs-demo-"));
  const git = (...args) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  writeFileSync(path.join(repo, "README.md"), "# acme-api\n\nA tiny HTTP service.\n");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=Docs", "-c", "user.email=docs@example.com", "commit", "-qm", "Initial");
  const env = { ...process.env, FROGG_HOST: new URL(base).host };
  delete env.FROGG_AGENT_ID;
  execFileSync(
    process.execPath,
    [path.join(root, "apps/cli/bin/frogg"), "project", "create", repo],
    {
      env,
      stdio: "inherit",
    },
  );
  console.log(`Seeded demo project at ${repo}. Run an agent in it for the workspace shots.`);
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

async function renderTerminal(browser, name, title, transcript) {
  const renderLine = (line) => {
    if (line.startsWith("$ ")) {
      return `<span class="prompt">$</span> <span class="cmd">${escapeHtml(line.slice(2))}</span>`;
    }
    if (/Error/.test(line)) return `<span class="err">${escapeHtml(line)}</span>`;
    return escapeHtml(line);
  };
  const lines = transcript.split("\n").map(renderLine).join("\n");
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:transparent;font:14px/1.55 ui-monospace,"DejaVu Sans Mono",monospace}
    .win{display:inline-block;min-width:760px;background:#111413;color:#e4e4e7;border:1px solid #2a2f2d;border-radius:10px;overflow:hidden}
    .bar{background:#1b1f1e;color:#a1a1aa;padding:8px 14px;font-size:12px}
    pre{margin:0;padding:14px 18px;white-space:pre-wrap;max-width:1100px}
    .prompt{color:#25B5C8}.cmd{color:#fafafa}.err{color:#f87171}
  </style><div class="win"><div class="bar">${escapeHtml(title)}</div><pre>${lines}</pre></div>`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 400 } });
  try {
    await page.setContent(html);
    const buffer = await page.locator(".win").screenshot({ omitBackground: true });
    await writeImage(name, buffer);
  } finally {
    await page.close();
  }
}

async function writeImage(name, buffer) {
  const file = path.join(values.out, `${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  let output = await sharp(buffer).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  if (output.length > MAX_BYTES) {
    output = await sharp(buffer).png({ palette: true, quality: 90, effort: 10 }).toBuffer();
  }
  writeFileSync(file, output);
  console.log(`${path.relative(root, file)} ${(output.length / 1024).toFixed(0)} KiB`);
}

/** Side-by-side stock vs custom brand, once both home shots exist. */
async function composeBrandComparison() {
  const dir = path.join(values.out, "fork");
  const left = path.join(dir, "home-frogg.png");
  const right = path.join(dir, "home-acme.png");
  if (!existsSync(left) || !existsSync(right)) return;
  const width = 760;
  const height = Math.round((VIEWPORT.height / VIEWPORT.width) * width);
  const gap = 24;
  const pad = 20;
  const label = 44;
  const tile = async (file) => sharp(file).resize(width, height).png().toBuffer();
  const caption = (text, x) => ({
    input: Buffer.from(
      `<svg width="${width}" height="${label}"><text x="0" y="26" font-family="sans-serif" font-size="20" fill="#e4e4e7">${escapeHtml(text)}</text></svg>`,
    ),
    left: pad + x,
    top: pad,
  });
  const buffer = await sharp({
    create: {
      width: width * 2 + gap + pad * 2,
      height: height + label + pad * 2,
      channels: 4,
      background: "#111413",
    },
  })
    .composite([
      caption("Stock Frogg (brands/frogg)", 0),
      caption("Acme Studio (brands/example)", width + gap),
      { input: await tile(left), left: pad, top: pad + label },
      { input: await tile(right), left: pad + width + gap, top: pad + label },
    ])
    .png()
    .toBuffer();
  await writeImage("fork/stock-vs-acme", buffer);
}

await main();
await composeBrandComparison();
rmSync(path.join(root, ".generated/docs-fixtures"), { recursive: true, force: true });
