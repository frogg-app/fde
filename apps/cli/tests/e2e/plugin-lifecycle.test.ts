#!/usr/bin/env npx tsx

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { connectToDaemon } from "../../src/utils/client.ts";
import { createE2ETestContext } from "../helpers/test-daemon.ts";

const pluginSource = `export default function contribute(plugin: unknown) {
  void plugin;
  return () => undefined;
}`;

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function main(): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "fde-plugin-cli-e2e-"));
  const gitDirectory = await mkdtemp(path.join(tmpdir(), "fde-plugin-git-cli-e2e-"));
  const context = await createE2ETestContext({ timeout: 45_000 });
  try {
    await writeFile(path.join(directory, "fde-plugin.json"), JSON.stringify({ id: "cli-e2e" }));
    await writeFile(path.join(directory, "index.tsx"), pluginSource);

    const install = await context.fde(["plugin", "install", directory, "--json"]);
    assert.equal(install.exitCode, 0, install.stderr);
    assert.equal(JSON.parse(install.stdout).id, "cli-e2e");

    const client = await connectToDaemon({ host: `127.0.0.1:${context.port}` });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.close();

    await git(gitDirectory, ["init", "-b", "main"]);
    await git(gitDirectory, ["config", "user.name", "Fde Tests"]);
    await git(gitDirectory, ["config", "user.email", "fde@example.test"]);
    await writeFile(
      path.join(gitDirectory, "fde-plugin.json"),
      JSON.stringify({ id: "git-cli-e2e" }),
    );
    await writeFile(path.join(gitDirectory, "index.ts"), pluginSource);
    await git(gitDirectory, ["add", "-A"]);
    await git(gitDirectory, ["commit", "-m", "initial"]);

    const gitInstall = await context.fde([
      "plugin",
      "add",
      pathToFileURL(gitDirectory).href,
      "--json",
    ]);
    assert.equal(gitInstall.exitCode, 0, gitInstall.stderr);
    assert.equal(JSON.parse(gitInstall.stdout).source, "git");

    await writeFile(
      path.join(gitDirectory, "index.ts"),
      `${pluginSource}\nconst updated = true;\n`,
    );
    await git(gitDirectory, ["add", "-A"]);
    await git(gitDirectory, ["commit", "-m", "update"]);
    const status = await context.fde(["plugin", "status", "git-cli-e2e", "--json"]);
    assert.equal(status.exitCode, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout)[0].updateAvailable, true);

    const update = await context.fde(["plugin", "update", "git-cli-e2e", "--json"]);
    assert.equal(update.exitCode, 0, update.stderr);
    assert.equal(JSON.parse(update.stdout)[0].updated, true);

    const reload = await context.fde(["plugin", "reload", "cli-e2e", "--json"]);
    assert.equal(reload.exitCode, 0, reload.stderr);
    assert.equal(JSON.parse(reload.stdout).status, "running");

    const disable = await context.fde(["plugin", "disable", "cli-e2e", "--json"]);
    assert.equal(disable.exitCode, 0, disable.stderr);
    assert.equal(JSON.parse(disable.stdout).status, "disabled");

    const enable = await context.fde(["plugin", "enable", "cli-e2e", "--json"]);
    assert.equal(enable.exitCode, 0, enable.stderr);
    assert.equal(JSON.parse(enable.stdout).status, "running");

    const remove = await context.fde(["plugin", "remove", "cli-e2e", "--json"]);
    assert.equal(remove.exitCode, 0, remove.stderr);
    const removeGit = await context.fde(["plugin", "remove", "git-cli-e2e", "--json"]);
    assert.equal(removeGit.exitCode, 0, removeGit.stderr);
    const list = await context.fde(["plugin", "ls", "--json"]);
    assert.equal(list.exitCode, 0, list.stderr);
    assert.deepEqual(JSON.parse(list.stdout), []);
  } finally {
    await context.stop();
    await rm(directory, { recursive: true, force: true });
    await rm(gitDirectory, { recursive: true, force: true });
  }
}

await main();
