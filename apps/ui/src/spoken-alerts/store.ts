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
      return next.entries === state.entries ? state : { entries: next.entries };
    }),
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
