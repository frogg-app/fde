import pino from "pino";
import { describe, expect, test } from "vitest";
import type { DaemonAutoUpdateConfig, DaemonUpdateRun } from "@fde/protocol/messages";
import { DaemonAutoUpdater, isInQuietHours } from "./daemon-auto-updater.js";
import type { CheckPayload, StartPayload } from "./daemon-update-service.js";

function fakeService(input: {
  updatable?: boolean;
  latest?: string | null;
  error?: string | null;
}) {
  const starts: { version?: string }[] = [];
  let run: DaemonUpdateRun | null = null;
  const service = {
    installInfo: {
      installDir: "/x",
      updatable: input.updatable ?? true,
      reason: null,
      runningRoot: null,
      cliLauncher: null,
    },
    currentRun: () => run,
    async check(): Promise<CheckPayload> {
      return {
        updatable: true,
        reason: null,
        currentVersion: "0.1.13",
        channel: "stable",
        latestVersion: input.latest ?? null,
        updateAvailable: Boolean(input.latest),
        releaseUrl: null,
        error: input.error ?? null,
      };
    },
    async start(options: { version?: string }): Promise<StartPayload> {
      starts.push(options);
      run = {
        runId: "r",
        from: "0.1.13",
        to: options.version ?? "?",
        phase: "check",
        message: null,
        at: "t",
      };
      return { accepted: true, runId: "r", targetVersion: options.version ?? null, error: null };
    },
  };
  return { service, starts };
}

function makeUpdater(input: {
  config: Partial<DaemonAutoUpdateConfig>;
  service: ReturnType<typeof fakeService>["service"];
  agentsRunning?: boolean;
  now?: Date;
}) {
  return new DaemonAutoUpdater({
    service: input.service,
    getConfig: () => ({
      enabled: true,
      channel: "stable",
      checkIntervalHours: 24,
      quietHours: null,
      ...input.config,
    }),
    hasRunningAgents: () => input.agentsRunning ?? false,
    logger: pino({ level: "silent" }),
    now: () => input.now ?? new Date(2026, 8, 3, 14, 0, 0),
  });
}

describe("quiet hours", () => {
  test("covers plain and wrap-around windows", () => {
    expect(isInQuietHours(new Date(2026, 8, 3, 10), [9, 17])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 17), [9, 17])).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 23), [22, 6])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 3), [22, 6])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), [22, 6])).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), null)).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), [12, 12])).toBe(false);
  });
});

describe("DaemonAutoUpdater.tick", () => {
  test("stays idle when disabled, not updatable, up to date, or inside quiet hours", async () => {
    const off = fakeService({ latest: "0.1.14" });
    expect(await makeUpdater({ config: { enabled: false }, service: off.service }).tick()).toBe(
      "disabled",
    );
    const fixed = fakeService({ updatable: false, latest: "0.1.14" });
    expect(await makeUpdater({ config: {}, service: fixed.service }).tick()).toBe("not_updatable");
    const current = fakeService({ latest: null });
    expect(await makeUpdater({ config: {}, service: current.service }).tick()).toBe("up_to_date");
    const quiet = fakeService({ latest: "0.1.14" });
    expect(
      await makeUpdater({ config: { quietHours: [13, 15] }, service: quiet.service }).tick(),
    ).toBe("quiet_hours");
    expect(quiet.starts).toEqual([]);
    const broken = fakeService({ error: "rate limited" });
    expect(await makeUpdater({ config: {}, service: broken.service }).tick()).toBe("check_failed");
  });

  test("defers while agents are running and starts the update once they are idle", async () => {
    const busy = fakeService({ latest: "0.1.14" });
    expect(
      await makeUpdater({ config: {}, service: busy.service, agentsRunning: true }).tick(),
    ).toBe("busy");
    expect(busy.starts).toEqual([]);

    const idle = fakeService({ latest: "0.1.14" });
    const updater = makeUpdater({ config: { channel: "beta" }, service: idle.service });
    expect(await updater.tick()).toBe("started");
    expect(idle.starts).toEqual([{ version: "0.1.14", channel: "beta" }]);
    expect(await updater.tick()).toBe("already_running");
  });
});
