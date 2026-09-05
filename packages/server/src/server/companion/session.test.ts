import type Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionOutboundMessage } from "../messages.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
  TextToSpeechProvider,
} from "../speech/speech-provider.js";
import type {
  TurnDetectionProvider,
  TurnDetectionSession,
} from "../speech/turn-detection-provider.js";
import { COMPANION_KEY_MISSING_REASON_CODE } from "./anthropic-config.js";
import {
  COMPANION_STALL_DELAY_MS,
  type CompanionFillerBank,
  type CompanionScheduler,
} from "./fillers.js";
import {
  COMPANION_MODEL,
  type CompanionModelClient,
  type CompanionModelStream,
} from "./orchestrator.js";
import {
  COMPANION_SPEECH_UNAVAILABLE_REASON_CODE,
  CompanionSession,
  type CompanionRuntime,
} from "./session.js";
import { CompanionNotebookStore, companionNotebookPath } from "./store.js";

const logger = pino({ level: "silent" });

class FakeTurnDetectionSession extends EventEmitter implements TurnDetectionSession {
  readonly requiredSampleRate = 16000;
  async connect(): Promise<void> {}
  appendPcm16(): void {}
  flush(): void {}
  reset(): void {}
  close(): void {}
}

class FakeSttSession extends EventEmitter implements StreamingTranscriptionSession {
  readonly requiredSampleRate = 16000;
  async connect(): Promise<void> {}
  appendPcm16(): void {}
  commit(): void {}
  clear(): void {}
  close(): void {}
}

function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_end",
    type: "message",
    role: "assistant",
    model: COMPANION_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
  };
}

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

interface ScriptedTurn {
  deltas: readonly string[];
  /** Held open so tests can prove speech does not wait on the finished message. */
  gate?: Promise<void>;
}

function createScriptedClient(turns: ScriptedTurn[]): CompanionModelClient {
  let index = 0;
  return {
    stream: () => {
      const turn = turns[index] ?? { deltas: [] };
      index += 1;
      const stream: CompanionModelStream = {
        async *[Symbol.asyncIterator]() {
          for (const text of turn.deltas) {
            yield {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text },
            } satisfies Anthropic.MessageStreamEvent;
          }
        },
        finalMessage: async () => {
          await turn.gate;
          return textMessage(turn.deltas.join(""));
        },
      };
      return stream;
    },
  };
}

interface RecordingTts extends TextToSpeechProvider {
  synthesized: string[];
  nextSynthesis: () => Promise<string>;
}

function createRecordingTts(): RecordingTts {
  const synthesized: string[] = [];
  const waiting: Array<(text: string) => void> = [];
  return {
    synthesized,
    nextSynthesis() {
      return new Promise<string>((resolve) => waiting.push(resolve));
    },
    async synthesizeSpeech(text) {
      synthesized.push(text);
      waiting.shift()?.(text);
      return { stream: Readable.from([Buffer.from("audio")]), format: "pcm;rate=24000" };
    },
  };
}

function createManualScheduler(): CompanionScheduler & { advance(ms: number): void } {
  interface Scheduled {
    dueAt: number;
    run: () => void;
  }
  let now = 0;
  let scheduled: Scheduled[] = [];
  return {
    schedule(delayMs, run) {
      const entry: Scheduled = { dueAt: now + delayMs, run };
      scheduled.push(entry);
      return () => {
        scheduled = scheduled.filter((candidate) => candidate !== entry);
      };
    },
    advance(ms) {
      now += ms;
      const due = scheduled.filter((entry) => entry.dueAt <= now);
      scheduled = scheduled.filter((entry) => entry.dueAt > now);
      for (const entry of due) {
        entry.run();
      }
    },
  };
}

