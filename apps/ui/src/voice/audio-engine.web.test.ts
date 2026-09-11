import { describe, expect, it } from "vitest";
import { createAudioEngine } from "./audio-engine.web";
import type { AudioEngineCallbacks, AudioPlaybackSource } from "./audio-engine-types";
import type {
  WebAudioContext,
  WebAudioResources,
  WebCapture,
  WebDecodedAudio,
  WebPlayback,
} from "./audio-engine.web-resources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class Capture implements WebCapture {
  disconnections = 0;
  disconnect() {
    this.disconnections++;
  }
}

class Playback implements WebPlayback {
  disconnections = 0;
  stops = 0;
  constructor(readonly ended: () => void) {}
  disconnect() {
    this.disconnections++;
  }
  stop() {
    this.stops++;
  }
}

class Decoded implements WebDecodedAudio {
  duration = 2;
  sources: Playback[] = [];
  started = deferred<Playback>();
  start(ended: () => void) {
    const source = new Playback(ended);
    this.sources.push(source);
    this.started.resolve(source);
    return source;
  }
}

class Context implements WebAudioContext {
  closes = 0;
  resumes = 0;
  resumeResult: Promise<void> = Promise.resolve();
  captureResult = deferred<WebCapture>();
  captureRequested = deferred<void>();
  decodeRequested = deferred<void>();
  decodeCalls = 0;
  decoded = new Decoded();
  decodeResult: Promise<WebDecodedAudio> = Promise.resolve(this.decoded);
  async resume() {
    this.resumes++;
    await this.resumeResult;
  }
  async close() {
    this.closes++;
  }
  capture() {
    this.captureRequested.resolve();
    return this.captureResult.promise;
  }
  decode() {
    this.decodeCalls++;
    this.decodeRequested.resolve();
    return this.decodeResult;
  }
}

class Resources implements WebAudioResources {
  contexts: Context[] = [];
  nextContext = new Context();
  createContext() {
    const context = this.nextContext;
    this.contexts.push(context);
    this.nextContext = new Context();
    return context;
  }
}

const audio: AudioPlaybackSource = {
  size: 2,
  type: "audio/wav",
  async arrayBuffer() {
    return new ArrayBuffer(2);
  },
};

function setup() {
  const errors: Error[] = [];
  const callbacks: AudioEngineCallbacks = {
    onCaptureData() {},
    onVolumeLevel() {},
    onError(error) {
      errors.push(error);
    },
  };
  const resources = new Resources();
  const context = resources.nextContext;
  const engine = createAudioEngine(callbacks, { resources });
  return { engine, resources, context, errors };
}

