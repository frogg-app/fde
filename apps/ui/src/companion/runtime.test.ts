import type { CompanionAudioOutputPayload } from "@fde/protocol/messages";
import { describe, expect, it } from "vitest";
import type { AudioEngine, AudioPlaybackSource } from "@/voice/audio-engine-types";
import {
  CompanionMessageRejected,
  createCompanionRuntime,
  type CompanionRuntimeSink,
  type CompanionSessionAdapter,
  type CompanionSessionStartResult,
} from "./runtime";

interface FakeEngine extends AudioEngine {
  played: string[];
  captureStarted: boolean;
  stopCalls: number;
}

function createFakeEngine(options: { failCapture?: boolean } = {}): FakeEngine {
  let muted = false;
  const engine: FakeEngine = {
    played: [],
    captureStarted: false,
    stopCalls: 0,
    async initialize() {},
    async destroy() {},
    async startCapture() {
      if (options.failCapture) {
        throw new Error("microphone denied");
      }
      engine.captureStarted = true;
    },
    async stopCapture() {
      engine.captureStarted = false;
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    isMuted() {
      return muted;
    },
    async play(audio: AudioPlaybackSource) {
      engine.played.push(await sourceText(audio));
      return 0;
    },
    stop() {
      engine.stopCalls += 1;
    },
    clearQueue() {},
    isPlaying() {
      return false;
    },
  };
  return engine;
}

async function sourceText(source: AudioPlaybackSource): Promise<string> {
  return Buffer.from(await source.arrayBuffer()).toString("utf8");
}

interface FakeAdapter extends CompanionSessionAdapter {
  sentAudio: string[];
  ackedChunks: string[];
  sentMessages: string[];
  stopCalls: number;
}

function createFakeAdapter(
  options: {
    start?: CompanionSessionStartResult;
    sendMessageError?: Error;
  } = {},
): FakeAdapter {
  const adapter: FakeAdapter = {
    serverId: "local",
    sentAudio: [],
    ackedChunks: [],
    sentMessages: [],
    stopCalls: 0,
    async startSession() {
      return options.start ?? { accepted: true, reasonCode: null, retryable: false };
    },
    async stopSession() {
      adapter.stopCalls += 1;
    },
    async sendAudioChunk(audio) {
      adapter.sentAudio.push(audio);
    },
    async audioPlayed(id) {
      adapter.ackedChunks.push(id);
    },
    async sendMessage(text) {
      if (options.sendMessageError) {
        throw options.sendMessageError;
      }
      adapter.sentMessages.push(text);
    },
  };
  return adapter;
}

function createRecordingSink(): { sink: CompanionRuntimeSink; events: string[] } {
  const events: string[] = [];
  const sink: CompanionRuntimeSink = {
    sessionStarted: () => events.push("sessionStarted"),
    sessionFailed: ({ reasonCode, retryable }) =>
      events.push(`sessionFailed:${reasonCode}:${retryable}`),
    sessionStopped: () => events.push("sessionStopped"),
    setMuted: (isMuted) => events.push(`muted:${isMuted}`),
    setVolume: (volume) => events.push(`volume:${volume}`),
    userSpeakingChanged: (isSpeaking) => events.push(`speaking:${isSpeaking}`),
    transcriptReceived: ({ text, isFinal }) => events.push(`transcript:${text}:${isFinal}`),
    replyReceived: ({ text, isFinal }) => events.push(`reply:${text}:${isFinal}`),
    companionAudioStarted: () => events.push("audioStarted"),
    companionAudioFinished: () => events.push("audioFinished"),
    notebookReceived: (topics) => events.push(`notebook:${topics.length}`),
    sendPending: (text) => events.push(`sendPending:${text}`),
    sendSucceeded: () => events.push("sendSucceeded"),
    sendFailed: (reasonCode) => events.push(`sendFailed:${reasonCode}`),
  };
  return { sink, events };
}

function audioChunk(input: {
  text: string;
  groupId: string;
  id: string;
  isLastChunk: boolean;
}): CompanionAudioOutputPayload {
  return {
    audio: Buffer.from(input.text, "utf8").toString("base64"),
    format: "pcm",
    id: input.id,
    groupId: input.groupId,
    isLastChunk: input.isLastChunk,
  };
}

/** Lets queued playback promises settle without leaning on wall-clock timing. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

describe("companion session lifecycle", () => {
  it("opens capture and reports the session as started", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);

    expect(engine.captureStarted).toBe(true);
    expect(runtime.isActive()).toBe(true);
    expect(events).toEqual(["sessionStarted", "muted:false"]);
  });

  it("reports the daemon's refusal instead of opening the mic", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter({
      start: { accepted: false, reasonCode: "companion_key_missing", retryable: false },
    });
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);

    expect(events).toEqual(["sessionFailed:companion_key_missing:false"]);
    expect(engine.captureStarted).toBe(false);
    expect(runtime.isActive()).toBe(false);
  });

  it("reports a retryable failure and releases the daemon session when the mic is refused", async () => {
    const engine = createFakeEngine({ failCapture: true });
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);

    expect(events).toEqual(["sessionFailed:companion_microphone_unavailable:true"]);
    expect(adapter.stopCalls).toBe(1);
    expect(runtime.isActive()).toBe(false);
  });

  it("stops capture and the daemon session on stop", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    await runtime.stop();

    expect(engine.captureStarted).toBe(false);
    expect(adapter.stopCalls).toBe(1);
    expect(runtime.isActive()).toBe(false);
    expect(events.at(-1)).toBe("sessionStopped");
  });
});

describe("companion capture", () => {
  it("uploads captured audio while listening", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    runtime.handleCapturePcm(new Uint8Array([1, 2, 3]));
    await settle();

    expect(adapter.sentAudio).toEqual([Buffer.from([1, 2, 3]).toString("base64")]);
  });

  it("uploads nothing while muted", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    runtime.toggleMute();
    runtime.handleCapturePcm(new Uint8Array([1, 2, 3]));
    await settle();

    expect(adapter.sentAudio).toEqual([]);
    expect(events).toContain("muted:true");
  });

  it("publishes a smoothed volume rather than the raw level", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    let clock = 0;
    const runtime = createCompanionRuntime({ engine, sink, now: () => clock });

    await runtime.start(adapter);
    clock = 1000;
    runtime.handleCaptureVolume(1);

    expect(events.at(-1)).toBe("volume:0.35");
  });
});

describe("companion playback", () => {
  it("plays a group in arrival order and acknowledges every chunk", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    runtime.handleAudioOutput(
      audioChunk({ text: "hello ", groupId: "g1", id: "c1", isLastChunk: false }),
    );
    runtime.handleAudioOutput(
      audioChunk({ text: "there", groupId: "g1", id: "c2", isLastChunk: true }),
    );
    await settle();

    expect(engine.played).toEqual(["hello ", "there"]);
    expect(adapter.ackedChunks).toEqual(["c1", "c2"]);
    expect(events).toContain("audioStarted");
    expect(events.at(-1)).toBe("audioFinished");
  });

  it("drops queued audio when the user barges in", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    runtime.handleAudioOutput(
      audioChunk({ text: "first", groupId: "g1", id: "c1", isLastChunk: false }),
    );
    runtime.handleInputState(true);
    runtime.handleAudioOutput(
      audioChunk({ text: "second", groupId: "g1", id: "c2", isLastChunk: true }),
    );
    await settle();

    expect(engine.played).not.toContain("second");
    expect(engine.stopCalls).toBeGreaterThan(0);
    expect(events).toContain("speaking:true");
  });

  it("ignores audio that arrives after the session stopped", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    await runtime.stop();
    runtime.handleAudioOutput(
      audioChunk({ text: "late", groupId: "g1", id: "c1", isLastChunk: true }),
    );
    await settle();

    expect(engine.played).toEqual([]);
  });
});

describe("companion typed fallback", () => {
  it("reports pending then success", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    await runtime.sendMessage("what is running");

    expect(adapter.sentMessages).toEqual(["what is running"]);
    expect(events.slice(-2)).toEqual(["sendPending:what is running", "sendSucceeded"]);
  });

  it("surfaces the daemon's refusal reason on failure", async () => {
    const engine = createFakeEngine();
    const adapter = createFakeAdapter({
      sendMessageError: new CompanionMessageRejected("companion_busy"),
    });
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.start(adapter);
    await runtime.sendMessage("what is running");

    expect(events.at(-1)).toBe("sendFailed:companion_busy");
  });

  it("fails a message typed after the session closed", async () => {
    const engine = createFakeEngine();
    const { sink, events } = createRecordingSink();
    const runtime = createCompanionRuntime({ engine, sink });

    await runtime.sendMessage("hello");

    expect(events.at(-1)).toBe("sendFailed:companion_session_closed");
  });
});
