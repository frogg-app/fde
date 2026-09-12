import assert from "node:assert/strict";
import { test } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { localBuildSteps, runLocalBuild } from "./build-local.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "fde-local-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.3.2" }));
  return root;
}

test("local Windows builds refresh the UI before packaging and collect from the cross-build target", (t) => {
  const root = fixture(t);
  const release = path.join(root, "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release");
  mkdirSync(path.join(release, "bundle"), { recursive: true });
  writeFileSync(path.join(release, "bundle", "old-installer.exe"), "old");
  writeFileSync(path.join(release, "compiler-cache"), "cached");
  const calls = [];
  const { report, outputDir } = runLocalBuild({
    target: "windows",
    jobs: 1,
    root,
    run(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "commit-sha\n" };
    },
  });
  assert.equal(report.status, "success");
  assert.equal(existsSync(path.join(release, "bundle", "old-installer.exe")), false);
  assert.equal(readFileSync(path.join(release, "compiler-cache"), "utf8"), "cached");
  assert.equal(report.commit, "commit-sha");
  assert.deepEqual(
    report.steps.map((step) => step.name),
    ["dependencies", "web-ui", "desktop", "windows-zips", "collect"],
  );
  const desktop = calls.find((call) => call.command === "cargo");
  assert.equal(desktop.options.env.CARGO_BUILD_JOBS, "1");
  assert.equal(desktop.options.env.CI, "true");
  assert.ok(desktop.args.includes("cargo-xwin"));
  const collect = calls.at(-1);
  assert.equal(
    collect.args[collect.args.indexOf("--release-dir") + 1],
    "apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release",
  );
  assert.equal(collect.args.at(-1), outputDir);
  assert.equal(JSON.parse(readFileSync(path.join(outputDir, "timings.json"))).status, "success");
});

test("failed compilation writes a failed timing report and never packages stale binaries", (t) => {
  const root = fixture(t);
  const calls = [];
  assert.throws(
    () =>
      runLocalBuild({
        target: "windows",
        jobs: 1,
        root,
        run(command) {
          calls.push(command);
          return { status: command === "cargo" ? 1 : 0, stdout: "sha" };
        },
      }),
    /desktop failed/,
  );
  assert.equal(calls.at(-1), "cargo");
  const parent = path.join(root, ".dev/builds/windows-0.3.2");
  const report = JSON.parse(
    readFileSync(path.join(parent, readdirSync(parent)[0], "timings.json")),
  );
  assert.equal(report.status, "failed");
  assert.equal(report.steps.at(-1).exitCode, 1);
  assert.throws(() => localBuildSteps("macos"), /Unsupported/);
});
