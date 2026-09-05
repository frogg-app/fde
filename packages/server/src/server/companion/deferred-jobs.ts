import { randomUUID } from "node:crypto";

export type CompanionDeferredJobKind = "think" | "read_timeline" | "research";

export type CompanionDeferredJobStatus = "running" | "succeeded" | "failed";

export interface CompanionDeferredJobRequest {
  kind: CompanionDeferredJobKind;
  /** Short spoken-safe description of the work, e.g. "thinking about the flaky test". */
  label: string;
  /** The question handed to the subagent verbatim. */
  question: string;
  /** Set for read_timeline; the agent whose timeline is being read. */
  agentId: string | null;
}

export interface CompanionDeferredJob extends CompanionDeferredJobRequest {
  jobId: string;
  status: CompanionDeferredJobStatus;
  /** The subagent's paragraph once it succeeds, or why it failed. Null while running. */
  summary: string | null;
  startedAt: string;
  settledAt: string | null;
}

/** What a deferred tool hands straight back to the model, inside the same turn. */
export interface CompanionDeferredJobStarted {
  status: "started";
  jobId: string;
}

export type CompanionDeferredJobListener = (job: CompanionDeferredJob) => void;

export type CompanionDeferredJobRunner = (request: CompanionDeferredJobRequest) => Promise<string>;

interface CompanionDeferredJobsLogger {
  warn: (obj: object, msg?: string) => void;
}

export interface CompanionDeferredJobsOptions {
  run: CompanionDeferredJobRunner;
  logger: CompanionDeferredJobsLogger;
  idFactory?: () => string;
  now?: () => Date;
}

/**
 * The registry behind the deferred tools. `start` returns synchronously so the
 * conversational turn never waits, and every state change fans out to
 * subscribers — that is how a finished job re-enters the orchestrator as a
 * synthetic user turn and gets spoken unprompted.
 */
export class CompanionDeferredJobs {
  private readonly run: CompanionDeferredJobRunner;
  private readonly logger: CompanionDeferredJobsLogger;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, CompanionDeferredJob>();
  private readonly listeners = new Set<CompanionDeferredJobListener>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: CompanionDeferredJobsOptions) {
    this.run = options.run;
    this.logger = options.logger;
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  start(request: CompanionDeferredJobRequest): CompanionDeferredJobStarted {
    const job: CompanionDeferredJob = {
      ...request,
      jobId: this.idFactory(),
      status: "running",
      summary: null,
      startedAt: this.now().toISOString(),
      settledAt: null,
    };
    this.jobs.set(job.jobId, job);
    this.emit(job);

    const task = this.execute(job.jobId, request);
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));

    return { status: "started", jobId: job.jobId };
  }

  subscribe(listener: CompanionDeferredJobListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get(jobId: string): CompanionDeferredJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  listRunning(): CompanionDeferredJob[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === "running");
  }

  /** Resolves once every started job has settled. Used at shutdown and in tests. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all(Array.from(this.inFlight));
    }
  }

  private async execute(jobId: string, request: CompanionDeferredJobRequest): Promise<void> {
    try {
      const summary = await this.run(request);
      this.settle(jobId, "succeeded", summary.trim());
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err, jobId, kind: request.kind }, "Companion deferred job failed");
      this.settle(jobId, "failed", err.message);
    }
  }

  private settle(jobId: string, status: CompanionDeferredJobStatus, summary: string): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }
    const settled: CompanionDeferredJob = {
      ...job,
      status,
      summary,
      settledAt: this.now().toISOString(),
    };
    this.jobs.set(jobId, settled);
    this.emit(settled);
  }

  private emit(job: CompanionDeferredJob): void {
    for (const listener of this.listeners) {
      try {
        listener(job);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn({ err, jobId: job.jobId }, "Companion deferred job listener threw");
      }
    }
  }
}

/**
 * The synthetic user turn a settled job re-enters the orchestrator with. The
 * Companion speaks the result as if it had just remembered the answer.
 */
export function describeSettledJob(job: CompanionDeferredJob): string {
  if (job.status === "succeeded") {
    return `The background job you started (${job.label}) finished. Result:\n${job.summary ?? ""}\n\nTell the user, in one or two spoken sentences.`;
  }
  return `The background job you started (${job.label}) failed: ${job.summary ?? "unknown error"}. Tell the user it did not work, in one spoken sentence, and offer what to do next.`;
}
