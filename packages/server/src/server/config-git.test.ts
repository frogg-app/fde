import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_GIT_PROCESS_POLICY } from "../utils/git-process-scheduler.js";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createHome(config: object = {}): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-config-git-"));
  roots.push(home);
  await writeFile(path.join(home, "config.json"), JSON.stringify(config));
  return home;
}

describe("daemon Git process config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("defaults the global process limits", async () => {
    const home = await createHome();

    // Asserted against the shared default rather than repeated literals, so
    // tuning the policy does not mean editing the same numbers in two places.
    expect(loadConfig(home, { env: {} }).git).toEqual(DEFAULT_GIT_PROCESS_POLICY);
  });

  test("loads both limits from daemon.git", async () => {
    const home = await createHome({
      daemon: {
        git: {
          maxProcessesPerSecond: 5,
          maxProcessConcurrency: 4,
        },
      },
    });

    expect(loadConfig(home, { env: {} }).git).toEqual({
      maxProcessesPerSecond: 5,
      maxProcessConcurrency: 4,
    });
  });

  test("new environment variables override config.json", async () => {
    const home = await createHome({
      daemon: {
        git: {
          maxProcessesPerSecond: 5,
          maxProcessConcurrency: 4,
        },
      },
    });

    expect(
      loadConfig(home, {
        env: {
          PASEO_GIT_MAX_PROCESSES_PER_SECOND: "12",
          PASEO_GIT_MAX_PROCESS_CONCURRENCY: "6",
        },
      }).git,
    ).toEqual({
      maxProcessesPerSecond: 12,
      maxProcessConcurrency: 6,
    });
  });

  test("accepts legacy PASEO_GIT_CONCURRENCY below the renamed variable", async () => {
    const home = await createHome();

    expect(
      loadConfig(home, {
        env: {
          PASEO_GIT_CONCURRENCY: "3",
        },
      }).git?.maxProcessConcurrency,
    ).toBe(3);
    expect(
      loadConfig(home, {
        env: {
          PASEO_GIT_CONCURRENCY: "3",
          PASEO_GIT_MAX_PROCESS_CONCURRENCY: "7",
        },
      }).git?.maxProcessConcurrency,
    ).toBe(7);
  });
});
