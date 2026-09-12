import { randomUUID } from "node:crypto";
import {
  buildInstallCommand,
  parseMethod,
  parseRequest,
  parseTarget,
  record,
  type DeployBrand,
  type DeployMethod,
  type SshTarget,
} from "./args.js";
import { parseProbeOutput } from "./probe.js";
import type { ExecuteScript } from "./executor.js";

export type DeployEvent =
  | { jobId: string; kind: "log"; text: string; stream: "stdout" | "stderr" }
  | { jobId: string; kind: "done"; text: string }
  | {
      jobId: string;
      kind: "error";
      detail: string;
      cancelled: boolean;
      failure?: {
        kind: "ssh-auth";
        methods: string[];
        passwordTried: boolean;
      };
    };
interface ManagerOptions {
  execute: ExecuteScript;
  brand: DeployBrand;
  defaultVersion: string;
  probeScript: string;
  script(method: DeployMethod, uninstall?: boolean): string;
  emit(event: DeployEvent): void;
  jobTimeoutMs?: number;
}

export class DeployManager {
  private jobs = new Map<string, AbortController>();
  private probes = new Set<AbortController>();
  constructor(private readonly options: ManagerOptions) {}

  async probe(args: unknown): Promise<Record<string, unknown>> {
    const target = parseTarget(args);
    const controller = new AbortController();
    this.probes.add(controller);
    try {
      const result = await this.options.execute({
        target,
        command: "sh -s",
        script: this.options.probeScript,
        signal: controller.signal,
        timeoutMs: 45000,
      });
      if (result.code !== 0)
        throw new Error(result.stderr.trim() || `SSH probe exited with code ${result.code}`);
      return parseProbeOutput(result.stdout);
    } finally {
      this.probes.delete(controller);
    }
  }

  start(args: unknown): { jobId: string } {
    const request = parseRequest(args, this.options.defaultVersion, this.options.brand);
    return this.launch(
      request.target,
      buildInstallCommand(request, this.options.brand),
      this.options.script(request.method),
    );
  }
  uninstall(args: unknown): { jobId: string } {
    return this.launch(parseTarget(args), "bash -s", this.options.script(parseMethod(args), true));
  }
  cancel(args: unknown): { cancelled: boolean } {
    const jobId = record(args).jobId;
    if (typeof jobId !== "string" || !jobId) throw new Error("jobId is required");
    const controller = this.jobs.get(jobId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  }
  cancelAll(): void {
    for (const controller of [...this.jobs.values(), ...this.probes]) controller.abort();
  }

  private launch(target: SshTarget, command: string, script: string): { jobId: string } {
    const jobId = `deploy-${randomUUID()}`;
    const controller = new AbortController();
    this.jobs.set(jobId, controller);
    // Defer until the invoke result containing jobId can reach the renderer.
    setImmediate(() => void this.run(jobId, target, command, script, controller));
    return { jobId };
  }
  private async run(
    jobId: string,
    target: SshTarget,
    command: string,
    script: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const result = await this.options.execute({
        target,
        command,
        script,
        signal: controller.signal,
        timeoutMs: this.options.jobTimeoutMs ?? 30 * 60 * 1000,
        onLine: (stream, text) => this.options.emit({ jobId, kind: "log", text, stream }),
      });
      if (controller.signal.aborted) throw new Error("Cancelled");
      if (result.code !== 0) {
        const methods =
          result.stderr.match(/Permission denied \(([^)]+)\)/iu)?.[1].split(",") ?? [];
        this.options.emit({
          jobId,
          kind: "error",
          detail: result.stderr.trim() || `SSH exited with code ${result.code}`,
          cancelled: false,
          ...(methods.some((method) => method === "password" || method === "keyboard-interactive")
            ? {
                failure: {
                  kind: "ssh-auth",
                  methods,
                  passwordTried: Boolean(target.sshPassword),
                } as const,
              }
            : {}),
        });
      } else this.options.emit({ jobId, kind: "done", text: "Finished" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.emit({
        jobId,
        kind: "error",
        detail: controller.signal.aborted ? "Cancelled" : message,
        cancelled: controller.signal.aborted,
      });
    } finally {
      this.jobs.delete(jobId);
    }
  }
}
