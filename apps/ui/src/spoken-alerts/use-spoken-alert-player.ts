import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@fde/client/internal/daemon-client";
import { isWeb } from "@/constants/platform";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { UnsupportedAlertAudioError, toAlertPlaybackSource } from "./audio";
import { alertKey, type SpokenAlert } from "./state";
import { useSpokenAlertsStore } from "./store";

export interface SpokenAlertPlayer {
  play: (alert: SpokenAlert, options?: { autoPlay?: boolean }) => Promise<void>;
  stop: (alert: SpokenAlert) => void;
  /** False when the app has no audio engine or the host cannot hand over audio. */
  canPlay: boolean;
}

function describeError(error: unknown, t: (key: string) => string): string {
  if (error instanceof UnsupportedAlertAudioError)
    return t("spokenAlerts.errors.unsupportedFormat");
  if (error instanceof Error) return error.message;
  return t("spokenAlerts.errors.playbackFailed");
}

/**
 * Fetches an alert's audio over the session and plays it through the shared voice engine.
 * Every transition goes through the store so banners, toasts, and auto-play agree on state.
 */
export function useSpokenAlertPlayer(client: DaemonClient | null): SpokenAlertPlayer {
  const { t } = useTranslation();
  const engine = useVoiceAudioEngineOptional();
  const dispatch = useSpokenAlertsStore((state) => state.dispatch);

  const play = useCallback(
    async (alert: SpokenAlert, options?: { autoPlay?: boolean }) => {
      const key = alertKey(alert.serverId, alert.agentId);
      if (!client || !engine) {
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
        const source = toAlertPlaybackSource(audio, { canDecodeCodecs: isWeb });
        dispatch({ type: "playback_started", key, id: alert.id });
        const current = useSpokenAlertsStore.getState().entries[key];
        if (current?.alert.id !== alert.id || current.playback.status !== "playing") {
          return;
        }
        await engine.play(source);
        dispatch({ type: "playback_finished", key, id: alert.id });
      } catch (error) {
        const stoppedByUser =
          useSpokenAlertsStore.getState().entries[key]?.playback.status === "idle";
        if (stoppedByUser) return;
        dispatch({ type: "playback_failed", key, id: alert.id, message: describeError(error, t) });
      }
    },
    [client, dispatch, engine, t],
  );

  const stop = useCallback(
    (alert: SpokenAlert) => {
      dispatch({ type: "stopped", key: alertKey(alert.serverId, alert.agentId) });
      engine?.stop();
    },
    [dispatch, engine],
  );

  return useMemo(
    () => ({ play, stop, canPlay: client !== null && engine !== null }),
    [client, engine, play, stop],
  );
}
