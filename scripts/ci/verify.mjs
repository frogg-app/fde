#!/usr/bin/env node
// Local stand-in for the CI gate: the same checks, run in parallel on all cores, so a
// developer gets the answer in a couple of minutes instead of waiting on a hosted runner.
//
//   npm run verify           format, lint, typecheck, unit tests
//   npm run verify -- --fast format, lint, typecheck only
import { spawn } from "node:child_process";
import os from "node:os";

const fast = process.argv.includes("--fast");
const jobs = [
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
