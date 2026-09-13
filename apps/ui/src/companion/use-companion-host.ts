import { useCompanionStore } from "./store";
import type { ServerCapabilities } from "@fde/protocol/messages";
import { useSettings } from "@/hooks/use-settings";
import { useShallow } from "zustand/react/shallow";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  getCompanionReadinessState,
  resolveCompanionUnavailableMessage,
} from "@/utils/server-info-capabilities";

export interface CompanionHost {
  serverId: string | null;
  isAvailable: boolean;
  details: ServerCapabilities["companionDetails"] | null;
  /** The daemon's own words for why it cannot run a session, or null. */
  unavailableReason: string | null;
}

/**
 * The daemon the Companion talks to. v1 orchestrates one daemon (docs/companion.md
 * § Scope), so this is the host you are already looking at, or the only connected
 * one when you are not in a workspace.
 */
export function useCompanionHost(): CompanionHost {
  const enabled = useSettings((settings) => settings.companionEnabled);
  const nativeVoice = useSettings((settings) => settings.companionNativeVoice);
  const requestedServerId = useCompanionStore((state) => state.context?.serverId);
  const boundServerId = useCompanionStore((state) =>
    ["open", "starting", "reconnecting", "stopping"].includes(state.session.status)
      ? state.serverId
      : null,
  );
  const activeServerId = useActiveWorkspaceSelection()?.serverId ?? null;
  const connectedServerIds = useSessionStore(
    useShallow((state) =>
      Object.keys(state.sessions).filter((serverId) => state.sessions[serverId]?.serverInfo),
    ),
  );
  const serverId =
    boundServerId ?? requestedServerId ?? resolveServerId(activeServerId, connectedServerIds);
  const serverInfo = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.serverInfo ?? null) : null,
  );

  const readiness = getCompanionReadinessState({ serverInfo });

  const details = serverInfo?.capabilities?.companionDetails ?? null;
  const transportReady = nativeVoice
    ? details?.nativeVoicePreview === true
    : details?.localSpeechReady === true;
  return {
    serverId,
    details,
    isAvailable:
      enabled &&
      serverId !== null &&
      readiness?.enabled === true &&
      transportReady &&
      details?.conversationControls === true,
    unavailableReason: resolveCompanionUnavailableMessage({ serverInfo }),
  };
}

function resolveServerId(
  activeServerId: string | null,
  connected: readonly string[],
): string | null {
  if (activeServerId && connected.includes(activeServerId)) return activeServerId;
  return connected.length === 1 ? connected[0] : (activeServerId ?? null);
}
