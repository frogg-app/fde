#!/usr/bin/env node
// Local stand-in for the CI gate: the same checks, run in parallel on all cores, so a
// developer gets the answer in a couple of minutes instead of waiting on a hosted runner.
//
//   npm run verify                    format, lint, typecheck, unit tests
//   npm run verify -- --fast          format, lint, typecheck only
//   npm run verify -- --changed       only the checks your changed files can break
//   npm run verify -- --changed=main  compare against a different base ref
import { spawn } from "node:child_process";
import os from "node:os";
import { changedFiles, defaultBase, hasScript, workspacesFor } from "./changed-files.mjs";

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const changedArg = argv.find((arg) => arg === "--changed" || arg.startsWith("--changed="));

const FORMAT_EXTENSIONS = /\.(css|js|json|jsonc|jsx|md|ts|tsx|yaml|yml)$/u;
const LINT_EXTENSIONS = /\.(js|jsx|mjs|cjs|ts|tsx)$/u;

// Unit-test entrypoint per workspace. `test` is the whole suite for several workspaces —
// including integration and cargo legs — so name the narrow script where one exists.
const UNIT_TESTS = {
  "@fde/server": ["npm", ["run", "test:unit", "--workspace=@fde/server"]],
  "@fde/cli": ["npm", ["run", "test:unit", "--workspace=@fde/cli"]],
};

function unitTestJob(workspace) {
  const named = UNIT_TESTS[workspace];
  if (named) return named;
  if (!hasScript(workspace, "test")) return null;
  return ["npm", ["run", "test", `--workspace=${workspace}`]];
}

function fullJobs() {
  return [
    ["format", "npx", ["oxfmt", "--check", "."]],
    ["lint", "npx", ["oxlint", "."]],
    ["typecheck", "npm", ["run", "typecheck"]],
    ...(fast
      ? []
      : [
          ["scripts", "npm", ["run", "test:scripts"]],
          [
            "server",
            "npx",
            ["vitest", "run", "--root", "packages/server", "--exclude", "**/*.e2e.test.ts"],
          ],
          ["ui", "npm", ["run", "test", "--workspace=@fde/app"]],
          ["cli", "npm", ["run", "test:unit", "--workspace=@fde/cli"]],
          ["protocol", "npx", ["vitest", "run", "--root", "packages/protocol"]],
        ]),
  ];
}

function changedJobs(base) {
  const files = changedFiles(base);
  if (files.length === 0) return { files, jobs: [] };

  const jobs = [];
  const formattable = files.filter((file) => FORMAT_EXTENSIONS.test(file));
  if (formattable.length > 0) jobs.push(["format", "npx", ["oxfmt", "--check", ...formattable]]);

  const lintable = files.filter((file) => LINT_EXTENSIONS.test(file));
  if (lintable.length > 0) jobs.push(["lint", "npx", ["oxlint", ...lintable]]);

  for (const workspace of workspacesFor(files)) {
    if (hasScript(workspace, "typecheck")) {
      jobs.push([
        `typecheck ${workspace}`,
        "npm",
        ["run", "typecheck", `--workspace=${workspace}`],
      ]);
    }
    if (fast) continue;
    const unit = unitTestJob(workspace);
    if (unit) jobs.push([`test ${workspace}`, ...unit]);
  }

  const touchesScripts = files.some((file) => /^scripts\/(ci|release)\//u.test(file));
  if (touchesScripts && !fast) jobs.push(["scripts", "npm", ["run", "test:scripts"]]);

  return { files, jobs };
}

let jobs;
if (changedArg) {
  const base = changedArg.includes("=") ? changedArg.split("=")[1] : defaultBase();
  const changed = changedJobs(base);
  jobs = changed.jobs;
  console.log(`verify: ${changed.files.length} changed files against ${base}`);
  if (jobs.length === 0) {
    console.log("verify: nothing changed that these checks can catch");
    process.exit(0);
  }
} else {
  jobs = fullJobs();
}

const started = Date.now();
console.log(`verify: ${jobs.length} checks on ${os.cpus().length} cores\n`);

const results = await Promise.all(
  jobs.map(
    ([name, cmd, args]) =>
      new Promise((resolve) => {
        const at = Date.now();
        const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.on("close", (code) => {
          const secs = ((Date.now() - at) / 1000).toFixed(0);
          console.log(`${code === 0 ? "PASS" : "FAIL"}  ${name} (${secs}s)`);
          resolve({ name, code, output });
        });
      }),
  ),
);

const failed = results.filter((result) => result.code !== 0);
for (const result of failed) {
  console.log(`\n----- ${result.name} -----\n${result.output.trimEnd()}`);
}
console.log(
  `\nverify: ${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`,
);
process.exit(failed.length === 0 ? 0 : 1);
