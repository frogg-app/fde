import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DAEMON_WORKSPACES } from "../release/build-daemon-bundle.mjs";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const jobs = new Map(
  workflow.split(/(?=^  [\w-]+:\n)/m).flatMap((section) => {
    const name = /^  ([\w-]+):\n/.exec(section)?.[1];
    return name ? [[name, section]] : [];
  }),
);

function ancestors(name, visited = new Set()) {
  assert.ok(jobs.has(name), `Missing release job: ${name}`);
  const needs = /^    needs: (.+)$/m.exec(jobs.get(name))?.[1];
  if (!needs) return visited;
  for (const parent of needs
    .replaceAll("[", "")
    .replaceAll("]", "")
    .split(",")
    .map((value) => value.trim())) {
    if (visited.has(parent)) continue;
    visited.add(parent);
    ancestors(parent, visited);
  }
  return visited;
}

test("daemon availability is independent of Android and desktop build outcomes", () => {
  const parents = ancestors("daemon-bundle");
  assert.equal(parents.has("android"), false);
  assert.equal(parents.has("desktop"), false);
  assert.equal(parents.has("daemon-build"), true);
  assert.equal(parents.has("ui"), true);
  assert.equal(ancestors("desktop").has("daemon-build"), false);
});

test("all daemon workspace output is shared and bundle jobs never rebuild the web UI", () => {
  const build = jobs.get("daemon-build");
  const bundle = jobs.get("daemon-bundle");
  assert.match(build, /uses: \.\/\.github\/actions\/select-brand/);
  assert.match(build, /name: ui-dist/);
  assert.match(build, /build:daemon-web-ui -- --skip-export/);
  assert.match(build, /name: daemon-dist/);
  for (const workspace of DAEMON_WORKSPACES)
    assert.ok(build.includes(`${workspace}/dist`), workspace);
  assert.match(bundle, /name: daemon-dist\n\s+path: \./);
  assert.doesNotMatch(bundle, /npm run build:server|npm run build:daemon-web-ui|npm run build:ui/);
});