describe("web audio engine lifecycle", () => {
  it("retries capture after resume fails and closes the failed context", async () => {
    const { engine, context, resources, errors } = setup();
    context.resumeResult = Promise.reject(new Error("Audio unavailable"));
    await expect(engine.startCapture()).rejects.toThrow("Audio unavailable");
    expect(context.closes).toBe(1);
    expect(errors).toHaveLength(1);
    const nextContext = resources.nextContext;
    const retry = engine.startCapture();
    await nextContext.captureRequested.promise;
    const capture = new Capture();
    nextContext.captureResult.resolve(capture);
    await retry;
    await engine.stopCapture();
    expect(capture.disconnections).toBe(1);
  });

  it("does not decode an audio read completed after stop", async () => {
    const { engine, context } = setup();
    const read = deferred<ArrayBuffer>();
    const reading = deferred<void>();
    const playing = engine.play({
      size: 2,
      type: "audio/wav",
      arrayBuffer() {
        reading.resolve();
        return read.promise;
      },
    });
    const rejection = expect(playing).rejects.toThrow("Playback stopped");
    await reading.promise;
    engine.stop();
    await rejection;
    read.resolve(new ArrayBuffer(2));
    await Promise.resolve();
    await Promise.resolve();
    expect(context.decodeCalls).toBe(0);
  });

  it.each(["stop", "destroy"] as const)("releases capture granted after %s", async (operation) => {
    const { engine, context } = setup();
    const starting = engine.startCapture();
    await context.captureRequested.promise;
    if (operation === "stop") await engine.stopCapture();
    else await engine.destroy();
    const capture = new Capture();
    context.captureResult.resolve(capture);
    await starting;
    expect(capture.disconnections).toBe(1);
    expect(context.closes).toBe(1);
  });

  it("coalesces capture starts and ignores an old permission failure after restart", async () => {
    const { engine, context, resources, errors } = setup();
    const first = engine.startCapture();
    expect(engine.startCapture()).toBe(first);
    await context.captureRequested.promise;
    await engine.stopCapture();
    const replacementContext = resources.nextContext;
    const replacement = engine.startCapture();
    await replacementContext.captureRequested.promise;
    const replacementCapture = new Capture();
    replacementContext.captureResult.resolve(replacementCapture);
    await replacement;
    context.captureResult.reject(new Error("Old permission request denied"));
    await first;
    expect(replacementCapture.disconnections).toBe(0);
    expect(replacementContext.closes).toBe(0);
    expect(errors).toEqual([]);
    await engine.destroy();
    expect(replacementCapture.disconnections).toBe(1);
  });

  it("closes a context still resuming and never requests capture after destruction", async () => {
    const { engine, context } = setup();
    const resumed = deferred<void>();
    context.resumeResult = resumed.promise;
    const starting = engine.startCapture();
    await engine.destroy();
    resumed.resolve();
    await starting;
    expect(context.closes).toBe(1);
    expect(() => engine.startCapture()).toThrow("destroyed");
  });

  it.each(["stop", "destroy"] as const)(
    "does not play a decode completed after %s",
    async (operation) => {
      const { engine, context } = setup();
      const decoding = deferred<WebDecodedAudio>();
      context.decodeResult = decoding.promise;
      const playing = engine.play(audio);
      const rejection = expect(playing).rejects.toThrow("Playback stopped");
      await context.decodeRequested.promise;
      if (operation === "stop") engine.stop();
      else await engine.destroy();
      await rejection;
      decoding.resolve(context.decoded);
      await Promise.resolve();
      await Promise.resolve();
      expect(context.decoded.sources).toHaveLength(0);
    },
  );

  it("allows the next playback before an interrupted browser decode completes", async () => {
    const { engine, context } = setup();
    const oldDecode = deferred<WebDecodedAudio>();
    context.decodeResult = oldDecode.promise;
    const oldPlayback = engine.play(audio);
    const rejection = expect(oldPlayback).rejects.toThrow("Playback stopped");
    await context.decodeRequested.promise;
    engine.stop();
    await rejection;
    context.decodeResult = Promise.resolve(context.decoded);
    const nextPlayback = engine.play(audio);
    const source = await context.decoded.started.promise;
    const staleAudio = new Decoded();
    oldDecode.resolve(staleAudio);
    await Promise.resolve();
    expect(staleAudio.sources).toHaveLength(0);
    expect(engine.isPlaying()).toBe(true);
    source.ended();
    await expect(nextPlayback).resolves.toBe(2);
    expect(source.disconnections).toBe(1);
    expect(engine.isPlaying()).toBe(false);
  });

  it("clearQueue does not admit a second worker while a source is playing", async () => {
    const { engine, context } = setup();
    const first = engine.play(audio);
    const source = await context.decoded.started.promise;
    const removed = engine.play(audio);
    const removedRejection = expect(removed).rejects.toThrow("Playback stopped");
    engine.clearQueue();
    const secondAudio = new Decoded();
    context.decodeResult = Promise.resolve(secondAudio);
    const second = engine.play(audio);
    await removedRejection;
    expect(context.decodeCalls).toBe(1);
    expect(context.decoded.sources).toHaveLength(1);
    source.ended();
    await first;
    const secondSource = await secondAudio.started.promise;
    expect(context.decodeCalls).toBe(2);
    secondSource.ended();
    await second;
    expect(source.disconnections).toBe(1);
    expect(secondSource.disconnections).toBe(1);
  });

  it("disconnects and settles active playback on destruction, rejecting later work", async () => {
    const { engine, context } = setup();
    const playing = engine.play(audio);
    const rejection = expect(playing).rejects.toThrow("Playback stopped");
    const source = await context.decoded.started.promise;
    await engine.destroy();
    await rejection;
    expect(source.disconnections).toBe(1);
    expect(source.stops).toBe(1);
    expect(context.closes).toBe(1);
    source.ended();
    expect(engine.isPlaying()).toBe(false);
    await expect(engine.play(audio)).rejects.toThrow("destroyed");
    await expect(engine.initialize()).rejects.toThrow("destroyed");
  });
});
