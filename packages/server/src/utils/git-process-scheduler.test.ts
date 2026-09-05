import { setImmediate as scheduleImmediate } from "node:timers";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  DEFAULT_GIT_PROCESS_POLICY,
  GitProcessScheduler,
  resolveGitProcessPolicy,
} from "./git-process-scheduler.js";

function createConcurrencyTask(
  index: number,
  started: number[],
  releases: Array<() => void>,
): () => { result: Promise<void>; exited: Promise<void> } {
  return () => {
    started.push(index);
    if (index >= 2) {
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    }
    const completed = new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    return { result: completed, exited: completed };
  };
}

describe("GitProcessScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("limits unresolved processes independently of their start rate", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 2,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const tasks = Array.from({ length: 4 }, (_, index) =>
      scheduler.run(createConcurrencyTask(index, started, releases)),
    );

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toContain(2));
    releases.shift()?.();
    await Promise.all(tasks);

    expect(scheduler.activeCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
  });

  test("admits a high-priority user operation before queued observation work", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const activeObservation = scheduler.run(createConcurrencyTask(0, started, releases));
    await vi.waitFor(() => expect(started).toEqual([0]));
    const queuedObservation = scheduler.run(createConcurrencyTask(2, started, releases));
    const userOperation = scheduler.run(createConcurrencyTask(3, started, releases), {
      priority: "high",
    });

    releases.shift()?.();
    await Promise.all([activeObservation, queuedObservation, userOperation]);

    expect(started).toEqual([0, 3, 2]);
  });

  test("yields to daemon liveness work between process starts", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 8,
    });
    const started: number[] = [];
    const start = () => {
      started.push(started.length);
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    };

    const livenessTurn = new Promise<void>((resolve) => setImmediate(resolve));
    const tasks = Array.from({ length: 8 }, () => scheduler.run(start));
    await livenessTurn;

    expect(started).toHaveLength(1);
    await Promise.all(tasks);
  });

  test("starts an isolated process without an extra event-loop turn", async () => {
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 8,
    });
    let started = false;

    const result = scheduler.run(() => {
      started = true;
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    });

    expect(started).toBe(true);
    await result;
  });

  test("queued processes keep moving while application timers are faked", async () => {
    vi.useFakeTimers();
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 100,
      maxProcessConcurrency: 1,
    });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    const first = scheduler.run(createConcurrencyTask(0, started, releases));
    const second = scheduler.run(createConcurrencyTask(2, started, releases));
    expect(started).toEqual([0]);

    releases.shift()?.();
    await Promise.resolve();
    await new Promise<void>((resolve) => scheduleImmediate(resolve));

    expect(started).toEqual([0, 2]);
    await Promise.all([first, second]);
  });

  test("limits process starts in each strict one-second interval", async () => {
    vi.useFakeTimers();
    const scheduler = new GitProcessScheduler({
      maxProcessesPerSecond: 2,
      maxProcessConcurrency: 4,
    });
    const startedAt: number[] = [];
    const recordStart = () => {
      startedAt.push(Date.now());
      const completed = Promise.resolve();
      return { result: completed, exited: completed };
    };
    const tasks = Array.from({ length: 4 }, () => scheduler.run(recordStart));

    await vi.advanceTimersByTimeAsync(999);
    expect(startedAt.length).toBeLessThanOrEqual(2);
    while (startedAt.length < 3) {
      await vi.advanceTimersToNextTimerAsync();
    }
    while (startedAt.length < 4) {
      await vi.advanceTimersToNextTimerAsync();
    }
    await Promise.all(tasks);

    expect(startedAt).toHaveLength(4);
    expect(startedAt[2]! - startedAt[0]!).toBeGreaterThanOrEqual(1_000);
  });
});

describe("resolveGitProcessPolicy", () => {
  test("prefers renamed environment variables over legacy and persisted values", () => {
    expect(
      resolveGitProcessPolicy({
        env: {
          PASEO_GIT_MAX_PROCESSES_PER_SECOND: "12",
          PASEO_GIT_MAX_PROCESS_CONCURRENCY: "7",
          PASEO_GIT_CONCURRENCY: "3",
        },
        persisted: { maxProcessesPerSecond: 5, maxProcessConcurrency: 4 },
      }),
    ).toEqual({ maxProcessesPerSecond: 12, maxProcessConcurrency: 7 });
  });
});

describe("default policy", () => {
  test("keeps the per-second ceiling clear of the rate concurrency can sustain", () => {
    // The concurrency limit is the resource guard; the per-second limit is only
    // a runaway backstop. If it ever drops below what concurrency can sustain,
    // it silently becomes the bottleneck and ordinary parallel work turns into
    // queue latency - which is what a 64/s default did to checkout status, at
    // 13 spawns per call.
    const { maxProcessConcurrency, maxProcessesPerSecond } = DEFAULT_GIT_PROCESS_POLICY;
    // A short git command (rev-parse, config --get) measures 2-8ms.
    const sustainableRate = maxProcessConcurrency / 0.008;
    expect(maxProcessesPerSecond).toBeGreaterThanOrEqual(sustainableRate);
  });

  test("still bounds a runaway spawn loop", () => {
    expect(DEFAULT_GIT_PROCESS_POLICY.maxProcessesPerSecond).toBeLessThan(10_000);
    expect(DEFAULT_GIT_PROCESS_POLICY.maxProcessConcurrency).toBeLessThan(64);
  });
});
