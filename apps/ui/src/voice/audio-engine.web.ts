import { withAudioOwnership } from "./audio-ownership";
import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/voice/audio-engine-types";
import {
  browserAudioResources,
  type WebAudioResources,
  type WebAudioContext,
  type WebCapture,
  type WebPlayback,
} from "./audio-engine.web-resources";

interface QueuedAudio {
  audio: AudioPlaybackSource;
  resolve: (duration: number) => void;
  reject: (error: Error) => void;
}

function floatToInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function resampleToPcm16(input: Float32Array, inputRate: number, outputRate: number): Uint8Array {
  if (input.length === 0) {
    return new Uint8Array(0);
  }

  const ratio = inputRate / outputRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const i0 = Math.floor(sourceIndex);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = sourceIndex - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    output[i] = floatToInt16(sample);
  }

  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
}

function createUnownedAudioEngine(
  callbacks: AudioEngineCallbacks,
  options?: { traceLabel?: string; resources?: WebAudioResources },
): AudioEngine {
  const resources = options?.resources ?? browserAudioResources;
  let destroyed = false;
  let playbackContext: WebAudioContext | null = null;
  let captureContext: WebAudioContext | null = null;
  let capture: WebCapture | null = null;
  let captureStart: Promise<void> | null = null;
  let captureGeneration = 0;
  let playbackGeneration = 0;
  let muted = false;
  const queue: QueuedAudio[] = [];
  let processingQueue = false;
  let activeItem: QueuedAudio | null = null;
  let activePlayback: WebPlayback | null = null;
  let cancelPlayback: (() => void) | null = null;
  let cancelWork: (() => void) | null = null;

  function assertLive() {
    if (destroyed) throw new Error("Audio engine destroyed");
  }

  async function ensurePlaybackContext(): Promise<WebAudioContext> {
    assertLive();
    if (!playbackContext) playbackContext = resources.createContext();
    const context = playbackContext;
    await context.resume();
    return context;
  }

  function playbackCancelled(generation: number): boolean {
    return destroyed || generation !== playbackGeneration;
  }

  async function playAudio(audio: AudioPlaybackSource, generation: number): Promise<number> {
    const context = await ensurePlaybackContext();
    if (playbackCancelled(generation)) throw new Error("Playback stopped");
    const bytes = await audio.arrayBuffer();
    if (playbackCancelled(generation)) throw new Error("Playback stopped");
    const decoded = await context.decode(bytes, audio.type);
    if (playbackCancelled(generation)) throw new Error("Playback stopped");
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      function settle(error?: Error) {
        if (settled) return;
        settled = true;
        const source = activePlayback;
        activePlayback = null;
        cancelPlayback = null;
        source?.disconnect();
        if (error) reject(error);
        else resolve(decoded.duration);
      }
      cancelPlayback = () => {
        const source = activePlayback;
        // Remove the ended callback before stop, including adapters that end synchronously.
        settle(new Error("Playback stopped"));
        source?.stop();
      };
      try {
        activePlayback = decoded.start(() => settle());
      } catch (error) {
        settle(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async function processQueue(): Promise<void> {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (queue.length > 0) {
        const item = queue.shift()!;
        activeItem = item;
        const generation = playbackGeneration;
        try {
          const cancellation = new Promise<never>((_resolve, reject) => {
            cancelWork = () => reject(new Error("Playback stopped"));
          });
          const duration = await Promise.race([playAudio(item.audio, generation), cancellation]);
          item.resolve(duration);
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)));
        } finally {
          activeItem = null;
          cancelWork = null;
        }
      }
    } finally {
      processingQueue = false;
    }
  }

  async function stopCapture(): Promise<void> {
    captureGeneration++;
    captureStart = null;
    const previousCapture = capture;
    const previousContext = captureContext;
    capture = null;
    captureContext = null;
    muted = false;
    previousCapture?.disconnect();
    callbacks.onVolumeLevel(0);
    await previousContext?.close().catch(() => undefined);
  }

  async function beginCapture(generation: number): Promise<void> {
    try {
      const context = resources.createContext();
      captureContext = context;
      await context.resume();
      if (destroyed || generation !== captureGeneration) return;
      const acquired = await context.capture((input, inputRate) => {
        if (!capture || destroyed || generation !== captureGeneration) return;
        let sumSquares = 0;
        for (const sample of input) sumSquares += sample * sample;
        const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
        callbacks.onVolumeLevel(Math.min(1, Math.max(0, rms * 2)));
        if (!muted) callbacks.onCaptureData(resampleToPcm16(input, inputRate, 16000));
      });
      if (destroyed || generation !== captureGeneration) {
        acquired.disconnect();
        return;
      }
      capture = acquired;
    } catch (error) {
      if (destroyed || generation !== captureGeneration) return;
      await stopCapture();
      const wrapped = error instanceof Error ? error : new Error(String(error));
      callbacks.onError?.(wrapped);
      throw wrapped;
    }
  }

  function stop() {
    playbackGeneration++;
    // Settle the caller even when a browser decode/read cannot itself be cancelled.
    activeItem?.reject(new Error("Playback stopped"));
    cancelWork?.();
    cancelPlayback?.();
  }

  function clearQueue() {
    for (const item of queue.splice(0)) item.reject(new Error("Playback stopped"));
  }

  return {
    async initialize() {
      await ensurePlaybackContext();
    },
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      clearQueue();
      const previousContext = playbackContext;
      playbackContext = null;
      await Promise.all([stopCapture(), previousContext?.close().catch(() => undefined)]);
    },
    startCapture() {
      assertLive();
      if (capture) return Promise.resolve();
      if (captureStart) return captureStart;
      const generation = ++captureGeneration;
      const pending = beginCapture(generation).finally(() => {
        if (captureStart === pending) captureStart = null;
      });
      captureStart = pending;
      return pending;
    },
    stopCapture,
    toggleMute() {
      muted = !muted;
      if (muted) callbacks.onVolumeLevel(0);
      return muted;
    },
    isMuted() {
      return muted;
    },
    async play(audio) {
      assertLive();
      return new Promise<number>((resolve, reject) => {
        queue.push({ audio, resolve, reject });
        void processQueue();
      });
    },
    stop,
    clearQueue,
    isPlaying() {
      return activePlayback !== null;
    },
  };
}

export const createAudioEngine: typeof createUnownedAudioEngine = (...args) =>
  withAudioOwnership(createUnownedAudioEngine(...args));
