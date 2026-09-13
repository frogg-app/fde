import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, it, vi } from "vitest";
import { AgentManager } from "../../agent/agent-manager.js";
import { AgentStorage } from "../../agent/agent-storage.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";
import { CompanionDeferredJobs } from "../deferred-jobs.js";
import { createCompanionAgentTools } from "./agents.js";
import { invokeCompanionTool } from "./index.js";

it("tracks an ordinary worker through a permission without accepting an unrelated request", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "frogg-companion-worker-"));
  const logger = pino({ level: "silent" });
  const storage = new AgentStorage(home, logger);
  const manager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const jobs = new CompanionDeferredJobs({
    logger,
    filePath: path.join(home, "jobs.json"),
    run: async () => {
      throw new Error("Ordinary jobs must use the worker");
    },
  });
  const unsubscribe = manager.subscribe((event) => {
    if (event.type === "agent_state") jobs.observeAgent(event.agent);
  });
  try {
    await writeFile(path.join(home, "permission.txt"), "keep me");
    const agent = await manager.createAgent(
      { provider: "claude", cwd: home, modeId: "default" },
      undefined,
      {},
    );
    const tools = createCompanionAgentTools({
      agentManager: manager,
      agentStorage: storage,
      workspaceRegistry: { list: async () => [], get: async () => null },
      deferredJobs: jobs,
      logger,
    });
    const receipt = await invokeCompanionTool(tools, "send_agent_prompt", {
      agentId: agent.id,
      prompt: "Run rm -f permission.txt",
    });
    expect(receipt.ok).toBe(true);
    await vi.waitFor(() => expect(manager.getAgent(agent.id)?.pendingPermissions.size).toBe(1));
    const request = manager.getAgent(agent.id)?.pendingPermissions.values().next().value;
    if (!request) throw new Error("Expected an actual permission request");
    await vi.waitFor(() => expect(jobs.list()[0].summary).toContain(request.id));
    expect(jobs.list()[0].status).toBe("running");
    const unrelated = await invokeCompanionTool(tools, "respond_to_permission", {
      agentId: agent.id,
      requestId: "unrelated",
      decision: "allow",
    });
    expect(unrelated.ok).toBe(false);
    expect(await readFile(path.join(home, "permission.txt"), "utf8")).toBe("keep me");
    const denied = await invokeCompanionTool(tools, "respond_to_permission", {
      agentId: agent.id,
      requestId: request.id,
      decision: "deny",
    });
    expect(denied.ok).toBe(true);
    await vi.waitFor(() => expect(jobs.list()[0].status).not.toBe("running"));
    expect(await readFile(path.join(home, "permission.txt"), "utf8")).toBe("keep me");
    const restored = new CompanionDeferredJobs({
      logger,
      filePath: path.join(home, "jobs.json"),
      run: async () => "unused",
    });
    expect(restored.list()[0].agentId).toBe(agent.id);
  } finally {
    unsubscribe();
    manager.prepareForShutdown();
    await Promise.all(manager.listAgents().map((agent) => manager.closeAgent(agent.id)));
    await manager.flushForShutdown();
    await storage.flush();
    await rm(home, { recursive: true, force: true });
  }
});
