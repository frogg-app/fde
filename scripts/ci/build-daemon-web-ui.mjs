import { portableCommand } from "../dev/npm-command.mjs";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { constants as zlibConstants, createBrotliCompress, createGzip } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const APP_DIR = path.join(REPO_ROOT, "apps", "ui");
const SOURCE_DIST = path.join(APP_DIR, "dist");
const TARGET_DIST = path.join(REPO_ROOT, "packages", "server", "dist", "server", "web-ui");
const COMPRESS_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg", ".map"]);

function fmtMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const invocation = portableCommand(command, args);
    const child = spawn(invocation.command, invocation.args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
        return;
      }
      resolve();
    });
  });
}

async function exportBrowserWebApp() {
  console.log("Exporting browser web app...");
  await run(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "build:web", "--workspace=@fde/app"],
    {
      cwd: REPO_ROOT,
    },
  );
}

async function cleanTarget(targetDist) {
  console.log(`Cleaning ${path.relative(REPO_ROOT, targetDist)}...`);
  await rm(targetDist, { recursive: true, force: true });
  await mkdir(targetDist, { recursive: true });
}

async function copyAssets(sourceDist, targetDist) {
  console.log(`Copying assets to ${path.relative(REPO_ROOT, targetDist)}...`);
  await cp(sourceDist, targetDist, { recursive: true, force: true });
}

async function compressFile(filePath) {
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;
  await Promise.all([
    pipeline(
      createReadStream(filePath),
      createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: zlibConstants.BROTLI_MAX_QUALITY,
        },
      }),
      createWriteStream(brotliPath),
    ),
    pipeline(createReadStream(filePath), createGzip(), createWriteStream(gzipPath)),
  ]);
}

async function precompressAssets(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const dirs = entries.filter((entry) => entry.isDirectory());

  for (const file of files) {
    const filePath = path.join(dir, file.name);
    if (COMPRESS_EXTENSIONS.has(path.extname(file.name).toLowerCase())) {
      await compressFile(filePath);
    }
  }

  for (const subdir of dirs) {
    await precompressAssets(path.join(dir, subdir.name));
  }
}

async function measureBundle(dir) {
  let raw = 0;
  let gzip = 0;
  let brotli = 0;

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      const info = await stat(entryPath);
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".br") {
        brotli += info.size;
      } else if (ext === ".gz") {
        gzip += info.size;
      } else {
        raw += info.size;
      }
    }
  }

  await walk(dir);
  return { raw, gzip, brotli };
}

/** Package a fresh web export; CI restores it from this run's ui-dist artifact. */
export async function packageDaemonWebUi(
  sourceDist = SOURCE_DIST,
  targetDist = TARGET_DIST,
  expectedFingerprint,
) {
  const sourceStat = await stat(sourceDist).catch(() => null);
  if (!sourceStat?.isDirectory()) {
    throw new Error(`Browser web export not found at ${sourceDist}`);
  }
  // Validate before clearing a previous package, including an empty/broken artifact.
  await stat(path.join(sourceDist, "index.html"));
  if (expectedFingerprint) {
    const stamp = JSON.parse(await readFile(path.join(sourceDist, "brand-build.json"), "utf8"));
    if (stamp.configFingerprint !== expectedFingerprint) {
      throw new Error(
        "Shared web export has stale or different branding; rebuild the UI for the selected brand.",
      );
    }
  }
  await cleanTarget(targetDist);
  await copyAssets(sourceDist, targetDist);
  await precompressAssets(targetDist);
  return measureBundle(targetDist);
}

async function main() {
  const { values } = parseArgs({ options: { "skip-export": { type: "boolean", default: false } } });
  if (!values["skip-export"]) await exportBrowserWebApp();
  const provenance = JSON.parse(
    await readFile(path.join(REPO_ROOT, ".generated/branding/provenance.json"), "utf8"),
  );
  const sizes = await packageDaemonWebUi(SOURCE_DIST, TARGET_DIST, provenance.configFingerprint);
  console.log("Daemon web UI bundle:");
  console.log(`  raw:    ${fmtMiB(sizes.raw)}`);
  console.log(`  gzip:   ${fmtMiB(sizes.gzip)}`);
  console.log(`  brotli: ${fmtMiB(sizes.brotli)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
