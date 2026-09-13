import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createFroggHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "frogg-config-browser-tools-"));
  roots.push(root);
  const froggHome = path.join(root, ".frogg");
  await mkdir(froggHome, { recursive: true });
  await writeFile(path.join(froggHome, "config.json"), JSON.stringify(config, null, 2));
  return froggHome;
}

describe("daemon browser tools config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults browser tools off when config is absent", async () => {
    const home = await createFroggHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(false);
  });

  test("loads browser tools opt-in from persisted daemon config", async () => {
    const home = await createFroggHome({
      version: 1,
      daemon: { browserTools: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).browserToolsEnabled).toBe(true);
  });
});
