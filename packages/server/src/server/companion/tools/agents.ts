import { z } from "zod";
import type { Logger } from "pino";

import type { AgentManager, ManagedAgent } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import { sendPromptToAgent, startCreatedAgentInitialPrompt } from "../../agent/agent-prompt.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import type { CompanionDeferredJobs } from "../deferred-jobs.js";
import { defineCompanionTool, type CompanionTool } from "./index.js";

/**
 * Everything the fast tools touch. All local to the daemon, all answered inside
 * the conversational turn — nothing here is allowed to wait on a provider.
 */
export interface CompanionAgentToolDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  workspaceRegistry: Pick<WorkspaceRegistry, "list" | "get">;
  logger: Logger;
  deferredJobs?: CompanionDeferredJobs;
  conversationId?: string;
}

interface CompanionAgentSummary {
  agentId: string;
  title: string;
  workspaceId: string | null;
  provider: string;
  status: ManagedAgent["lifecycle"];
  needsAttention: boolean;
  lastActivityAt: string;
}

function summarizeAgent(agent: ManagedAgent): CompanionAgentSummary {
  return {
    agentId: agent.id,
    title: agent.config.title ?? "untitled",
    workspaceId: agent.workspaceId ?? null,
    provider: agent.provider,
    status: agent.lifecycle,
    needsAttention: agent.attention.requiresAttention,
    lastActivityAt: agent.updatedAt.toISOString(),
  };
}

function visibleAgents(deps: CompanionAgentToolDependencies): ManagedAgent[] {
  return deps.agentManager.listAgents().filter((agent) => !agent.internal);
}

function requireAgent(deps: CompanionAgentToolDependencies, agentId: string): ManagedAgent {
  const agent = deps.agentManager.getAgent(agentId);
  if (!agent || agent.internal) {
    throw new CompanionToolTargetError(`No agent with id ${agentId}`);
  }
  return agent;
}

/** A tool asked for something that is not there. Spoken back, not logged and swallowed. */
export class CompanionToolTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanionToolTargetError";
  }
}

