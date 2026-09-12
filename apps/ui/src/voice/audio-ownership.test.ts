import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioEngine, AudioPlaybackSource } from "./audio-engine-types";
import { withAudioOwnership } from "./audio-ownership";

const engines: AudioEngine[] = [];
const source: AudioPlaybackSource = {
  arrayBuffer: async () => new ArrayBuffer(2),
  size: 2,
  type: "audio/pcm",
};

afterEach(async () => {
  await Promise.allSettled(engines.splice(0).map((engine) => engine.destroy()));
});

function createEngine() {
  const raw = {
    initialize: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    startCapture: vi.fn(async () => {}),
    stopCapture: vi.fn(async () => {}),
    toggleMute: vi.fn(() => false),
    isMuted: vi.fn(() => false),
    play: vi.fn(async () => 1),
    stop: vi.fn(),
    clearQueue: vi.fn(),
    isPlaying: vi.fn(() => false),
  };
  const engine = withAudioOwnership(raw);
  engines.push(engine);
  return { raw, engine };
}

describe("device audio ownership", () => {
  it("prevents another voice mode from capturing or playing over an active conversation", async () => {
    const first = createEngine();
    const second = createEngine();
    await first.engine.startCapture();
    await expect(second.engine.startCapture()).rejects.toThrow("Another voice session");
    await expect(second.engine.play(source)).rejects.toThrow("Another voice session");
    expect(second.raw.startCapture).not.toHaveBeenCalled();
    expect(second.raw.play).not.toHaveBeenCalled();
    await first.engine.stopCapture();
    await second.engine.startCapture();
    expect(second.raw.startCapture).toHaveBeenCalledTimes(1);
  });

  it("keeps ownership through playback after capture stops", async () => {
    const first = createEngine();
    const second = createEngine();
    const playback = Promise.withResolvers<number>();
    first.raw.play.mockReturnValue(playback.promise);
    await first.engine.startCapture();
    const playing = first.engine.play(source);
    await first.engine.stopCapture();
    await expect(second.engine.startCapture()).rejects.toThrow("Another voice session");
    playback.resolve(1);
    await playing;
    await second.engine.startCapture();
    expect(second.raw.startCapture).toHaveBeenCalledTimes(1);
  });

  it("releases ownership after capture fails", async () => {
    const first = createEngine();
    const second = createEngine();
    first.raw.startCapture.mockRejectedValue(new Error("Microphone denied"));
    await expect(first.engine.startCapture()).rejects.toThrow("Microphone denied");
    await second.engine.startCapture();
    expect(second.raw.startCapture).toHaveBeenCalledTimes(1);
  });

  it("does not let a stopped capture's late failure release a new owner's lease", async () => {
    const first = createEngine();
    const second = createEngine();
    const third = createEngine();
    const pending = Promise.withResolvers<void>();
    first.raw.startCapture.mockReturnValue(pending.promise);
    const starting = first.engine.startCapture();
    await first.engine.stopCapture();
    await second.engine.startCapture();
    pending.reject(new Error("Old capture failed"));
    await expect(starting).rejects.toThrow("Old capture failed");
    await expect(third.engine.startCapture()).rejects.toThrow("Another voice session");
    expect(third.raw.startCapture).not.toHaveBeenCalled();
  });

  it("shares an in-flight capture request instead of opening the microphone twice", async () => {
    const { raw, engine } = createEngine();
    const pending = Promise.withResolvers<void>();
    raw.startCapture.mockReturnValue(pending.promise);
    const first = engine.startCapture();
    const second = engine.startCapture();
    expect(second).toBe(first);
    expect(raw.startCapture).toHaveBeenCalledTimes(1);
    pending.resolve();
    await first;
  });

  it("releases ownership even when engine destruction fails", async () => {
    const first = createEngine();
    const second = createEngine();
    await first.engine.startCapture();
    first.raw.destroy.mockRejectedValue(new Error("Audio device disconnected"));
    await expect(first.engine.destroy()).rejects.toThrow("Audio device disconnected");
    await second.engine.startCapture();
    expect(second.raw.startCapture).toHaveBeenCalledTimes(1);
  });
});
