#!/usr/bin/env node
// Build a desktop package with warm checkout-local caches and record each stage's duration.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

export function localBuildSteps(target) {
  if (!["windows", "linux"].includes(target)) {
    throw new Error(`Unsupported local desktop target: ${target} (use windows or linux)`);
  }
  const windows = target === "windows";
  const triple = windows ? "x86_64-pc-windows-msvc" : "x86_64-unknown-linux-gnu";
  const releaseDir = `apps/desktop/src-tauri/target/${triple}/release`;
  return [
    { name: "dependencies", command: "npm", args: ["run", "build:app-deps"] },
    {
      name: "web-ui",
      command: "npx",
      cwd: "apps/ui",
      args: ["--no-install", "expo", "export", "--platform", "web", "--max-workers", "1"],
    },
    {
      name: "web-stamp",
      command: "node",
      args: ["--import", "tsx", "scripts/dev/branding/build-output.mts", "stamp"],
    },
    {
      name: "desktop",
      command: "node",
      bundleDir: `${releaseDir}/bundle`,
      args: [
        "--import",
        "tsx",
        "scripts/dev/branded-run.mts",
        "tauri",
        "build",
        ...(windows ? ["--runner", "cargo-xwin"] : []),
        "--target",
        triple,
        "--bundles",
        windows ? "nsis" : "deb,appimage",
      ],
    },
    ...(windows
      ? [
          {
            name: "windows-zips",
            command: "node",
            args: ["scripts/release/package-windows-zips.mjs", "--release-dir", releaseDir],
          },
        ]
      : []),
    {
      name: "collect",
      command: "node",
      args: [
        "scripts/release/collect-desktop-bundles.mjs",
        "--platform",
        target,
        "--arch",
        "x86_64",
        "--release-dir",
        releaseDir,
      ],
    },
  ];
}

function createBuildReport(root, target, run) {
  const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const provenancePath = path.join(root, ".generated/branding/provenance.json");
  const provenance = existsSync(provenancePath)
    ? JSON.parse(readFileSync(provenancePath, "utf8"))
    : null;
  const startedAt = new Date().toISOString();
  const outputDir = path.join(
    root,
    ".dev",
    "builds",
    ...(provenance ? [provenance.brand.id] : []),
    `${target}-${version}`,
    startedAt.replaceAll(":", "-"),
  );
  mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "timings.json");
  const commit = run("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const sourceStatus = run("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const report = {
    target,
    version,
    brand: provenance?.brand ?? null,
    configFingerprint: provenance?.configFingerprint ?? null,
    dirty: sourceStatus.status === 0 ? Boolean(sourceStatus.stdout?.trim()) : null,
    commit: commit.status === 0 ? commit.stdout?.trim() : null,
    startedAt,
    status: "building",
    steps: [],
  };
  return { outputDir, reportPath, report };
}

export function runLocalBuild({ target, jobs, root = REPO_ROOT, run = spawnSync }) {
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error("--jobs must be a positive integer");
  const steps = localBuildSteps(target);
  const { outputDir, reportPath, report } = createBuildReport(root, target, run);
  const env = {
    ...process.env,
    CI: "true",
    CARGO_BUILD_JOBS: String(jobs),
    CARGO_TARGET_DIR: path.join(root, "apps/desktop/src-tauri/target"),
    ONNXRUNTIME_NODE_INSTALL: "skip",
  };
  const started = performance.now();
  try {
    for (const step of steps) {
      const args = step.name === "collect" ? [...step.args, "--out-dir", outputDir] : step.args;
      console.log(`\n[${step.name}] ${step.command} ${args.join(" ")}`);
      const stepStarted = performance.now();
      // Clear generated installers so collection cannot pick a previous version.
      // Cargo objects and dependency caches remain available for incremental builds.
      if (step.bundleDir) rmSync(path.join(root, step.bundleDir), { recursive: true, force: true });
      const result = run(step.command, args, {
        cwd: path.join(root, step.cwd ?? ""),
        env,
        stdio: "inherit",
      });
      report.steps.push({
        name: step.name,
        seconds: (performance.now() - stepStarted) / 1000,
        exitCode: result.status,
      });
      if (result.error || result.status !== 0) {
        throw result.error ?? new Error(`${step.name} failed (${result.signal ?? result.status})`);
      }
    }
    report.status = "success";
  } catch (error) {
    report.status = "failed";
    throw error;
  } finally {
    report.seconds = (performance.now() - started) / 1000;
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nBuild report: ${reportPath}`);
  }
  return { outputDir, report };
}

function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string", default: "windows" },
      jobs: { type: "string", default: "1" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npm run build:local -- --target windows|linux [--jobs 1]\nOutputs and timings: .dev/builds/<brand>/<target>-<version>/<timestamp>/\nUse a compatible Linux build container for portable Linux releases.",
    );
    return;
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      "This local cross-build command requires a Linux x64 host; use the native desktop build on other hosts.",
    );
  }
  if (!process.env.FROGG_BRAND_BUILD_OWNER) {
    throw new Error("Use npm run build:local so one selected brand is held for the entire build.");
  }
  runLocalBuild({ target: values.target, jobs: Number(values.jobs) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
