import { z } from "zod";
import type { Logger } from "pino";

import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentTimelineItem } from "../../agent/agent-sdk-types.js";
import { generateStructuredAgentResponseWithFallback } from "../../agent/agent-response-loop.js";
import {
  resolveStructuredGenerationProviders,
  type StructuredGenerationDaemonConfig,
} from "../../agent/structured-generation-providers.js";
import type { ProviderSnapshotManager } from "../../agent/provider-snapshot-manager.js";
import type {
  CompanionDeferredJobRequest,
  CompanionDeferredJobRunner,
  CompanionDeferredJobs,
} from "../deferred-jobs.js";
import { defineCompanionTool, type CompanionTool } from "./index.js";

export interface CompanionThinkingToolDependencies {
  deferredJobs: CompanionDeferredJobs;
}

export interface CompanionSubagentRunnerOptions {
  agentManager: AgentManager;
  providerSnapshotManager: Pick<ProviderSnapshotManager, "listProviders">;
  daemonConfig: StructuredGenerationDaemonConfig | null;
  /** Where the ephemeral subagent runs. The daemon's own project root is fine. */
  cwd: string;
  logger: Logger;
}

const SubagentAnswerSchema = z.object({
  answer: z.string().min(1).max(1200),
});

/** How many timeline items a read_timeline job hands to its subagent. */
const TIMELINE_WINDOW = 40;

const TIMELINE_ITEM_CHAR_LIMIT = 600;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > TIMELINE_ITEM_CHAR_LIMIT
    ? `${collapsed.slice(0, TIMELINE_ITEM_CHAR_LIMIT)}…`
    : collapsed;
}

function renderTimelineItem(item: AgentTimelineItem): string | null {
  if (item.type === "user_message") {
    return `user: ${truncate(item.text)}`;
  }
  if (item.type === "assistant_message") {
    return `assistant: ${truncate(item.text)}`;
  }
  if (item.type === "tool_call") {
    return `tool ${item.name}: ${item.status}`;
  }
  if (item.type === "error") {
    return `error: ${truncate(item.message)}`;
  }
  return null;
}

function renderTimeline(items: readonly AgentTimelineItem[]): string {
  const lines: string[] = [];
  for (const item of items.slice(-TIMELINE_WINDOW)) {
    const line = renderTimelineItem(item);
    if (line) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}

const CONTRACT = [
  "You are answering for a voice assistant that is going to read your answer out loud.",
  "Reply with one short paragraph, at most three sentences, in plain prose.",
  "No markdown, no lists, no code blocks, no file paths spelled out character by character.",
  "If the material does not answer the question, say so instead of guessing.",
].join("\n");

function buildPrompt(request: CompanionDeferredJobRequest, timeline: string): string {
  const sections = [CONTRACT, "", `Question: ${request.question}`];
  if (timeline) {
    sections.push("", `Recent activity for agent ${request.agentId}:`, timeline);
  }
  sections.push("", "Return JSON only, with a single field 'answer'.");
  return sections.join("\n");
}

/**
 * Runs deferred work as a headless ephemeral agent: `internal` keeps it out of
 * the sidebar, `persistSession: false` keeps it off disk, and the provider list
 * prefers Haiku and its cheap peers.
 */
export function createCompanionSubagentRunner(
  options: CompanionSubagentRunnerOptions,
): CompanionDeferredJobRunner {
  return async (request) => {
    const timeline =
      request.kind === "read_timeline" && request.agentId
        ? renderTimeline(options.agentManager.getTimeline(request.agentId))
        : "";
    const providers = await resolveStructuredGenerationProviders({
      cwd: options.cwd,
      providerSnapshotManager: options.providerSnapshotManager,
      daemonConfig: options.daemonConfig,
    });
    const result = await generateStructuredAgentResponseWithFallback({
      manager: options.agentManager,
      cwd: options.cwd,
      prompt: buildPrompt(request, timeline),
      schema: SubagentAnswerSchema,
      schemaName: "CompanionAnswer",
      maxRetries: 1,
      providers,
      persistSession: false,
      logger: options.logger,
      agentConfigOverrides: {
        title: `Companion ${request.kind}`,
        internal: true,
      },
    });
    return result.answer;
  };
}

export function createCompanionThinkingTools(
  deps: CompanionThinkingToolDependencies,
): CompanionTool[] {
  return [
    defineCompanionTool({
      name: "think",
      description:
        "Hand a question to a subagent to reason about. Returns immediately with a job id; the answer arrives in a later turn. You MUST also say a short line in this same response so the user is not left in silence.",
      deferred: true,
      schema: z.object({
        question: z.string().min(1),
        label: z.string().min(1).describe("Three or four words naming the work, for the UI."),
      }),
      handler: async (input) =>
        deps.deferredJobs.start({
          kind: "think",
          label: input.label,
          question: input.question,
          agentId: null,
        }),
    }),

    defineCompanionTool({
      name: "read_timeline",
      description:
        "Have a subagent read an agent's recent timeline and report what happened. Returns immediately with a job id. You MUST also say a short line in this same response.",
      deferred: true,
      schema: z.object({
        agentId: z.string().min(1),
        question: z.string().min(1),
        label: z.string().min(1),
      }),
      handler: async (input) =>
        deps.deferredJobs.start({
          kind: "read_timeline",
          label: input.label,
          question: input.question,
          agentId: input.agentId,
        }),
    }),

    defineCompanionTool({
      name: "research",
      description:
        "Hand a longer investigation to a subagent with file and web access. Slower than think. Returns immediately with a job id. You MUST also say a short line in this same response.",
      deferred: true,
      schema: z.object({
        question: z.string().min(1),
        label: z.string().min(1),
      }),
      handler: async (input) =>
        deps.deferredJobs.start({
          kind: "research",
          label: input.label,
          question: input.question,
          agentId: null,
        }),
    }),
  ];
}
