import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import { useAlertAudioPlayback } from "./alert-audio-playback";
import { UnsupportedAlertAudioError } from "./audio";
import { alertKey, type SpokenAlert } from "./state";
import { useSpokenAlertsStore } from "./store";

export interface SpokenAlertPlayer {
  play: (alert: SpokenAlert, options?: { autoPlay?: boolean }) => Promise<void>;
  stop: (alert: SpokenAlert) => void;
  /** False when the platform has no audio output or the host cannot hand over audio. */
  canPlay: boolean;
}

function describeError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnsupportedAlertAudioError)
    return t("spokenAlerts.errors.unsupportedFormat");
  if (error instanceof Error) return error.message;
  return t("spokenAlerts.errors.playbackFailed");
}

/**
 * Fetches an alert's audio over the session and plays it on the platform's media output.
 * Every transition goes through the store so banners, toasts, and auto-play agree on state.
 */
export function useSpokenAlertPlayer(client: DaemonClient | null): SpokenAlertPlayer {
  const { t } = useTranslation();
  const playback = useAlertAudioPlayback();
  const dispatch = useSpokenAlertsStore((state) => state.dispatch);

  const play = useCallback(
    async (alert: SpokenAlert, options?: { autoPlay?: boolean }) => {
      const key = alertKey(alert.serverId, alert.agentId);
      if (!client || !playback) {
        dispatch({
          type: "playback_failed",
          key,
          id: alert.id,
          message: t("spokenAlerts.errors.unavailable"),
        });
        return;
      }
      const before = useSpokenAlertsStore.getState().entries[key];
      dispatch({ type: "play_requested", key, autoPlay: options?.autoPlay ?? false });
      const after = useSpokenAlertsStore.getState().entries[key];
      if (before === after || after?.playback.status !== "loading") {
        return;
      }
      try {
        const audio = await client.fetchNotificationAudio(alert.id);
        if (!audio) {
          throw new Error(t("spokenAlerts.errors.noAudio"));
        }
        dispatch({ type: "playback_started", key, id: alert.id });
        const current = useSpokenAlertsStore.getState().entries[key];
        if (current?.alert.id !== alert.id || current.playback.status !== "playing") {
          return;
        }
        await playback.play(audio);
        dispatch({ type: "playback_finished", key, id: alert.id });
      } catch (error) {
        const stoppedByUser =
          useSpokenAlertsStore.getState().entries[key]?.playback.status === "idle";
        if (stoppedByUser) return;
        dispatch({ type: "playback_failed", key, id: alert.id, message: describeError(error, t) });
      }
    },
    [client, dispatch, playback, t],
  );

  const stop = useCallback(
    (alert: SpokenAlert) => {
      dispatch({ type: "stopped", key: alertKey(alert.serverId, alert.agentId) });
      playback?.stop();
    },
    [dispatch, playback],
  );

  return useMemo(
    () => ({ play, stop, canPlay: client !== null && playback !== null }),
    [client, play, playback, stop],
  );
}
