import { useMemo } from "react";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { toAlertPlaybackSource } from "./audio";
import type { AlertAudioPlayback } from "./alert-audio-playback-types";

/**
 * On web the browser owns output routing, so alerts go through the voice engine that is
 * already wired up — it decodes whatever codec the daemon sent.
 */
export function useAlertAudioPlayback(): AlertAudioPlayback | null {
  const engine = useVoiceAudioEngineOptional();
  return useMemo(() => {
    if (!engine) return null;
    return {
      play: async (audio) => {
        await engine.play(toAlertPlaybackSource(audio, { canDecodeCodecs: true }));
      },
      stop: () => engine.stop(),
    };
  }, [engine]);
}
