import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { CompanionNotebookStore } from "../store.js";
import { CompanionNoteKindSchema, CompanionNoteStatusSchema } from "../notebook.js";
import { createCompanionAgentTools, type CompanionAgentToolDependencies } from "./agents.js";
import {
  createCompanionThinkingTools,
  type CompanionThinkingToolDependencies,
} from "./thinking.js";

export const COMPANION_TOOL_NAMES = [
  "list_workspaces",
  "list_agents",
  "get_agent_status",
  "list_jobs",
  "get_job_result",
  "send_agent_prompt",
  "create_agent",
  "cancel_agent",
  "respond_to_permission",
  "end_conversation",
  "note",
  "think",
  "read_timeline",
  "research",
] as const;

export type CompanionToolName = (typeof COMPANION_TOOL_NAMES)[number];

export type CompanionToolResult = { ok: true; content: string } | { ok: false; error: string };

export interface CompanionTool {
  name: CompanionToolName;
  description: string;
  /** Deferred tools return a job id immediately; the answer arrives in a later turn. */
  deferred: boolean;
  /** JSON Schema, for the Messages API tool declaration. */
  inputSchema: Anthropic.Tool.InputSchema;
  /** The same shape in Zod, for the agent SDK's in-process MCP tool declaration. */
  inputShape: z.ZodRawShape;
  invoke: (input: unknown) => Promise<CompanionToolResult>;
}

interface CompanionToolConfig<Schema extends z.ZodObject> {
  name: CompanionToolName;
  description: string;
  deferred: boolean;
  schema: Schema;
  handler: (input: z.infer<Schema>) => Promise<unknown>;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Binds a Zod schema to its handler so the catalog can stay untyped at the seam
 * without a cast: validation happens here, and the handler only ever sees a
 * parsed value.
 */
export function defineCompanionTool<Schema extends z.ZodObject>(
  config: CompanionToolConfig<Schema>,
): CompanionTool {
  const jsonSchema = z.toJSONSchema(config.schema, {
    target: "draft-07",
    unrepresentable: "any",
    io: "input",
  });
  return {
    name: config.name,
    description: config.description,
    deferred: config.deferred,
    inputSchema: { ...jsonSchema, type: "object" },
    inputShape: config.schema.shape,
    invoke: async (input) => {
      const parsed = config.schema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: formatIssues(parsed.error) };
      }
      try {
        return { ok: true, content: JSON.stringify(await config.handler(parsed.data)) };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return { ok: false, error: err.message };
      }
    },
  };
}

export interface CompanionToolDependencies
  extends Omit<CompanionAgentToolDependencies, "deferredJobs">, CompanionThinkingToolDependencies {
  notebook: CompanionNotebookStore;
  endConversation?: () => void;
}

export function createCompanionNotebookTool(notebook: CompanionNotebookStore): CompanionTool {
  return defineCompanionTool({
    name: "note",
    description:
      "Write or update one line in your notebook. Reuse the same id to update an existing line rather than adding a second one about the same thing.",
    deferred: false,
    schema: z.object({
      id: z.string().min(1).describe("Stable slug for this topic or task, e.g. 'flaky-push-test'."),
      kind: CompanionNoteKindSchema,
      text: z.string().min(1).describe("One line of current state. Not a history."),
      status: CompanionNoteStatusSchema.default("open"),
      agentId: z.string().min(1).nullable().default(null),
    }),
    handler: async (input) => {
      const updated = await notebook.note(input);
      return { noteCount: updated.notes.length };
    },
  });
}

export function createCompanionTools(deps: CompanionToolDependencies): CompanionTool[] {
  return [
    defineCompanionTool({
      name: "list_jobs",
      description:
        "Read the latest twenty durable task receipts, including work from earlier conversations. Never poll repeatedly.",
      deferred: false,
      schema: z.object({}),
      handler: async () =>
        deps.deferredJobs
          .list()
          .slice(-20)
          .map((job) => ({
            jobId: job.jobId,
            label: job.label,
            status: job.status,
            agentId: job.agentId,
            workspaceId: job.workspaceId,
          })),
    }),
    defineCompanionTool({
      name: "get_job_result",
      description:
        "Read the saved result of one durable task receipt without rerunning it. An accepted or running task has not completed.",
      deferred: false,
      schema: z.object({ jobId: z.string().min(1) }),
      handler: async ({ jobId }) => {
        const job = deps.deferredJobs.get(jobId);
        if (!job) throw new Error("That task receipt was not found. Use list_jobs to identify it.");
        return job;
      },
    }),
    ...(deps.endConversation
      ? [
          defineCompanionTool({
            name: "end_conversation",
            description:
              "End the voice conversation when the user asks to stop talking. Running tasks continue.",
            deferred: false,
            schema: z.object({}),
            handler: async () => {
              deps.endConversation?.();
              return { status: "ended" };
            },
          }),
        ]
      : []),
    ...createCompanionAgentTools(deps),
    createCompanionNotebookTool(deps.notebook),
    ...createCompanionThinkingTools(deps),
  ];
}

export async function invokeCompanionTool(
  tools: readonly CompanionTool[],
  name: string,
  input: unknown,
): Promise<CompanionToolResult> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    return { ok: false, error: `Unknown tool ${name}` };
  }
  return tool.invoke(input);
}
