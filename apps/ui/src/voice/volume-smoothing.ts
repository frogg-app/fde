/**
 * Raw capture levels jitter far faster than a volume ring should move. Both the
 * voice overlay and the Companion orb publish through this envelope: fast attack
 * so speech registers immediately, slow release so the ring settles rather than
 * flickering, and a publish gate so a still mic does not wake React.
 */
const DISPLAY_VOLUME_PUBLISH_INTERVAL_MS = 120;

const DISPLAY_VOLUME_CHANGE_EPSILON = 0.02;
const DISPLAY_VOLUME_ATTACK = 0.35;
const DISPLAY_VOLUME_RELEASE = 0.18;

export interface DisplayVolumeStep {
  volume: number;
  shouldPublish: boolean;
}

export function stepDisplayVolume(input: {
  level: number;
  previousVolume: number;
  msSinceLastPublish: number;
}): DisplayVolumeStep {
  const smoothing =
    input.level >= input.previousVolume ? DISPLAY_VOLUME_ATTACK : DISPLAY_VOLUME_RELEASE;
  const raw = input.previousVolume + (input.level - input.previousVolume) * smoothing;
  const volume = Number(Math.max(0, Math.min(1, raw)).toFixed(3));
  const enoughTimeElapsed = input.msSinceLastPublish >= DISPLAY_VOLUME_PUBLISH_INTERVAL_MS;
  const enoughChange = Math.abs(volume - input.previousVolume) >= DISPLAY_VOLUME_CHANGE_EPSILON;

  return { volume, shouldPublish: enoughTimeElapsed || enoughChange };
}