export function createCompanionAgentTools(deps: CompanionAgentToolDependencies): CompanionTool[] {
  return [
    defineCompanionTool({
      name: "respond_to_permission",
      description:
        "Answer one specific pending permission after the user explicitly approves or denies it. Always identify the agent and request; an ambiguous yes is not permission.",
      deferred: false,
      schema: z.object({
        agentId: z.string().min(1),
        requestId: z.string().min(1),
        decision: z.enum(["allow", "deny"]),
      }),
      handler: async (input) => {
        const agent = requireAgent(deps, input.agentId);
        if (!agent.pendingPermissions.has(input.requestId))
          throw new CompanionToolTargetError("That permission request is no longer pending.");
        await deps.agentManager.respondToPermission(agent.id, input.requestId, {
          behavior: input.decision,
        });
        return { status: "resolved", requestId: input.requestId };
      },
    }),
    defineCompanionTool({
      name: "list_workspaces",
      description:
        "List the active workspaces on this daemon with their project, branch and agent count.",
      deferred: false,
      schema: z.object({}),
      handler: async () => {
        const workspaces = await deps.workspaceRegistry.list();
        const agents = visibleAgents(deps);
        return {
          workspaces: workspaces
            .filter((workspace) => !workspace.archivedAt)
            .map((workspace) => ({
              workspaceId: workspace.workspaceId,
              name: workspace.title ?? workspace.displayName,
              projectId: workspace.projectId,
              branch: workspace.branch,
              agentCount: agents.filter((agent) => agent.workspaceId === workspace.workspaceId)
                .length,
            })),
        };
      },
    }),

    defineCompanionTool({
      name: "list_agents",
      description:
        "List the agents on this daemon, newest activity first. Optionally filter to one workspace.",
      deferred: false,
      schema: z.object({
        workspaceId: z.string().min(1).nullable().default(null),
      }),
      handler: async (input) => {
        const agents = visibleAgents(deps)
          .filter((agent) => input.workspaceId === null || agent.workspaceId === input.workspaceId)
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
          .map(summarizeAgent);
        return { agents };
      },
    }),

    defineCompanionTool({
      name: "get_agent_status",
      description: "Get one agent's status, model and current turn state.",
      deferred: false,
      schema: z.object({ agentId: z.string().min(1) }),
      handler: async (input) => {
        const agent = requireAgent(deps, input.agentId);
        return {
          ...summarizeAgent(agent),
          model: agent.config.model ?? null,
          modeId: agent.currentModeId,
          hasActiveTurn: agent.activeTurnId !== null,
          pendingPermissions: Array.from(agent.pendingPermissions.values()).map((request) => ({
            requestId: request.id,
            name: request.name,
            title: request.title,
            description: request.description,
            kind: request.kind,
          })),
          lastError: agent.lifecycle === "error" ? (agent.lastError ?? null) : null,
        };
      },
    }),

    defineCompanionTool({
      name: "send_agent_prompt",
      description:
        "Queue a prompt to an existing agent. Returns as soon as the turn is dispatched; it does not wait for the agent to answer.",
      deferred: false,
      schema: z.object({
        agentId: z.string().min(1),
        prompt: z.string().min(1),
      }),
      handler: async (input) => {
        const agent = requireAgent(deps, input.agentId);
        const dispatch = async (jobId?: string) => {
          await sendPromptToAgent({
            agentManager: deps.agentManager,
            agentStorage: deps.agentStorage,
            agentId: agent.id,
            prompt: input.prompt,
            logger: deps.logger,
          });
          if (jobId) deps.deferredJobs?.attachAgent(jobId, requireAgent(deps, agent.id));
        };
        if (deps.deferredJobs)
          return deps.deferredJobs.start(
            {
              conversationId: deps.conversationId,
              kind: "agent",
              label: agent.config.title ?? "Agent task",
              question: input.prompt,
              agentId: agent.id,
              workspaceId: agent.workspaceId ?? undefined,
            },
            dispatch,
          );
        await dispatch();
        return { agentId: agent.id, disposition: "dispatched" };
      },
    }),

    defineCompanionTool({
      name: "create_agent",
      description:
        "Start a new agent in an existing workspace with an initial prompt. Call list_workspaces first if the workspace is not already known.",
      deferred: false,
      schema: z.object({
        workspaceId: z.string().min(1),
        provider: z.string().min(1),
        prompt: z.string().min(1),
        title: z.string().min(1).nullable().default(null),
      }),
      handler: async (input) => {
        const workspace = await deps.workspaceRegistry.get(input.workspaceId);
        if (!workspace || workspace.archivedAt) {
          throw new CompanionToolTargetError(`No active workspace with id ${input.workspaceId}`);
        }
        const dispatch = async (jobId?: string) => {
          const created = await deps.agentManager.createAgent(
            { provider: input.provider, cwd: workspace.cwd, title: input.title },
            undefined,
            { workspaceId: workspace.workspaceId, initialTitle: input.title },
          );
          await startCreatedAgentInitialPrompt({
            agentManager: deps.agentManager,
            agentId: created.id,
            snapshot: created,
            prompt: input.prompt,
            logger: deps.logger,
          });
          if (jobId) deps.deferredJobs?.attachAgent(jobId, requireAgent(deps, created.id));
          return { agentId: created.id, workspaceId: workspace.workspaceId };
        };
        if (deps.deferredJobs)
          return deps.deferredJobs.start(
            {
              conversationId: deps.conversationId,
              kind: "agent",
              label: input.title ?? "New agent task",
              question: input.prompt,
              agentId: null,
              workspaceId: workspace.workspaceId,
            },
            async (jobId) => {
              await dispatch(jobId);
            },
          );
        return dispatch();
      },
    }),

    defineCompanionTool({
      name: "cancel_agent",
      description: "Cancel an agent's current turn.",
      deferred: false,
      schema: z.object({ agentId: z.string().min(1) }),
      handler: async (input) => {
        const agent = requireAgent(deps, input.agentId);
        const result = await deps.agentManager.cancelAgentRun(agent.id);
        return { agentId: agent.id, result: result.status };
      },
    }),
  ];
}
