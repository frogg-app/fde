import type { NotificationAudio } from "@fde/protocol/messages";

export interface AlertAudioPlayback {
  /** Resolves once the alert has finished playing, or as soon as `stop()` cuts it short. */
  play(audio: NotificationAudio): Promise<void>;
  stop(): void;
}
