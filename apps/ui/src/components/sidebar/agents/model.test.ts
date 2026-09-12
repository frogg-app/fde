import { describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import type { ProviderSubagentDescriptorPayload } from "@fde/protocol/messages";
import { providerSubagentKey } from "@/subagents/provider-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { buildSidebarAgentTrees } from "./model";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "ws-main";
const WORKSPACE_DIRECTORY = "/repo/worktree";
const AGENT_TIMESTAMP = new Date("2026-04-21T10:00:00.000Z");

const AGENT_DEFAULTS: Agent = {
  serverId: SERVER_ID,
  id: "agent",
  provider: "codex",
  status: "idle",
  activeTurn: null,
  createdAt: AGENT_TIMESTAMP,
  updatedAt: AGENT_TIMESTAMP,
  lastUserMessageAt: null,
  lastActivityAt: AGENT_TIMESTAMP,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  runtimeInfo: undefined,
  lastUsage: undefined,
  lastError: null,
  title: "Agent",
  cwd: WORKSPACE_DIRECTORY,
  workspaceId: WORKSPACE_ID,
  model: null,
  features: undefined,
  thinkingOptionId: undefined,
  requiresAttention: false,
  attentionReason: null,
  attentionTimestamp: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
  projectPlacement: null,
};

function makeAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  return { ...AGENT_DEFAULTS, ...input };
}

function project(
  agents: Agent[],
  descriptors: ProviderSubagentDescriptorPayload[] = [],
  hidden: ReadonlySet<string> = new Set(),
) {
  return buildSidebarAgentTrees({
    hosts: [
      {
        serverId: SERVER_ID,
        agents: new Map(agents.map((agent) => [agent.id, agent])),
        providerSubagentsSupported: true,
      },
    ],
    descriptors: new Map(
      descriptors.map((child) => [
        providerSubagentKey(SERVER_ID, child.parentAgentId, child.id),
        child,
      ]),
    ),
    hidden,
  });
}
const workspaceKey = buildWorkspaceTabPersistenceKey({
  serverId: SERVER_ID,
  workspaceId: WORKSPACE_ID,
})!;
const providerChild: ProviderSubagentDescriptorPayload = {
  id: "native",
  parentAgentId: "parent",
  provider: "codex",
  title: "Worker",
  description: "Inspect sidebar",
  status: "running",
  createdAt: AGENT_TIMESTAMP.toISOString(),
  updatedAt: AGENT_TIMESTAMP.toISOString(),
  toolCallId: "spawn-1",
};

describe("sidebar session tree", () => {
  it("opens managed descendants and native children using their original runtime identities", () => {
    const tree = project(
      [
        makeAgent({ id: "parent" }),
        makeAgent({ id: "child", parentAgentId: "parent" }),
        makeAgent({ id: "grandchild", parentAgentId: "child" }),
      ],
      [providerChild],
    );
    const roots = tree.get(workspaceKey)!;
    expect(roots).toHaveLength(1);
    expect(roots[0].children.map((node) => node.target)).toEqual([
      { kind: "agent", agentId: "child" },
      { kind: "provider_subagent", parentAgentId: "parent", subagentId: "native" },
    ]);
    expect(roots[0].children[0].children[0].target).toEqual({
      kind: "agent",
      agentId: "grandchild",
    });
  });

  it("keeps cross-workspace children under their parent and opens their own workspace", () => {
    const tree = project([
      makeAgent({ id: "parent" }),
      makeAgent({ id: "child", parentAgentId: "parent", workspaceId: "other" }),
    ]);
    const nested = tree.get(workspaceKey)![0].children[0];
    const otherKey = buildWorkspaceTabPersistenceKey({
      serverId: SERVER_ID,
      workspaceId: "other",
    })!;
    expect(nested.workspaceId).toBe("other");
    expect(tree.get(otherKey)).toEqual([nested]);
  });

  it("reclassifies detached agents and removes archived children", () => {
    const parent = makeAgent({ id: "parent" });
    const detached = makeAgent({ id: "detached", parentAgentId: null });
    const archived = makeAgent({
      id: "archived",
      parentAgentId: "parent",
      archivedAt: AGENT_TIMESTAMP,
    });
    const roots = project([parent, detached, archived]).get(workspaceKey)!;
    expect(roots.map((node) => node.row.id).sort()).toEqual(["detached", "parent"]);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
  });

  it("honors archive-finished visibility and keeps failed provider activity inspectable", () => {
    const parent = makeAgent({ id: "parent" });
    const failed = { ...providerChild, status: "failed" as const };
    expect(project([parent], [failed]).get(workspaceKey)![0].children[0].row.status).toBe("failed");
    const hidden = new Set([providerSubagentKey(SERVER_ID, "parent", "native")]);
    expect(project([parent], [failed], hidden).get(workspaceKey)![0].children).toEqual([]);
  });

  it("isolates identical child and parent ids on separate hosts and gates unsupported hosts", () => {
    const agents = new Map([["parent", makeAgent({ id: "parent" })]]);
    const tree = buildSidebarAgentTrees({
      hosts: [
        { serverId: SERVER_ID, agents, providerSubagentsSupported: true },
        { serverId: "other-host", agents, providerSubagentsSupported: true },
        { serverId: "old-host", agents, providerSubagentsSupported: false },
      ],
      descriptors: new Map([[providerSubagentKey(SERVER_ID, "parent", "native"), providerChild]]),
      hidden: new Set(),
    });
    expect(tree.get(workspaceKey)![0].children).toHaveLength(1);
    for (const serverId of ["other-host", "old-host"]) {
      const key = buildWorkspaceTabPersistenceKey({ serverId, workspaceId: WORKSPACE_ID })!;
      expect(tree.get(key)![0].children).toEqual([]);
    }
  });

  it("keeps missing-parent and cyclic sessions reachable without recursive trees", () => {
    const tree = project([
      makeAgent({ id: "orphan", parentAgentId: "missing" }),
      makeAgent({ id: "a", parentAgentId: "b" }),
      makeAgent({ id: "b", parentAgentId: "a" }),
    ]);
    const roots = tree.get(workspaceKey)!;
    expect(roots).toHaveLength(3);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
  });
});
