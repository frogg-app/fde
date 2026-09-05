import { useShallow } from "zustand/react/shallow";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { companionUnavailableReason, isCompanionAvailable } from "./availability";

export interface CompanionHost {
  serverId: string | null;
  isAvailable: boolean;
  /** The daemon's own words for why it cannot run a session, or null. */
  unavailableReason: string | null;
}

/**
 * The daemon the Companion talks to. v1 orchestrates one daemon (docs/companion.md
 * § Scope), so this is the host you are already looking at, or the only connected
 * one when you are not in a workspace.
 */
export function useCompanionHost(): CompanionHost {
  const activeServerId = useActiveWorkspaceSelection()?.serverId ?? null;
  const connectedServerIds = useSessionStore(
    useShallow((state) =>
      Object.keys(state.sessions).filter((serverId) => state.sessions[serverId]?.serverInfo),
    ),
  );
  const serverId = resolveServerId(activeServerId, connectedServerIds);
  const serverInfo = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.serverInfo ?? null) : null,
  );

  return {
    serverId,
    isAvailable: serverId !== null && isCompanionAvailable(serverInfo),
    unavailableReason: companionUnavailableReason(serverInfo),
  };
}

function resolveServerId(
  activeServerId: string | null,
  connected: readonly string[],
): string | null {
  if (activeServerId && connected.includes(activeServerId)) return activeServerId;
  return connected.length === 1 ? connected[0] : (activeServerId ?? null);
}
