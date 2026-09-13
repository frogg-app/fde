import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioPlaybackSource } from "./audio-engine-types";
import { createAudioEngine } from "./audio-engine.native";

const native = vi.hoisted(() => ({
  initialize: vi.fn(async () => true),
  getMicrophonePermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestMicrophonePermissionsAsync: vi.fn(async () => ({ granted: true })),
  toggleRecording: vi.fn((enabled: boolean) => enabled),
  releaseAudioSession: vi.fn(),
  resumePlayback: vi.fn(),
  playPCMData: vi.fn(),
  stopPlayback: vi.fn(),
  tearDown: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@frogg/expo-two-way-audio", () => ({
  ...native,
  addExpoTwoWayAudioEventListener: () => ({ remove: native.remove }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function source(
  buffer: Promise<ArrayBuffer> = Promise.resolve(new ArrayBuffer(32000)),
): AudioPlaybackSource {
  return { type: "audio/pcm;rate=16000;bits=16", size: 32000, arrayBuffer: () => buffer };
}

function engine() {
  return createAudioEngine({ onCaptureData() {}, onVolumeLevel() {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("native audio lifetime", () => {
  it("does not play late-decoded audio after stop, and a replacement completes", async () => {
    const audio = engine();
    const oldBuffer = deferred<ArrayBuffer>();
    const old = audio.play(source(oldBuffer.promise));
    const stopped = expect(old).rejects.toThrow("Playback stopped");
    await flush();
    audio.stop();
    audio.clearQueue();
    const replacement = audio.play(source());
    await flush();
    expect(native.playPCMData).toHaveBeenCalledTimes(1);
    oldBuffer.resolve(new ArrayBuffer(32000));
    await flush();
    expect(native.playPCMData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(replacement).resolves.toBe(1);
    await stopped;
    await audio.destroy();
  });

  it("clearing queued audio does not start a second drainer over active playback", async () => {
    const audio = engine();
    const first = audio.play(source());
    await flush();
    audio.clearQueue();
    const second = audio.play(source());
    await flush();
    expect(native.playPCMData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(first).resolves.toBe(1);
    expect(native.playPCMData).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBe(1);
    await audio.destroy();
  });

  it("destroy during initialization settles playback and releases the late native initialization", async () => {
    const initialized = deferred<boolean>();
    native.initialize.mockReturnValueOnce(initialized.promise);
    const audio = engine();
    const playing = audio.play(source());
    const stopped = expect(playing).rejects.toThrow("Playback stopped");
    await flush();
    await audio.destroy();
    await stopped;
    initialized.resolve(true);
    await flush();
    expect(native.tearDown).toHaveBeenCalledTimes(1);
    expect(native.playPCMData).not.toHaveBeenCalled();
    expect(native.remove).toHaveBeenCalledTimes(3);
    await expect(audio.play(source())).rejects.toThrow("Audio engine destroyed");
  });

  it("stopping while permission is pending prevents late microphone activation", async () => {
    const permission = deferred<{ granted: boolean }>();
    native.getMicrophonePermissionsAsync.mockReturnValueOnce(permission.promise);
    const audio = engine();
    const starting = audio.startCapture();
    await audio.stopCapture();
    permission.resolve({ granted: true });
    await starting;
    expect(native.toggleRecording).not.toHaveBeenCalledWith(true);
    await audio.startCapture();
    expect(native.toggleRecording).toHaveBeenCalledTimes(1);
    await audio.destroy();
    expect(native.toggleRecording).toHaveBeenLastCalledWith(false);
  });

  it("shares pending initialization and never initializes a destroyed engine", async () => {
    const initialized = deferred<boolean>();
    native.initialize.mockReturnValueOnce(initialized.promise);
    const audio = engine();
    const first = audio.initialize();
    const second = audio.initialize();
    expect(native.initialize).toHaveBeenCalledTimes(1);
    initialized.resolve(true);
    await Promise.all([first, second]);
    await audio.destroy();
    await expect(audio.initialize()).rejects.toThrow("Audio engine destroyed");
    expect(native.initialize).toHaveBeenCalledTimes(1);
  });
});

it("uses the chosen routing mode and changes it only after capture ends", async () => {
  let mode: "call" | "media" = "media";
  const audio = createAudioEngine({
    onCaptureData() {},
    onVolumeLevel() {},
    audioMode: () => mode,
  });
  await audio.startCapture();
  expect(native.initialize).toHaveBeenLastCalledWith("media");
  mode = "call";
  await audio.initialize();
  expect(native.initialize).toHaveBeenCalledTimes(1);
  await audio.stopCapture();
  await audio.startCapture();
  expect(native.tearDown).toHaveBeenCalled();
  expect(native.initialize).toHaveBeenLastCalledWith("call");
  await audio.destroy();
});
