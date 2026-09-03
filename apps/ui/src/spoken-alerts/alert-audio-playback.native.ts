import { useMemo, useRef } from "react";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import type { NotificationAudio } from "@fde/protocol/messages";
import { UnsupportedAlertAudioError, decodeBase64 } from "./audio";
import type { AlertAudioPlayback } from "./alert-audio-playback-types";

const ALERT_AUDIO_DIRECTORY = "spoken-alerts";
const ALERT_AUDIO_FILE_STEM = "alert";

const EXTENSION_BY_MIME_SUFFIX: Record<string, string> = {
  wav: "wav",
  "x-wav": "wav",
  wave: "wav",
  mpeg: "mp3",
  mp3: "mp3",
  mp4: "m4a",
  "x-m4a": "m4a",
  aac: "aac",
  ogg: "ogg",
  opus: "opus",
  webm: "webm",
  flac: "flac",
};

function extensionFor(mimeType: string): string {
  const suffix = mimeType
    .toLowerCase()
    .split(";")[0]
    .trim()
    .replace(/^audio\//, "");
  const extension = EXTENSION_BY_MIME_SUFFIX[suffix];
  if (!extension) {
    throw new UnsupportedAlertAudioError(mimeType);
  }
  return extension;
}

/** Alert audio has to live in a file for the media player; one slot, overwritten each time. */
function writeAlertFile(audio: NotificationAudio): File {
  const directory = new Directory(Paths.cache, ALERT_AUDIO_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  const file = new File(directory, `${ALERT_AUDIO_FILE_STEM}.${extensionFor(audio.mimeType)}`);
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(decodeBase64(audio.base64));
  return file;
}

/**
 * Plays alerts on the media stream rather than through the two-way voice engine. That engine
 * takes the communication route (`MODE_IN_COMMUNICATION` / `USAGE_VOICE_COMMUNICATION`), so its
 * output follows the call volume and ignores what the user set for media; a plain media player
 * puts alerts back on the volume slider people expect.
 */
export function useAlertAudioPlayback(): AlertAudioPlayback {
  const activeRef = useRef<{ player: AudioPlayer; finish: () => void } | null>(null);

  return useMemo<AlertAudioPlayback>(() => {
    const release = (): void => {
      const active = activeRef.current;
      activeRef.current = null;
      active?.finish();
    };

    return {
      play: async (audio) => {
        release();
        const file = writeAlertFile(audio);
        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
          shouldPlayInBackground: false,
          interruptionMode: "duckOthers",
          interruptionModeAndroid: "duckOthers",
        });
        const player = createAudioPlayer({ uri: file.uri });
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            subscription.remove();
            try {
              player.pause();
              player.remove();
            } catch {
              // The player is already released; nothing left to tear down.
            }
            resolve();
          };
          const subscription = player.addListener("playbackStatusUpdate", (status) => {
            if (status.didJustFinish) {
              if (activeRef.current?.player === player) {
                activeRef.current = null;
              }
              finish();
            }
          });
          activeRef.current = { player, finish };
          player.play();
        });
      },
      stop: release,
    };
  }, []);
}
