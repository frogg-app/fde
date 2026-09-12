import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];
async function createFdeHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fde-config-web-ui-"));
  roots.push(root);
  const fdeHome = path.join(root, ".fde");
  await mkdir(fdeHome, { recursive: true });
  await writeFile(path.join(fdeHome, "config.json"), JSON.stringify(config, null, 2));
  return fdeHome;
}

function expectBundledWebUiDistDir(distDir: string | null): void {
  expect(distDir).not.toBeNull();
  expect(path.isAbsolute(distDir ?? "")).toBe(true);
  expect(distDir?.endsWith(path.join("packages", "server", "dist", "server", "web-ui"))).toBe(true);
}

describe("daemon web UI config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("web UI is disabled by default", async () => {
    const home = await createFdeHome({ version: 1 });

    const config = loadConfig(home, { env: {} });

    expect(config.webUi.enabled).toBe(false);
    expectBundledWebUiDistDir(config.webUi.distDir);
  });

  test("enables web UI from persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { enabled: true } },
    });

    const config = loadConfig(home, { env: {} });

    expect(config.webUi.enabled).toBe(true);
    expectBundledWebUiDistDir(config.webUi.distDir);
  });

  test("FDE_WEB_UI_ENABLED overrides persisted setting", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { enabled: true } },
    });

    const config = loadConfig(home, { env: { FDE_WEB_UI_ENABLED: "false" } });

    expect(config.webUi.enabled).toBe(false);
  });

  test("FDE_WEB_UI_ENABLED=true enables web UI", async () => {
    const home = await createFdeHome({ version: 1 });

    const config = loadConfig(home, { env: { FDE_WEB_UI_ENABLED: "true" } });

    expect(config.webUi.enabled).toBe(true);
  });

  test("CLI web UI enable override wins over env and persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { enabled: false } },
    });

    const config = loadConfig(home, {
      env: { FDE_WEB_UI_ENABLED: "false" },
      cli: { webUiEnabled: true },
    });

    expect(config.webUi.enabled).toBe(true);
  });

  test("CLI web UI disable override wins over env and persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { enabled: true } },
    });

    const config = loadConfig(home, {
      env: { FDE_WEB_UI_ENABLED: "true" },
      cli: { webUiEnabled: false },
    });

    expect(config.webUi.enabled).toBe(false);
  });

  test("resolves FDE_WEB_UI_DIST_DIR as absolute path", async () => {
    const home = await createFdeHome({ version: 1 });
    const distDir = path.join(os.tmpdir(), "fde-web-ui-dist");

    const config = loadConfig(home, { env: { FDE_WEB_UI_DIST_DIR: distDir } });

    expect(config.webUi.distDir).toBe(path.resolve(distDir));
  });

  test("resolves relative persisted distDir against FDE_HOME", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { distDir: "web-ui-dist" } },
    });

    const config = loadConfig(home, { env: {} });

    expect(config.webUi.distDir).toBe(path.join(home, "web-ui-dist"));
  });

  test("FDE_WEB_UI_DIST_DIR overrides persisted distDir", async () => {
    const home = await createFdeHome({
      version: 1,
      features: { webUi: { distDir: "/persisted/dist" } },
    });
    const envDir = path.join(os.tmpdir(), "env-dist");

    const config = loadConfig(home, { env: { FDE_WEB_UI_DIST_DIR: envDir } });

    expect(config.webUi.distDir).toBe(path.resolve(envDir));
  });
});
