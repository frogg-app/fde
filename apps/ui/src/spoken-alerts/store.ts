import { create } from "zustand";
import {
  EMPTY_SPOKEN_ALERTS_STATE,
  alertKey,
  reduceSpokenAlerts,
  type SpokenAlertEntry,
  type SpokenAlertEvent,
  type SpokenAlertsState,
} from "./state";

export interface VoiceReplyTarget {
  serverId: string;
  agentId: string;
}

interface SpokenAlertsStore extends SpokenAlertsState {
  dispatch: (event: SpokenAlertEvent) => void;
  /** Which alert is showing as the top-of-screen notification card; null when none is up. */
  notificationKey: string | null;
  showNotification: (key: string) => void;
  /** Takes the card away. Playback, and the agent's banner, carry on without it. */
  dismissNotification: (key?: string) => void;
  /** Which agent the voice-reply sheet is open for; null when closed. */
  voiceReply: VoiceReplyTarget | null;
  openVoiceReply: (target: VoiceReplyTarget) => void;
  closeVoiceReply: () => void;
  /** Hands-free: after a reply is sent, the next alert re-opens voice capture by itself. */
  handsFree: boolean;
  setHandsFree: (enabled: boolean) => void;
}

export const useSpokenAlertsStore = create<SpokenAlertsStore>((set) => ({
  ...EMPTY_SPOKEN_ALERTS_STATE,
  dispatch: (event) =>
    set((state) => {
      const next = reduceSpokenAlerts({ entries: state.entries }, event);
      const clearsCard = event.type === "dismissed" && state.notificationKey === event.key;
      if (next.entries === state.entries && !clearsCard) return state;
      return {
        entries: next.entries,
        ...(clearsCard ? { notificationKey: null } : {}),
      };
    }),
  notificationKey: null,
  showNotification: (key) => set({ notificationKey: key }),
  dismissNotification: (key) =>
    set((state) =>
      key === undefined || state.notificationKey === key ? { notificationKey: null } : state,
    ),
  voiceReply: null,
  openVoiceReply: (target) => set({ voiceReply: target }),
  closeVoiceReply: () => set({ voiceReply: null }),
  handsFree: false,
  setHandsFree: (enabled) => set({ handsFree: enabled }),
}));

export function selectSpokenAlertEntry(
  state: SpokenAlertsState,
  serverId: string,
  agentId: string,
): SpokenAlertEntry | null {
  return state.entries[alertKey(serverId, agentId)] ?? null;
}

/** The alert the audio output is busy with, if any; drives the floating stop control. */
export function selectBusySpokenAlertEntry(state: SpokenAlertsState): SpokenAlertEntry | null {
  for (const entry of Object.values(state.entries)) {
    if (entry.playback.status === "playing" || entry.playback.status === "loading") {
      return entry;
    }
  }
  return null;
}
