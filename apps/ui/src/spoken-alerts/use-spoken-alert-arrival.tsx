import { useCallback, useRef } from "react";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import type { AgentAttentionNotificationPayload } from "@fde/protocol/agent-attention-notification";
import { useSettings } from "@/hooks/use-settings";
import { useSessionStore } from "@/stores/session-store";
import { readWorkspaceVoiceAlertsEnabled } from "@/stores/workspace-voice-alerts-store";
import type { ToastApi } from "@/components/toast-host";
import { SpokenAlertToastContent } from "@/components/spoken-alert-toast";
import { receiveSpokenAlert } from "./receive";
import { shouldAutoPlaySpokenAlert, type SpokenAlertReason } from "./state";
import { useSpokenAlertsStore } from "./store";
import { useSpokenAlertPlayer, type SpokenAlertPlayer } from "./use-spoken-alert-player";

// Long enough to read the gist and reach the Play button; the banner keeps the alert after.
const SPOKEN_ALERT_TOAST_MS = 6000;

export interface SpokenAlertArrival {
  agentId: string;
  reason: SpokenAlertReason;
  timestamp: string;
  notification?: AgentAttentionNotificationPayload;
  appActivelyVisible: boolean;
  /** The user is not looking at this agent right now (other agent, or app in background). */
  awayFromAgent: boolean;
}

/**
 * Spoken alerts are opt-in per workspace, so an alert for a workspace that never turned them
 * on is dropped before it can be recorded, spoken, or toasted.
 */
function isSpokenAlertWantedForAgent(serverId: string, agentId: string): boolean {
  const session = useSessionStore.getState().sessions[serverId];
  const agent = session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
  return readWorkspaceVoiceAlertsEnabled(serverId, agent?.workspaceId);
}

function autoPlayThenMaybeReply(
  player: SpokenAlertPlayer,
  key: string,
  serverId: string,
  agentId: string,
): void {
  const entry = useSpokenAlertsStore.getState().entries[key];
  if (!entry) return;
  player
    .play(entry.alert, { autoPlay: true })
    .then(() => {
      const store = useSpokenAlertsStore.getState();
      const played = store.entries[key]?.playback.status === "played";
      if (played && store.handsFree) {
        store.openVoiceReply({ serverId, agentId });
      }
      return undefined;
    })
    .catch(() => undefined);
}

/**
 * What happens the moment an attention notification with spoken text reaches this session:
 * it is recorded for the agent's banner, auto-played when the setting and foreground allow,
 * and otherwise offered as a toast with a Play button while the user is elsewhere in the app.
 */
export function useSpokenAlertArrival(params: {
  serverId: string;
  client: DaemonClient | null;
  toast: ToastApi;
}): (arrival: SpokenAlertArrival) => void {
  const { serverId, client, toast } = params;
  const player = useSpokenAlertPlayer(client);
  const autoPlayEnabled = useSettings((settings) => settings.spokenAlertsAutoPlay);
  const autoPlayEnabledRef = useRef(autoPlayEnabled);
  autoPlayEnabledRef.current = autoPlayEnabled;

  return useCallback(
    (arrival: SpokenAlertArrival) => {
      if (!isSpokenAlertWantedForAgent(serverId, arrival.agentId)) return;
      const received = receiveSpokenAlert({
        serverId,
        agentId: arrival.agentId,
        reason: arrival.reason,
        timestamp: arrival.timestamp,
        notification: arrival.notification,
      });
      if (!received) return;
      const entry = useSpokenAlertsStore.getState().entries[received.key];
      if (
        entry &&
        shouldAutoPlaySpokenAlert({
          entry,
          autoPlayEnabled: autoPlayEnabledRef.current,
          appActivelyVisible: arrival.appActivelyVisible,
        })
      ) {
        autoPlayThenMaybeReply(player, received.key, serverId, arrival.agentId);
        return;
      }
      if (arrival.appActivelyVisible && arrival.awayFromAgent && arrival.reason !== "error") {
        toast.show(<SpokenAlertToastContent alert={received.alert} player={player} />, {
          durationMs: SPOKEN_ALERT_TOAST_MS,
          testID: "spoken-alert-toast",
        });
      }
    },
    [player, serverId, toast],
  );
}
