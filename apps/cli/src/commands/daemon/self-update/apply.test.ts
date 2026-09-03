import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { applyUpdate } from "./apply.js";
import {
  listInstalledVersions,
  readCurrentVersion,
  readLastUpdate,
  readPreviousVersion,
  setCurrentVersion,
} from "./layout.js";
import { installFakeVersion } from "./layout.test.js";
import type { ServiceManager } from "./service.js";
import { waitForDaemonVersion } from "./verify.js";

const dirs: string[] = [];
function makeInstallDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fde-self-update-apply-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A service manager whose "daemon" reports whichever version `current` points
 * at, except for versions listed as broken, which never come up.
 */
function fakeService(installDir: string, broken: string[]) {
  const restarts: string[] = [];
  const service: ServiceManager = {
    kind: "unmanaged",
    async restart() {
      restarts.push(readCurrentVersion(installDir) ?? "none");
    },
    async isRunning() {
      return !broken.includes(readCurrentVersion(installDir) ?? "");
    },
  };
  const probe = async () => {
    const version = readCurrentVersion(installDir) ?? "";
    if (broken.includes(version)) throw new Error("connection refused");
    return { version, healthy: true };
  };
  return { service, probe, restarts };
}

const immediate = async () => {};

describe("applyUpdate", () => {
  test("applies a healthy version, records it, and prunes down to three", async () => {
    const installDir = makeInstallDir();
    for (const version of ["0.1.10", "0.1.11", "0.1.12", "0.1.13", "0.1.14"]) {
      installFakeVersion(installDir, version);
    }
    setCurrentVersion(installDir, "0.1.13");
    const fake = fakeService(installDir, []);
    const log: string[] = [];

    const outcome = await applyUpdate(
      {
        installDir,
        version: "0.1.14",
        previous: "0.1.13",
        httpBase: "http://127.0.0.1:1",
        verifyTimeoutMs: 3000,
      },
      { service: fake.service, probe: fake.probe, log: (line) => log.push(line), sleep: immediate },
    );

    expect(outcome).toMatchObject({
      from: "0.1.13",
      to: "0.1.14",
      status: "applied",
      reason: null,
    });
    expect(readCurrentVersion(installDir)).toBe("0.1.14");
    expect(readPreviousVersion(installDir)).toBe("0.1.13");
    expect(fake.restarts).toEqual(["0.1.14"]);
    expect(readLastUpdate(installDir)?.status).toBe("applied");
    expect(listInstalledVersions(installDir)).toEqual(["0.1.14", "0.1.13", "0.1.12"]);
    expect(log.some((line) => line.includes("pruned 0.1.11, 0.1.10"))).toBe(true);
  });

  test("rolls back to previous when the new daemon never becomes healthy", async () => {
    const installDir = makeInstallDir();
    installFakeVersion(installDir, "0.1.13");
    installFakeVersion(installDir, "0.1.14");
    setCurrentVersion(installDir, "0.1.13");
    const fake = fakeService(installDir, ["0.1.14"]);

    const outcome = await applyUpdate(
      {
        installDir,
        version: "0.1.14",
        previous: "0.1.13",
        httpBase: "http://127.0.0.1:1",
        verifyTimeoutMs: 2000,
      },
      { service: fake.service, probe: fake.probe, log: () => {}, sleep: immediate },
    );

    expect(outcome.status).toBe("rolled_back");
    expect(outcome.reason).toMatch(/not running|timed out/);
    expect(readCurrentVersion(installDir)).toBe("0.1.13");
    expect(fake.restarts).toEqual(["0.1.14", "0.1.13"]);
    expect(readLastUpdate(installDir)).toMatchObject({
      from: "0.1.13",
      to: "0.1.14",
      status: "rolled_back",
    });
    // Both versions stay on disk: the failed one for inspection, previous for the next attempt.
    expect(listInstalledVersions(installDir)).toEqual(["0.1.14", "0.1.13"]);
  });

  test("reports failed when the rollback target is also unhealthy or missing", async () => {
    const installDir = makeInstallDir();
    installFakeVersion(installDir, "0.1.13");
    installFakeVersion(installDir, "0.1.14");
    setCurrentVersion(installDir, "0.1.13");
    const fake = fakeService(installDir, ["0.1.13", "0.1.14"]);
    const outcome = await applyUpdate(
      {
        installDir,
        version: "0.1.14",
        previous: "0.1.13",
        httpBase: "http://127.0.0.1:1",
        verifyTimeoutMs: 1500,
      },
      { service: fake.service, probe: fake.probe, log: () => {}, sleep: immediate },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toMatch(/rollback to 0.1.13 also failed/);

    const lonely = makeInstallDir();
    installFakeVersion(lonely, "0.1.14");
    const lonelyFake = fakeService(lonely, ["0.1.14"]);
    const noPrevious = await applyUpdate(
      {
        installDir: lonely,
        version: "0.1.14",
        previous: null,
        httpBase: "http://127.0.0.1:1",
        verifyTimeoutMs: 1500,
      },
      { service: lonelyFake.service, probe: lonelyFake.probe, log: () => {}, sleep: immediate },
    );
    expect(noPrevious.status).toBe("failed");
    expect(noPrevious.reason).toMatch(/no previous version/);
  });

  test("is safe to re-run once the version is already current", async () => {
    const installDir = makeInstallDir();
    installFakeVersion(installDir, "0.1.13");
    installFakeVersion(installDir, "0.1.14");
    setCurrentVersion(installDir, "0.1.14");
    const fake = fakeService(installDir, []);
    const outcome = await applyUpdate(
      { installDir, version: "0.1.14", previous: "0.1.13", httpBase: null },
      { service: fake.service, probe: fake.probe, log: () => {}, sleep: immediate },
    );
    expect(outcome.status).toBe("applied");
    expect(readPreviousVersion(installDir)).toBeNull();
    expect(readCurrentVersion(installDir)).toBe("0.1.14");
  });
});

describe("waitForDaemonVersion", () => {
  test("succeeds once identity and health agree, and gives up early when the process dies", async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return { version: calls >= 3 ? "0.1.14" : "0.1.13", healthy: true };
    };
    let clock = 0;
    const ok = await waitForDaemonVersion(
      {
        httpBase: "http://x",
        expectedVersion: "0.1.14",
        timeoutMs: 90_000,
        sleep: async () => {
          clock += 1000;
        },
        now: () => clock,
      },
      probe,
    );
    expect(ok).toMatchObject({ ok: true });

    clock = 0;
    const dead = await waitForDaemonVersion(
      {
        httpBase: "http://x",
        expectedVersion: "0.1.14",
        timeoutMs: 90_000,
        isRunning: async () => false,
        sleep: async () => {
          clock += 1000;
        },
        now: () => clock,
      },
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect(dead).toMatchObject({ ok: false });
    expect((dead as { reason: string }).reason).toMatch(/not running/);
    expect(clock).toBeLessThan(90_000);
  });
});
