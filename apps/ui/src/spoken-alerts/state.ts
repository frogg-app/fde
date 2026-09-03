export type SpokenAlertReason = "finished" | "error" | "permission";

export interface SpokenAlert {
  /** The daemon's notification id; also the key for fetching the audio. */
  id: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  reason: SpokenAlertReason;
  spokenText: string;
  receivedAt: number;
}

export type SpokenAlertPlayback =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "playing" }
  | { status: "played" }
  | { status: "failed"; message: string };

export interface SpokenAlertEntry {
  alert: SpokenAlert;
  playback: SpokenAlertPlayback;
  /** Set once auto-play has been attempted, so a returning alert never replays by itself. */
  autoPlayAttempted: boolean;
}

export interface SpokenAlertsState {
  /** One entry per agent, keyed by `alertKey`; a newer alert for the same agent replaces it. */
  entries: Record<string, SpokenAlertEntry>;
}

export type SpokenAlertEvent =
  | { type: "received"; alert: SpokenAlert }
  | { type: "play_requested"; key: string; autoPlay: boolean }
  | { type: "playback_started"; key: string; id: string }
  | { type: "playback_finished"; key: string; id: string }
  | { type: "playback_failed"; key: string; id: string; message: string }
  | { type: "stopped"; key: string }
  | { type: "dismissed"; key: string };

export const EMPTY_SPOKEN_ALERTS_STATE: SpokenAlertsState = { entries: {} };

export function alertKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

function replaceEntry(
  state: SpokenAlertsState,
  key: string,
  entry: SpokenAlertEntry,
): SpokenAlertsState {
  return { entries: { ...state.entries, [key]: entry } };
}

function withPlayback(
  state: SpokenAlertsState,
  key: string,
  id: string | null,
  playback: SpokenAlertPlayback,
): SpokenAlertsState {
  const entry = state.entries[key];
  if (!entry) return state;
  if (id !== null && entry.alert.id !== id) return state;
  return replaceEntry(state, key, { ...entry, playback });
}

export function reduceSpokenAlerts(
  state: SpokenAlertsState,
  event: SpokenAlertEvent,
): SpokenAlertsState {
  switch (event.type) {
    case "received": {
      const key = alertKey(event.alert.serverId, event.alert.agentId);
      const existing = state.entries[key];
      if (existing && existing.alert.id === event.alert.id) return state;
      return replaceEntry(state, key, {
        alert: event.alert,
        playback: { status: "idle" },
        autoPlayAttempted: false,
      });
    }
    case "play_requested": {
      const entry = state.entries[event.key];
      if (!entry) return state;
      if (entry.playback.status === "loading" || entry.playback.status === "playing") {
        return state;
      }
      return replaceEntry(state, event.key, {
        ...entry,
        playback: { status: "loading" },
        autoPlayAttempted: entry.autoPlayAttempted || event.autoPlay,
      });
    }
    case "playback_started": {
      const entry = state.entries[event.key];
      if (!entry || entry.playback.status !== "loading") return state;
      return withPlayback(state, event.key, event.id, { status: "playing" });
    }
    case "playback_finished":
      return withPlayback(state, event.key, event.id, { status: "played" });
    case "playback_failed":
      return withPlayback(state, event.key, event.id, {
        status: "failed",
        message: event.message,
      });
    case "stopped":
      return withPlayback(state, event.key, null, { status: "idle" });
    case "dismissed": {
      if (!state.entries[event.key]) return state;
      const entries = { ...state.entries };
      delete entries[event.key];
      return { entries };
    }
  }
}

export interface AutoPlayDecisionInput {
  entry: SpokenAlertEntry;
  autoPlayEnabled: boolean;
  appActivelyVisible: boolean;
}

/** Auto-play fires once per alert, only while the app is in the foreground with the setting on. */
export function shouldAutoPlaySpokenAlert(input: AutoPlayDecisionInput): boolean {
  if (!input.autoPlayEnabled || !input.appActivelyVisible) return false;
  if (input.entry.autoPlayAttempted) return false;
  return input.entry.playback.status === "idle";
}
