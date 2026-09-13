// Exercise actual distribution archives without installing services or touching user state.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { frogg: { type: "string" }, custom: { type: "string" } },
});
if (!values.frogg || !values.custom)
  throw new Error("Supply --frogg and --custom Linux daemon archives");
const scratch = await mkdtemp(path.join(os.tmpdir(), "brand runtime "));
const products = [];
const output = path.resolve(".generated/runtime-isolation");
await mkdir(output, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function cli(product, args, overrides = {}) {
  return execFileSync(product.node, [product.entry, ...args], {
    env: { ...product.env, ...overrides },
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
async function identity(product) {
  const response = await fetch(`http://127.0.0.1:${product.port}/api/identity`, {
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
try {
  for (const [id, archive] of [
    ["frogg", values.frogg],
    ["acme", values.custom],
  ]) {
    const directory = path.join(scratch, id);
    await mkdir(directory);
    execFileSync("tar", ["-xzf", path.resolve(archive), "--strip-components=1", "-C", directory]);
    const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.brand.id, id);
    const home = path.join(scratch, `${id} user`);
    const state = path.join(home, `.${id}`);
    await mkdir(home);
    const product = {
      id,
      port: await freePort(),
      state,
      node: path.join(directory, "node/bin/node"),
      entry: path.join(directory, "daemon/apps/cli/dist/index.js"),
      env: {
        ...process.env,
        HOME: home,
        [`${id.toUpperCase()}_HOME`]: state,
        CODEX_HOME: path.join(home, ".codex"),
        CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
        XDG_CONFIG_HOME: path.join(home, ".config"),
        XDG_DATA_HOME: path.join(home, ".local/share"),
        FROGG_DICTATION_ENABLED: "false",
        FROGG_VOICE_MODE_ENABLED: "false",
        FROGG_COMPANION_ENABLED: "false",
      },
    };
    product.log = createWriteStream(path.join(output, `${id}.log`));
    product.child = spawn(
      product.node,
      [
        product.entry,
        "daemon",
        "start",
        "--foreground",
        "--listen",
        `0.0.0.0:${product.port}`,
        "--no-relay",
        "--no-mcp",
        "--no-inject-mcp",
        "--web-ui",
      ],
      { env: product.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    product.child.stdout.pipe(product.log, { end: false });
    product.child.stderr.pipe(product.log, { end: false });
    products.push(product);
    let ready;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (product.child.exitCode !== null) throw new Error(`${id} exited before readiness`);
      try {
        ready = await identity(product);
        break;
      } catch {
        await pause(500);
      }
    }
    assert.equal(ready?.product, "frogg", "compatibility family remains stable");
    assert.equal(ready?.brand?.id, id);
    assert.equal(ready?.brand?.applicationId, manifest.brand.applicationId);
    const status = JSON.parse(cli(product, ["daemon", "status", "--json"]));
    assert.equal(status.localDaemon, "running");
    assert.ok(status.pid > 0);
    product.report = {
      identity: ready,
      pid: status.pid,
      port: product.port,
      version: manifest.version,
    };
    const html = await (await fetch(`http://127.0.0.1:${product.port}/`)).text();
    assert.ok(html.includes(ready.brand.name));
  }
  const [official, custom] = products;
  assert.notEqual(official.report.pid, custom.report.pid);
  assert.notEqual(official.port, custom.port);
  // Deliberately point the other product's management command at this product's home.
  assert.throws(
    () => cli(custom, ["daemon", "stop"], { ACME_HOME: official.state }),
    /another|brand|identity|different|Command failed/i,
  );
  assert.equal(
    (await identity(official)).brand.id,
    "frogg",
    "foreign management leaves the owner running",
  );
  cli(custom, ["daemon", "stop"]);
  for (let attempt = 0; attempt < 40 && custom.child.exitCode === null; attempt++) await pause(250);
  assert.notEqual(custom.child.exitCode, null, "custom foreground launcher exits after stop");
  assert.equal(
    (await identity(official)).brand.id,
    "frogg",
    "stopping one product leaves the other running",
  );
  const report = {
    products: products.map((p) => p.report),
    foreignManagementRejected: true,
    independentShutdown: true,
  };
  await writeFile(path.join(output, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const product of products.toReversed()) {
    if (product.child.exitCode === null) {
      try {
        cli(product, ["daemon", "stop"]);
      } catch {
        product.child.kill("SIGTERM");
      }
      for (let attempt = 0; attempt < 60 && product.child.exitCode === null; attempt++)
        await pause(250);
      if (product.child.exitCode === null) product.child.kill("SIGKILL");
    }
    product.log.end();
  }
  await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}
