import { useCallback, useRef } from "react";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import type { AgentAttentionNotificationPayload } from "@fde/protocol/agent-attention-notification";
import { useSettings } from "@/hooks/use-settings";
import { receiveSpokenAlert } from "./receive";
import { shouldAutoPlaySpokenAlert, type SpokenAlertReason } from "./state";
import { useSpokenAlertsStore } from "./store";
import { useSpokenAlertPlayer, type SpokenAlertPlayer } from "./use-spoken-alert-player";

export interface SpokenAlertArrival {
  agentId: string;
  reason: SpokenAlertReason;
  timestamp: string;
  notification?: AgentAttentionNotificationPayload;
  appActivelyVisible: boolean;
  /** The user is not looking at this agent right now (other agent, or app in background). */
  awayFromAgent: boolean;
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
 * it is recorded for the agent's banner, auto-played only while the user is watching that
 * agent with the setting on, and otherwise raised as a notification card they can play.
 */
export function useSpokenAlertArrival(params: {
  serverId: string;
  client: DaemonClient | null;
}): (arrival: SpokenAlertArrival) => void {
  const { serverId, client } = params;
  const player = useSpokenAlertPlayer(client);
  const autoPlayEnabled = useSettings((settings) => settings.spokenAlertsAutoPlay);
  const autoPlayEnabledRef = useRef(autoPlayEnabled);
  autoPlayEnabledRef.current = autoPlayEnabled;

  return useCallback(
    (arrival: SpokenAlertArrival) => {
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
          awayFromAgent: arrival.awayFromAgent,
        })
      ) {
        autoPlayThenMaybeReply(player, received.key, serverId, arrival.agentId);
        return;
      }
      useSpokenAlertsStore.getState().showNotification(received.key);
    },
    [player, serverId],
  );
}
