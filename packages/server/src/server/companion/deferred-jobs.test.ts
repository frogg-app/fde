import { describe, expect, it } from "vitest";

import {
  CompanionDeferredJobs,
  describeSettledJob,
  type CompanionDeferredJob,
  type CompanionDeferredJobRequest,
} from "./deferred-jobs.js";

interface Deferred {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

function createDeferred(): Deferred {
  let resolve = (_value: string): void => {};
  let reject = (_error: Error): void => {};
  const promise = new Promise<string>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

const WARNINGS: object[] = [];
const logger = {
  warn: (obj: object) => {
    WARNINGS.push(obj);
  },
};

function createJobs(run: (request: CompanionDeferredJobRequest) => Promise<string>): {
  jobs: CompanionDeferredJobs;
  seen: CompanionDeferredJob[];
} {
  let counter = 0;
  let tick = 0;
  const jobs = new CompanionDeferredJobs({
    run,
    logger,
    idFactory: () => `job-${(counter += 1)}`,
    now: () => new Date(Date.parse("2025-01-01T00:00:00.000Z") + (tick += 1000)),
  });
  const seen: CompanionDeferredJob[] = [];
  jobs.subscribe((job) => seen.push(job));
  return { jobs, seen };
}

const THINK: CompanionDeferredJobRequest = {
  kind: "think",
  label: "the flaky test",
  question: "why is the push test flaky?",
  agentId: null,
};

describe("CompanionDeferredJobs", () => {
  it("returns a job id inside the turn and only settles later", async () => {
    const pending = createDeferred();
    const { jobs, seen } = createJobs(() => pending.promise);

    const started = jobs.start(THINK);

    expect(started).toEqual({ status: "started", jobId: "job-1" });
    expect(jobs.get("job-1")).toEqual({
      ...THINK,
      jobId: "job-1",
      status: "running",
      summary: null,
      startedAt: "2025-01-01T00:00:01.000Z",
      settledAt: null,
    });
    expect(seen).toHaveLength(1);

    pending.resolve("  It races on the lease clock.  ");
    await jobs.drain();

    expect(seen.map((job) => job.status)).toEqual(["running", "succeeded"]);
    expect(jobs.get("job-1")).toEqual({
      ...THINK,
      jobId: "job-1",
      status: "succeeded",
      summary: "It races on the lease clock.",
      startedAt: "2025-01-01T00:00:01.000Z",
      settledAt: "2025-01-01T00:00:02.000Z",
    });
    expect(jobs.listRunning()).toEqual([]);
  });

  it("records a failing job as failed with its message and keeps running", async () => {
    const pending = createDeferred();
    const { jobs, seen } = createJobs(() => pending.promise);

    jobs.start(THINK);
    pending.reject(new Error("no provider available"));
    await jobs.drain();

    expect(seen[1]).toMatchObject({
      jobId: "job-1",
      status: "failed",
      summary: "no provider available",
      settledAt: "2025-01-01T00:00:02.000Z",
    });
    expect(describeSettledJob(seen[1])).toBe(
      "The background job you started (the flaky test) failed: no provider available. Tell the user it did not work, in one spoken sentence, and offer what to do next.",
    );
  });

  it("keeps concurrent jobs independent", async () => {
    const first = createDeferred();
    const second = createDeferred();
    const queue = [first, second];
    const { jobs } = createJobs(() => queue.shift()!.promise);

    const startedFirst = jobs.start(THINK);
    const startedSecond = jobs.start({ ...THINK, kind: "research", label: "the changelog" });

    expect(jobs.listRunning().map((job) => job.jobId)).toEqual(["job-1", "job-2"]);

    second.reject(new Error("timed out"));
    first.resolve("It races on the lease clock.");
    await jobs.drain();

    expect(jobs.get(startedFirst.jobId)?.status).toBe("succeeded");
    expect(jobs.get(startedSecond.jobId)?.status).toBe("failed");
  });

  it("delivers settled jobs to subscribers until they unsubscribe", async () => {
    const pending = createDeferred();
    const { jobs } = createJobs(() => pending.promise);
    const received: string[] = [];
    const unsubscribe = jobs.subscribe((job) => received.push(job.status));

    jobs.start(THINK);
    unsubscribe();
    pending.resolve("done");
    await jobs.drain();

    expect(received).toEqual(["running"]);
  });

  it("renders a succeeded job as a synthetic user turn carrying the result", () => {
    const job: CompanionDeferredJob = {
      ...THINK,
      jobId: "job-1",
      status: "succeeded",
      summary: "It races on the lease clock.",
      startedAt: "2025-01-01T00:00:01.000Z",
      settledAt: "2025-01-01T00:00:02.000Z",
    };

    expect(describeSettledJob(job)).toBe(
      "The background job you started (the flaky test) finished. Result:\nIt races on the lease clock.\n\nTell the user, in one or two spoken sentences.",
    );
  });
});
