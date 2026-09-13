import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ManagedAgent } from "../agent/agent-manager.js";
import { randomUUID } from "node:crypto";

export type CompanionDeferredJobKind = "think" | "read_timeline" | "research" | "agent";

export type CompanionDeferredJobStatus = "running" | "succeeded" | "failed";

export interface CompanionDeferredJobRequest {
  kind: CompanionDeferredJobKind;
  /** Short spoken-safe description of the work, e.g. "thinking about the flaky test". */
  label: string;
  /** The question handed to the subagent verbatim. */
  question: string;
  /** Set for read_timeline; the agent whose timeline is being read. */
  agentId: string | null;
  workspaceId?: string;
  conversationId?: string;
  announced?: boolean;
  dispatched?: boolean;
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
  filePath?: string;
}

/**
 * The registry behind the deferred tools. `start` returns synchronously so the
 * conversational turn never waits, and every state change fans out to
 * subscribers — that is how a finished job re-enters the orchestrator as a
 * synthetic user turn and gets spoken unprompted.
 */
export class CompanionDeferredJobs {
  private readonly filePath: string | undefined;
  private readonly run: CompanionDeferredJobRunner;
  private readonly logger: CompanionDeferredJobsLogger;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly jobs = new Map<string, CompanionDeferredJob>();
  private readonly listeners = new Set<CompanionDeferredJobListener>();
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: CompanionDeferredJobsOptions) {
    this.filePath = options.filePath;
    this.run = options.run;
    this.logger = options.logger;
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date());
    if (this.filePath && existsSync(this.filePath)) {
      const schema = z.array(
        z.object({
          jobId: z.string(),
          kind: z.enum(["think", "read_timeline", "research", "agent"]),
          label: z.string(),
          question: z.string(),
          agentId: z.string().nullable(),
          workspaceId: z.string().optional(),
          conversationId: z.string().optional(),
          announced: z.boolean().optional(),
          dispatched: z.boolean().optional(),
          status: z.enum(["running", "succeeded", "failed"]),
          summary: z.string().nullable(),
          startedAt: z.string(),
          settledAt: z.string().nullable(),
        }),
      );
      for (const job of schema.parse(JSON.parse(readFileSync(this.filePath, "utf8")))) {
        if (
          job.status === "running" &&
          (job.kind !== "agent" || !job.agentId || job.dispatched === false)
        ) {
          job.status = "failed";
          job.summary =
            "The daemon restarted before this job could be reconciled. It was not repeated.";
          job.settledAt = this.now().toISOString();
        }
        this.jobs.set(job.jobId, job);
      }
    }
  }

  start(
    request: CompanionDeferredJobRequest,
    dispatch?: (jobId: string) => Promise<void>,
  ): CompanionDeferredJobStarted {
    const job: CompanionDeferredJob = {
      ...request,
      jobId: this.idFactory(),
      dispatched: request.kind === "agent" ? false : undefined,
      status: "running",
      summary: null,
      startedAt: this.now().toISOString(),
      settledAt: null,
    };
    this.jobs.set(job.jobId, job);
    try {
      this.persist();
    } catch (error) {
      this.jobs.delete(job.jobId);
      throw error;
    }
    this.emit(job);

    const task = dispatch
      ? dispatch(job.jobId).catch((error: unknown) =>
          this.settle(job.jobId, "failed", error instanceof Error ? error.message : String(error)),
        )
      : this.execute(job.jobId, request);
    this.inFlight.add(task);
    void task.finally(() => this.inFlight.delete(task));

    return { status: "started", jobId: job.jobId };
  }

  attachAgent(jobId: string, agent: ManagedAgent): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.agentId = agent.id;
    job.dispatched = true;
    job.workspaceId = agent.workspaceId ?? undefined;
    this.persist();
    this.observeAgent(agent);
  }

  observeAgent(agent: ManagedAgent): void {
    for (const job of this.jobs.values()) {
      if (
        job.kind !== "agent" ||
        job.agentId !== agent.id ||
        job.status !== "running" ||
        job.dispatched === false
      )
        continue;
      if (agent.pendingPermissions.size) {
        const summary = `Permission needed for ${agent.config.title ?? "your agent"}: ${Array.from(
          agent.pendingPermissions.values(),
        )
          .map((p) => `${p.title ?? p.name} (request ${p.id})`)
          .join(", ")}`;
        if (job.summary !== summary) {
          job.summary = summary;
          this.persist();
          this.emit(job);
        }
      } else if (agent.lifecycle === "error")
        this.settle(job.jobId, "failed", agent.lastError ?? "Agent failed");
      else if (agent.lifecycle === "idle" && !agent.activeTurnId)
        this.settle(
          job.jobId,
          "succeeded",
          "The agent finished. Read its timeline before describing the result.",
        );
    }
  }

  list(): CompanionDeferredJob[] {
    return Array.from(this.jobs.values());
  }
  markAnnounced(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      this.jobs.set(jobId, { ...job, announced: true });
      try {
        this.persist();
      } catch (error) {
        this.jobs.set(jobId, job);
        throw error;
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.list()), { mode: 0o600 });
    renameSync(temporary, this.filePath);
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
    this.persist();
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
    return `The background job you started (${job.label}, job ${job.jobId}, agent ${job.agentId ?? "none"}, workspace ${job.workspaceId ?? "unspecified"}) finished. Result:\n${job.summary ?? ""}\n\nTell the user, in one or two spoken sentences.`;
  }
  return `The background job you started (${job.label}) failed: ${job.summary ?? "unknown error"}. Tell the user it did not work, in one spoken sentence, and offer what to do next.`;
}
