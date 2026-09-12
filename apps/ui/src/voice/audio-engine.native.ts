import { withAudioOwnership } from "./audio-ownership";
import * as native from "@fde/expo-two-way-audio";
import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/voice/audio-engine-types";

interface QueuedAudio {
  audio: AudioPlaybackSource;
  resolve: (duration: number) => void;
  reject: (error: Error) => void;
}

interface AudioEngineTraceOptions {
  traceLabel?: string;
}

function parsePcmSampleRate(mimeType: string): number | null {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return null;
  }
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate) {
    return pcm;
  }

  const inputSamples = Math.floor(pcm.length / 2);
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const out = new Uint8Array(outputSamples * 2);
  const ratio = fromRate / toRate;

  const readInt16 = (sampleIndex: number): number => {
    const i = sampleIndex * 2;
    if (i + 1 >= pcm.length) {
      return 0;
    }
    const lo = pcm[i];
    const hi = pcm[i + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value = value - 0x10000;
    }
    return value;
  };

  const writeInt16 = (sampleIndex: number, value: number): void => {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(value)));
    const i = sampleIndex * 2;
    out[i] = clamped & 0xff;
    out[i + 1] = (clamped >> 8) & 0xff;
  };

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const s0 = readInt16(i0);
    const s1 = readInt16(Math.min(inputSamples - 1, i0 + 1));
    writeInt16(i, s0 + (s1 - s0) * frac);
  }

  return out;
}

function createUnownedAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: AudioEngineTraceOptions,
): AudioEngine {
  const refs: {
    initialized: boolean;
    initialization: Promise<void> | null;
    captureGeneration: number;
    captureActive: boolean;
    muted: boolean;
    queue: QueuedAudio[];
    processingQueue: boolean;
    playbackTimeout: ReturnType<typeof setTimeout> | null;
    activePlayback: {
      resolve: (duration: number) => void;
      reject: (error: Error) => void;
      settled: boolean;
    } | null;
    destroyed: boolean;
  } = {
    initialized: false,
    initialization: null,
    captureGeneration: 0,
    captureActive: false,
    muted: false,
    queue: [],
    processingQueue: false,
    playbackTimeout: null,
    activePlayback: null,
    destroyed: false,
  };

  const microphoneSubscription = native.addExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    (event: { data: Uint8Array }) => {
      if (!refs.captureActive || refs.muted) {
        return;
      }
      const pcm = event.data;
      callbacks.onCaptureData(pcm);
    },
  );
  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      if (!refs.captureActive) {
        return;
      }
      const level = refs.muted ? 0 : event.data;
      callbacks.onVolumeLevel(level);
    },
  );
  const interruptionSubscription = native.addExpoTwoWayAudioEventListener(
    "onAudioInterruption",
    (event: { data: string }) => {
      if (event.data !== "blocked") {
        return;
      }
      const wasCaptureActive = refs.captureActive;
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (wasCaptureActive) {
        callbacks.onInterruption?.();
      }
    },
  );

  let initializedMode: "call" | "media" = "call";
  async function ensureInitialized(): Promise<void> {
    if (refs.destroyed) throw new Error("Audio engine destroyed");
    const mode = callbacks.audioMode?.() ?? "call";
    if (
      refs.initialized &&
      initializedMode !== mode &&
      !refs.captureActive &&
      !refs.processingQueue
    ) {
      native.tearDown();
      refs.initialized = false;
    }
    if (refs.initialized) return;
    if (!refs.initialization) {
      refs.initialization = (async () => {
        const success = await native.initialize(mode);
        if (!success) {
          throw new Error("expo-two-way-audio: native initialize() returned false");
        }
        if (refs.destroyed) {
          native.tearDown();
          throw new Error("Audio engine destroyed");
        }
        initializedMode = mode;
        refs.initialized = true;
      })().finally(() => {
        refs.initialization = null;
      });
    }
    await refs.initialization;
  }

  /**
   * Release the OS audio session as soon as we are neither capturing nor playing.
   * Holding it keeps the user's background music paused — on iOS the non-mixing
   * `.playAndRecord` category survives backgrounding and is re-asserted on every
   * foreground, so an unreleased session means their music never comes back.
   */
  function releaseSessionIfIdle(): void {
    if (!refs.initialized || refs.destroyed) {
      return;
    }
    if (refs.captureActive || refs.activePlayback || refs.queue.length > 0) {
      return;
    }
    // The wrapper no-ops on binaries whose native module predates this function.
    native.releaseAudioSession();
  }

  async function ensureMicrophonePermission(): Promise<void> {
    let permission = await native.getMicrophonePermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      permission = await native.requestMicrophonePermissionsAsync().catch(() => null);
    }
    if (!permission?.granted) {
      throw new Error(
        "Microphone permission is required to capture audio. Please enable microphone access in system settings.",
      );
    }
  }

  function clearPlaybackTimeout(): void {
    if (refs.playbackTimeout) {
      clearTimeout(refs.playbackTimeout);
      refs.playbackTimeout = null;
    }
  }

  function playAudio(audio: AudioPlaybackSource): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      // Own initialization and decoding too: stop must settle this call before
      // either asynchronous operation completes, without allowing it to restart.
      const active = { resolve, reject, settled: false };
      refs.activePlayback = active;
      function isCurrent(): boolean {
        return !refs.destroyed && refs.activePlayback === active && !active.settled;
      }
      async function start(): Promise<void> {
        try {
          await ensureInitialized();
          if (!isCurrent()) {
            releaseSessionIfIdle();
            return;
          }
          const arrayBuffer = await audio.arrayBuffer();
          if (!isCurrent()) return;
          const pcm = new Uint8Array(arrayBuffer);
          const inputRate = parsePcmSampleRate(audio.type || "") ?? 24000;
          const pcm16k = resamplePcm16(pcm, inputRate, 16000);
          const durationSec = pcm16k.length / 2 / 16000;

          native.resumePlayback();
          native.playPCMData(pcm16k);
          refs.playbackTimeout = setTimeout(() => {
            if (!isCurrent()) return;
            clearPlaybackTimeout();
            active.settled = true;
            refs.activePlayback = null;
            resolve(durationSec);
          }, durationSec * 1000);
        } catch (error) {
          if (!isCurrent()) return;
          clearPlaybackTimeout();
          active.settled = true;
          refs.activePlayback = null;
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
      void start();
    });
  }

  async function processQueue(): Promise<void> {
    if (refs.processingQueue || refs.queue.length === 0) {
      return;
    }

    refs.processingQueue = true;
    while (refs.queue.length > 0) {
      const item = refs.queue.shift()!;
      try {
        const duration = await playAudio(item.audio);
        item.resolve(duration);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    refs.processingQueue = false;
    releaseSessionIfIdle();
  }

  return {
    async initialize() {
      await ensureInitialized();
    },

    async destroy() {
      if (refs.destroyed) {
        return;
      }
      refs.destroyed = true;
      refs.captureGeneration += 1;
      this.stop();
      this.clearQueue();
      if (refs.captureActive) {
        native.toggleRecording(false);
        refs.captureActive = false;
      }
      clearPlaybackTimeout();
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (refs.initialized) {
        native.tearDown();
        refs.initialized = false;
      }
      microphoneSubscription.remove();
      volumeSubscription.remove();
      interruptionSubscription.remove();
    },

    async startCapture() {
      if (refs.destroyed) throw new Error("Audio engine destroyed");
      if (refs.captureActive) {
        return;
      }

      const generation = ++refs.captureGeneration;
      try {
        await ensureMicrophonePermission();
        if (refs.destroyed || generation !== refs.captureGeneration) return;
        await ensureInitialized();
        if (refs.destroyed || generation !== refs.captureGeneration) {
          releaseSessionIfIdle();
          return;
        }
        const isRecording = native.toggleRecording(true);
        if (!isRecording) {
          throw new Error(
            "Microphone capture could not start because Android audio focus is unavailable.",
          );
        }
        refs.captureActive = true;
      } catch (error) {
        if (refs.destroyed || generation !== refs.captureGeneration) return;
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      refs.captureGeneration += 1;
      if (refs.captureActive) {
        native.toggleRecording(false);
      }
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      releaseSessionIfIdle();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    async play(audio: AudioPlaybackSource) {
      if (refs.destroyed) throw new Error("Audio engine destroyed");
      return await new Promise<number>((resolve, reject) => {
        refs.queue.push({ audio, resolve, reject });
        if (!refs.processingQueue) {
          void processQueue();
        }
      });
    },

    stop() {
      native.stopPlayback();
      clearPlaybackTimeout();
      const active = refs.activePlayback;
      refs.activePlayback = null;
      if (active && !active.settled) {
        active.settled = true;
        active.reject(new Error("Playback stopped"));
      }
      releaseSessionIfIdle();
    },

    clearQueue() {
      while (refs.queue.length > 0) {
        refs.queue.shift()!.reject(new Error("Playback stopped"));
      }
      // The active drainer owns processingQueue until its current call settles.
      releaseSessionIfIdle();
    },

    isPlaying() {
      return refs.activePlayback !== null;
    },
  };
}

export const createAudioEngine: typeof createUnownedAudioEngine = (...args) =>
  withAudioOwnership(createUnownedAudioEngine(...args));