function createFillerBank(): CompanionFillerBank & { taken: string[] } {
  const taken: string[] = [];
  return {
    taken,
    async prewarm() {},
    async take() {
      taken.push("one sec");
      return { text: "one sec", audio: "ZmlsbGVy", format: "audio/wav" };
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
}

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "fde-companion-session-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

interface HarnessOptions {
  turns?: ScriptedTurn[];
  apiKeyMissing?: boolean;
  speechAvailable?: boolean;
  /** Off when a test needs playback to stay open while it interrupts. */
  autoAck?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const emitted: SessionOutboundMessage[] = [];
  const tts = createRecordingTts();
  const fillers = createFillerBank();
  const scheduler = createManualScheduler();
  const detector = new FakeTurnDetectionSession();
  const sttSessions: FakeSttSession[] = [];

  const turnDetection: TurnDetectionProvider = { id: "local", createSession: () => detector };
  const stt: SpeechToTextProvider = {
    id: "local",
    createSession: () => {
      const session = new FakeSttSession();
      sttSessions.push(session);
      return session;
    },
  };

  const runtime: CompanionRuntime = {
    capability: { enabled: true, reason: "" },
    modelConfig: options.apiKeyMissing
      ? {
          status: "unavailable",
          reasonCode: COMPANION_KEY_MISSING_REASON_CODE,
          message: "no key",
        }
      : { status: "available", apiKey: "sk-test", baseUrl: null, model: COMPANION_MODEL },
    notebook: new CompanionNotebookStore({ filePath: companionNotebookPath(home) }),
    fillers,
    createTools: () => [],
    runDeferredJob: async () => "done",
    createModelClient: () => createScriptedClient(options.turns ?? []),
  };

  const session = new CompanionSession({
    host: {
      emit: (msg) => {
        emitted.push(msg);
        if (msg.type === "companion.audio.output" && options.autoAck !== false) {
          queueMicrotask(() => session.handleAudioPlayed(msg.payload.id));
        }
      },
    },
    logger,
    sessionId: "session-1",
    runtime,
    tts,
    stt: options.speechAvailable === false ? null : stt,
    turnDetection: options.speechAvailable === false ? null : turnDetection,
    sttLanguage: "en",
    scheduler,
  });

  return {
    session,
    emitted,
    tts,
    fillers,
    scheduler,
    detector,
    sttSessions,
    start: () =>
      session.handleSessionStart({ type: "companion.session.start.request", requestId: "r1" }),
    typed: (text: string) =>
      session.handleMessageSend({
        type: "companion.message.send.request",
        requestId: "r2",
        text,
      }),
    of<T extends SessionOutboundMessage["type"]>(type: T) {
      return emitted.filter(
        (msg): msg is Extract<SessionOutboundMessage, { type: T }> => msg.type === type,
      );
    },
  };
}

describe("CompanionSession start", () => {
  it("refuses with the key reason code and never opens a microphone without an API key", async () => {
    const harness = createHarness({ apiKeyMissing: true });

    await harness.start();

    expect(harness.of("companion.session.start.response")[0].payload).toEqual({
      requestId: "r1",
      accepted: false,
      reasonCode: COMPANION_KEY_MISSING_REASON_CODE,
      retryable: false,
    });
    expect(harness.sttSessions).toHaveLength(0);
  });

  it("refuses as retryable while the speech runtime is unavailable", async () => {
    const harness = createHarness({ speechAvailable: false });

    await harness.start();

    expect(harness.of("companion.session.start.response")[0].payload).toEqual({
      requestId: "r1",
      accepted: false,
      reasonCode: COMPANION_SPEECH_UNAVAILABLE_REASON_CODE,
      retryable: true,
    });
  });

  it("accepts and starts listening when the model and the speech runtime are ready", async () => {
    const harness = createHarness();

    await harness.start();

    expect(harness.of("companion.session.start.response")[0].payload.accepted).toBe(true);
    expect(harness.sttSessions).toHaveLength(1);
    await harness.session.cleanup();
  });
});

describe("CompanionSession turns", () => {
  it("hands a segment to TTS before the turn completes", async () => {
    const gate = createGate();
    const harness = createHarness({
      turns: [
        {
          deltas: ["I had a look at the flaky push test just now.", " It only fails on Windows."],
          gate: gate.promise,
        },
      ],
    });
    await harness.start();

    const firstSynthesis = harness.tts.nextSynthesis();
    const turn = harness.typed("what happened to the push test");
    const spoken = await firstSynthesis;

    expect(spoken).toBe("I had a look at the flaky push test just now.");
    expect(harness.of("companion.reply").some((msg) => msg.payload.isFinal)).toBe(false);

    gate.open();
    await turn;

    expect(harness.of("companion.reply").at(-1)!.payload).toEqual({
      text: "I had a look at the flaky push test just now. It only fails on Windows.",
      isFinal: true,
    });
    expect(harness.tts.synthesized).toEqual([
      "I had a look at the flaky push test just now.",
      "It only fails on Windows.",
    ]);
    await harness.session.cleanup();
  });

  it("speaks a filler when the model has said nothing after the stall delay", async () => {
    const gate = createGate();
    const harness = createHarness({ turns: [{ deltas: [], gate: gate.promise }] });
    await harness.start();

    const turn = harness.typed("what is everyone up to");
    await settle();
    harness.scheduler.advance(COMPANION_STALL_DELAY_MS);
    await settle();

    expect(harness.fillers.taken).toEqual(["one sec"]);
    expect(harness.of("companion.audio.output")[0].payload.audio).toBe("ZmlsbGVy");

    gate.open();
    await turn;
    await harness.session.cleanup();
  });

  it("cancels the stall guard as soon as the first real segment is queued", async () => {
    const harness = createHarness({
      turns: [{ deltas: ["Three agents are running in the checkout workspace right now."] }],
    });
    await harness.start();

    await harness.typed("what is everyone up to");
    harness.scheduler.advance(COMPANION_STALL_DELAY_MS * 10);
    await settle();

    expect(harness.fillers.taken).toEqual([]);
    await harness.session.cleanup();
  });

  it("abandons the turn in flight when the user talks over it", async () => {
    const gate = createGate();
    const harness = createHarness({
      turns: [
        {
          deltas: [
            "I had a look at the flaky push test just now.",
            " It only fails on Windows, and the fix is not obvious yet.",
          ],
          gate: gate.promise,
        },
      ],
      autoAck: false,
    });
    await harness.start();

    const firstSynthesis = harness.tts.nextSynthesis();
    const turn = harness.typed("what happened to the push test");
    await firstSynthesis;

    harness.detector.emit("speech_started");
    await settle();
    harness.sttSessions[0].emit("transcript", {
      segmentId: "s1",
      transcript: "actually never mind",
      isFinal: false,
    });
    await settle();

    gate.open();
    await turn;

    expect(harness.tts.synthesized).toEqual(["I had a look at the flaky push test just now."]);
    expect(harness.of("companion.reply").some((msg) => msg.payload.isFinal)).toBe(false);
    expect(harness.of("companion.input.state").at(-1)!.payload.isSpeaking).toBe(true);
    await harness.session.cleanup();
  });
});
