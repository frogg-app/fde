import type { AgentManager } from "../agent/agent-manager.js";
import type { CompanionDeferredJobs } from "./deferred-jobs.js";

/** Observe the launcher's existing worker without dispatching or repeating its work. */
export function watchCompanionAgent(input: {
  agentManager: Pick<AgentManager, "subscribe">;
  jobs: CompanionDeferredJobs;
  agentId: string;
  conversationId: string;
  workspaceId?: string;
}): () => void {
  return input.agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_state") return;
      const agent = event.agent;
      if (agent.internal || (input.workspaceId && agent.workspaceId !== input.workspaceId)) return;
      if (agent.lifecycle !== "running" && !agent.pendingPermissions.size) return;
      if (input.jobs.listRunning().some((job) => job.agentId === agent.id)) return;
      input.jobs.start(
        {
          kind: "agent",
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          conversationId: input.conversationId,
          label: agent.config.title ?? "Current task",
          question: "Report the result of the task already running when Companion was opened.",
        },
        async (jobId) => {
          input.jobs.attachAgent(jobId, agent);
        },
      );
    },
    { agentId: input.agentId, replayState: true },
  );
}
