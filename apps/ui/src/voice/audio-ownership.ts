import type { AudioEngine } from "./audio-engine-types";

let owner: symbol | null = null;

export function acquireAudio(ownerId: symbol): void {
  if (owner !== null && owner !== ownerId)
    throw new Error(
      "Another voice session is using audio. End it before starting this conversation.",
    );
  owner = ownerId;
}
export function releaseAudio(ownerId: symbol): void {
  if (owner === ownerId) owner = null;
}

/** All capture modes and spoken alerts share the same device audio lease. */
export function withAudioOwnership(engine: AudioEngine): AudioEngine {
  const id = Symbol("audio-engine");
  let capturing = false;
  let captureRequest: Promise<void> | null = null;
  let captureEpoch = 0;
  let playing = 0;
  const release = () => {
    if (!capturing && playing === 0) releaseAudio(id);
  };
  return {
    ...engine,
    startCapture() {
      if (captureRequest) return captureRequest;
      try {
        acquireAudio(id);
      } catch (error) {
        return Promise.reject(error);
      }
      capturing = true;
      const epoch = ++captureEpoch;
      let pending: Promise<void>;
      try {
        pending = engine.startCapture();
      } catch (error) {
        capturing = false;
        release();
        throw error;
      }
      captureRequest = pending;
      void pending.then(
        () => {
          if (captureRequest === pending) captureRequest = null;
          return undefined;
        },
        () => {
          if (captureEpoch === epoch) {
            captureRequest = null;
            capturing = false;
            release();
          }
        },
      );
      return pending;
    },
    async stopCapture() {
      const epoch = ++captureEpoch;
      captureRequest = null;
      try {
        await engine.stopCapture();
      } finally {
        if (captureEpoch === epoch) {
          capturing = false;
          release();
        }
      }
    },
    async play(source) {
      acquireAudio(id);
      playing += 1;
      try {
        return await engine.play(source);
      } finally {
        playing = Math.max(0, playing - 1);
        release();
      }
    },
    async destroy() {
      try {
        await engine.destroy();
      } finally {
        capturing = false;
        playing = 0;
        releaseAudio(id);
      }
    },
  };
}
