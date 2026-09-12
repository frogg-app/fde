import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, it } from "vitest";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentStorage } from "../agent/agent-storage.js";
import { sendPromptToAgent } from "../agent/agent-prompt.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { CompanionDeferredJobs } from "./deferred-jobs.js";
import { watchCompanionAgent } from "./watch-agent.js";

it("observes an already running worker and preserves its receipt after the conversation ends", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "fde-companion-observe-"));
  const logger = pino({ level: "silent" });
  const storage = new AgentStorage(home, logger);
  const manager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const jobs = new CompanionDeferredJobs({
    logger,
    run: async () => {
      throw new Error("Must not dispatch another worker");
    },
  });
  const observe = manager.subscribe((event) => {
    if (event.type === "agent_state") jobs.observeAgent(event.agent);
  });
  let unwatch = () => {};
  try {
    await writeFile(path.join(home, "permission.txt"), "keep me");
    const agent = await manager.createAgent(
      { provider: "claude", cwd: home, modeId: "default" },
      undefined,
      {},
    );
    await sendPromptToAgent({
      agentManager: manager,
      agentStorage: storage,
      agentId: agent.id,
      prompt: "Run rm -f permission.txt",
      logger,
    });
    await expect.poll(() => manager.getAgent(agent.id)?.pendingPermissions.size).toBe(1);
    unwatch = watchCompanionAgent({
      agentManager: manager,
      jobs,
      agentId: agent.id,
      conversationId: "conversation",
    });
    expect(jobs.list()).toHaveLength(1);
    expect(jobs.list()[0].summary).toContain("Permission needed");
    const duplicate = watchCompanionAgent({
      agentManager: manager,
      jobs,
      agentId: agent.id,
      conversationId: "conversation",
    });
    duplicate();
    expect(jobs.list()).toHaveLength(1);
    unwatch(); // End only stops observing future tasks; this task keeps its receipt.
    const pending = manager.getAgent(agent.id)?.pendingPermissions.values().next().value;
    if (!pending) throw new Error("Expected the worker's actual permission");
    await manager.respondToPermission(agent.id, pending.id, { behavior: "deny" });
    await expect.poll(() => jobs.list()[0].status).toBe("succeeded");
    expect(jobs.list()[0].agentId).toBe(agent.id);
  } finally {
    unwatch();
    observe();
    manager.prepareForShutdown();
    await Promise.all(manager.listAgents().map((agent) => manager.closeAgent(agent.id)));
    await manager.flushForShutdown();
    await storage.flush();
    await rm(home, { recursive: true, force: true });
  }
});
