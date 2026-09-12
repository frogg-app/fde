import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useFetchQueries } from "@/data/query";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useShallow } from "zustand/react/shallow";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { refreshProviderSubagents, useProviderSubagentStore } from "@/subagents/provider-store";
import { buildSidebarAgentTrees, type SidebarAgentHost, type SidebarAgentNode } from "./model";

interface HostSource extends SidebarAgentHost {
  client: DaemonClient | null;
  generation: number;
}

export interface ChildDiscovery {
  pending: boolean;
  failed: boolean;
  retry: () => void;
  discover: () => void;
}

interface SidebarAgentsContextValue {
  trees: ReadonlyMap<string, SidebarAgentNode[]>;
  discovery: ReadonlyMap<string, ChildDiscovery>;
  offlineHosts: ReadonlySet<string>;
}

const SidebarAgentsContext = createContext<SidebarAgentsContextValue>({
  trees: new Map(),
  discovery: new Map(),
  offlineHosts: new Set(),
});

/** One collection subscription; transcript chunks never run a selector for every agent row. */
export function SidebarAgentsProvider({
  serverIds,
  active,
  children,
}: {
  serverIds: readonly string[];
  active: boolean;
  children: ReactNode;
}) {
  const selection = useActiveWorkspaceSelection();
  const [requestedParents, setRequestedParents] = useState<ReadonlySet<string>>(new Set());
  const hosts = useStoreWithEqualityFn(
    useSessionStore,
    (state): HostSource[] =>
      serverIds.flatMap((serverId) => {
        const session = state.sessions[serverId];
        if (!session) return [];
        return [
          {
            serverId,
            agents: session.agents,
            client: session.client,
            generation: session.clientGeneration,
            providerSubagentsSupported: session.serverInfo?.features?.providerSubagents === true,
          },
        ];
      }),
    sameHosts,
  );
  const { descriptors, hidden } = useProviderSubagentStore(
    useShallow((state) => ({
      descriptors: state.descriptors,
      hidden: state.hiddenFromTrack,
    })),
  );
  const connections = useHostRuntimeConnectionStatuses(serverIds);
  const parents = useMemo(
    () =>
      hosts.flatMap((host) => {
        if (!host.providerSubagentsSupported || !host.client) return [];
        const client = host.client;
        return [...host.agents.values()]
          .filter((agent) => !agent.archivedAt && agent.workspaceId)
          .map((agent) => ({ host, client, agentId: agent.id, workspaceId: agent.workspaceId }));
      }),
    [hosts],
  );
  const queries = useFetchQueries(
    parents.map(({ host, client, agentId, workspaceId }) => ({
      queryKey: [
        "sidebar-subagents",
        host.serverId,
        host.generation,
        getHostRuntimeStore().getSnapshot(host.serverId)?.connectionEpoch,
        agentId,
      ],
      queryFn: async () => {
        await refreshProviderSubagents(client, host.serverId, agentId);
        return true;
      },
      enabled:
        active &&
        connections.get(host.serverId) === "online" &&
        (requestedParents.has(`${host.serverId}\0agent\0${agentId}`) ||
          (selection?.serverId === host.serverId && selection.workspaceId === workspaceId)),
      dataShape: "value",
      staleTimeMs: 60_000,
      retry: 1,
    })),
  );
  const trees = useMemo(
    () => buildSidebarAgentTrees({ hosts, descriptors, hidden }),
    [hosts, descriptors, hidden],
  );
  const value = useMemo(() => {
    const discovery = new Map<string, ChildDiscovery>();
    parents.forEach(({ host, agentId }, index) => {
      const query = queries[index];
      discovery.set(`${host.serverId}\0agent\0${agentId}`, {
        discover: () =>
          setRequestedParents((previous) => {
            const key = `${host.serverId}\0agent\0${agentId}`;
            if (previous.has(key)) return previous;
            return new Set([...previous, key]);
          }),
        pending: query.isPending,
        failed: query.isError,
        retry: () => {
          void query.refetch();
        },
      });
    });
    const offlineHosts = new Set(serverIds.filter((id) => connections.get(id) !== "online"));
    return { trees, discovery, offlineHosts };
  }, [trees, parents, queries, serverIds, connections]);
  return <SidebarAgentsContext.Provider value={value}>{children}</SidebarAgentsContext.Provider>;
}

function sameHosts(left: HostSource[], right: HostSource[]): boolean {
  return (
    left.length === right.length &&
    left.every((host, index) => {
      const other = right[index];
      return (
        host.serverId === other.serverId &&
        host.agents === other.agents &&
        host.client === other.client &&
        host.generation === other.generation &&
        host.providerSubagentsSupported === other.providerSubagentsSupported
      );
    })
  );
}

export function useSidebarAgents() {
  return useContext(SidebarAgentsContext);
}
