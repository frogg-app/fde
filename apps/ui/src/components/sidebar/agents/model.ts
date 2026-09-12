import type { Agent } from "@/stores/session-store";
import type { ProviderSubagentDescriptorPayload } from "@fde/protocol/messages";
import type { SubagentRow } from "@/subagents/select";
import { providerSubagentKey } from "@/subagents/provider-store";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface SidebarAgentNode {
  key: string;
  serverId: string;
  workspaceId: string;
  row: SubagentRow;
  target: WorkspaceTabTarget;
  children: SidebarAgentNode[];
}

export interface SidebarAgentHost {
  serverId: string;
  agents: ReadonlyMap<string, Agent>;
  providerSubagentsSupported: boolean;
}

/** Identity follows the owning session, including for cross-workspace children. */
export function buildSidebarAgentTrees(input: {
  hosts: readonly SidebarAgentHost[];
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>;
  hidden: ReadonlySet<string>;
}): ReadonlyMap<string, SidebarAgentNode[]> {
  const workspaces = new Map<string, SidebarAgentNode[]>();
  for (const host of input.hosts) {
    const nodes = new Map<string, SidebarAgentNode>();
    for (const agent of host.agents.values()) {
      if (agent.archivedAt || !agent.workspaceId) continue;
      nodes.set(agent.id, {
        key: `${host.serverId}\0agent\0${agent.id}`,
        serverId: host.serverId,
        workspaceId: agent.workspaceId,
        row: {
          kind: "fde",
          id: agent.id,
          provider: agent.provider,
          title: agent.title,
          description: null,
          subtitle: null,
          status: agent.status,
          requiresAttention: agent.requiresAttention,
          createdAt: agent.createdAt,
        },
        target: { kind: "agent", agentId: agent.id },
        children: [],
      });
    }
    for (const [id, node] of nodes) {
      const parentId = host.agents.get(id)?.parentAgentId;
      const parent = parentId ? nodes.get(parentId) : undefined;
      // A broken/cyclic relationship must not hide the session or recurse forever.
      const ancestors = new Set([id]);
      let ancestorId = parentId;
      while (ancestorId && !ancestors.has(ancestorId)) {
        ancestors.add(ancestorId);
        ancestorId = host.agents.get(ancestorId)?.parentAgentId;
      }
      if (parent && !ancestorId) parent.children.push(node);
      // Cross-workspace children also appear in their own workspace, matching tab visibility.
      if (!parent || ancestorId || parent.workspaceId !== node.workspaceId) {
        const key = buildWorkspaceTabPersistenceKey(node);
        if (!key) continue;
        const roots = workspaces.get(key) ?? [];
        roots.push(node);
        workspaces.set(key, roots);
      }
    }
    appendProviderChildren({ host, nodes, descriptors: input.descriptors, hidden: input.hidden });
    for (const node of nodes.values()) node.children.sort(byCreatedAt);
    pruneWorkspaceChildren(workspaces, host);
  }
  for (const roots of workspaces.values()) roots.sort(byCreatedAt);
  return workspaces;
}

function pruneWorkspaceChildren(
  workspaces: Map<string, SidebarAgentNode[]>,
  host: SidebarAgentHost,
) {
  for (const roots of workspaces.values()) {
    if (roots[0]?.serverId !== host.serverId) continue;
    for (const node of roots) node.children = activeChildren(node.children, host.agents);
  }
}

// Preserve workspace instances, and promote running descendants of idle intermediates.
function activeChildren(
  children: SidebarAgentNode[],
  agents: ReadonlyMap<string, Agent>,
): SidebarAgentNode[] {
  return children.flatMap((node) => {
    const descendants = activeChildren(node.children, agents);
    const agent = node.row.kind === "fde" ? agents.get(node.row.id) : undefined;
    const active =
      node.row.status === "running" ||
      node.row.status === "initializing" ||
      (agent?.pendingPermissions.length ?? 0) > 0;
    return active ? [{ ...node, children: descendants }] : descendants;
  });
}

function appendProviderChildren({
  host,
  nodes,
  descriptors,
  hidden,
}: {
  host: SidebarAgentHost;
  nodes: Map<string, SidebarAgentNode>;
  descriptors: ReadonlyMap<string, ProviderSubagentDescriptorPayload>;
  hidden: ReadonlySet<string>;
}) {
  for (const [key, descriptor] of descriptors) {
    const parent = nodes.get(descriptor.parentAgentId);
    const expectedKey = providerSubagentKey(host.serverId, descriptor.parentAgentId, descriptor.id);
    if (
      !host.providerSubagentsSupported ||
      !parent ||
      key !== expectedKey ||
      hidden.has(key) ||
      descriptor.status !== "running"
    )
      continue;
    parent.children.push({
      key: `${host.serverId}\0provider\0${descriptor.parentAgentId}\0${descriptor.id}`,
      serverId: host.serverId,
      workspaceId: parent.workspaceId,
      row: {
        kind: "provider",
        id: descriptor.id,
        parentAgentId: descriptor.parentAgentId,
        provider: descriptor.provider,
        title: descriptor.title,
        description: descriptor.description,
        subtitle: descriptor.subtitle ?? null,
        status: descriptor.status,
        requiresAttention: false,
        createdAt: new Date(descriptor.createdAt),
      },
      target: {
        kind: "provider_subagent",
        parentAgentId: descriptor.parentAgentId,
        subagentId: descriptor.id,
      },
      children: [],
    });
  }
}

function byCreatedAt(left: SidebarAgentNode, right: SidebarAgentNode): number {
  return (
    left.row.createdAt.getTime() - right.row.createdAt.getTime() ||
    left.key.localeCompare(right.key)
  );
}
