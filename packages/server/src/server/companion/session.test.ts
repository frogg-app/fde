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
import { createCompanionApiBackend } from "./backends/api.js";
import { COMPANION_BACKEND_MISSING_REASON_CODE } from "./model-config.js";
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
import type { CompanionTool } from "./tools/index.js";

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
  tool?: Anthropic.ToolUseBlock;
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
          const message = textMessage(turn.deltas.join(""));
          if (turn.tool) {
            message.content.push(turn.tool);
            message.stop_reason = "tool_use";
          }
          return message;
        },
      };
      return stream;
    },
  };
}

interface RecordingTts extends TextToSpeechProvider {
  synthesized: string[];
  speeds: (number | undefined)[];
  nextSynthesis: () => Promise<string>;
}

function createRecordingTts(): RecordingTts {
  const synthesized: string[] = [];
  const speeds: (number | undefined)[] = [];
  const waiting: Array<(text: string) => void> = [];
  return {
    synthesized,
    speeds,
    nextSynthesis() {
      return new Promise<string>((resolve) => waiting.push(resolve));
    },
    async synthesizeSpeech(text, options) {
      speeds.push(options?.speed);
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
  interruptible?: boolean;
  acknowledgeTasks?: boolean;
  tools?: CompanionTool[];
  turns?: ScriptedTurn[];
  backendMissing?: boolean;
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
    modelConfig: options.backendMissing
      ? {
          status: "unavailable",
          reasonCode: COMPANION_BACKEND_MISSING_REASON_CODE,
          message: "no backend",
        }
      : {
          status: "available",
          backend: "api",
          apiKey: "sk-test",
          baseUrl: null,
          model: COMPANION_MODEL,
        },
    notebook: new CompanionNotebookStore({ filePath: companionNotebookPath(home) }),
    fillers,
    createTools: () => options.tools ?? [],
    runDeferredJob: async () => "done",
    createBackend: ({ tools }) =>
      createCompanionApiBackend({
        client: createScriptedClient(options.turns ?? []),
        tools,
        model: COMPANION_MODEL,
      }),
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
    runtime,
    session,
    emitted,
    tts,
    fillers,
    scheduler,
    detector,
    sttSessions,
    start: () =>
      session.handleSessionStart({
        type: "companion.session.start.request",
        requestId: "r1",
        conversation: {
          acknowledgeTasks: options.acknowledgeTasks ?? true,
          verbosity: "brief",
          updates: "important",
          pauseMs: 1400,
          interruptible: options.interruptible ?? true,
        },
      }),
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
    const harness = createHarness({ backendMissing: true });

    await harness.start();

    expect(harness.of("companion.session.start.response")[0].payload).toEqual({
      requestId: "r1",
      accepted: false,
      reasonCode: COMPANION_BACKEND_MISSING_REASON_CODE,
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
  it("keeps quiet until the final reply with acknowledgements disabled", async () => {
    const gate = createGate();
    const harness = createHarness({
      acknowledgeTasks: false,
      turns: [{ deltas: ["The build passed."], gate: gate.promise }],
    });
    await harness.start();
    const pending = harness.typed("How did the build go?");
    await settle();
    harness.scheduler.advance(COMPANION_STALL_DELAY_MS.api);
    await settle();
    expect(harness.tts.synthesized).toEqual([]);
    expect(harness.fillers.taken).toEqual([]);
    gate.open();
    await pending;
    expect(harness.tts.synthesized).toEqual(["The build passed."]);
    expect(harness.tts.speeds).toEqual([1.3]);
    await harness.session.cleanup();
  });

  it.each([true, false])(
    "quiet dispatch speaks a failure, but no successful task acknowledgement (success=%s)",
    async (success) => {
      const tool: CompanionTool = {
        name: "create_agent",
        description: "Start task",
        deferred: false,
        inputShape: {},
        inputSchema: { type: "object" },
        invoke: async () =>
          success
            ? { ok: true, content: '{"jobId":"job-1"}' }
            : { ok: false, error: "Workspace is unavailable" },
      };
      const final = success
        ? "The task is running."
        : "The workspace is unavailable. Select another project.";
      const harness = createHarness({
        acknowledgeTasks: false,
        tools: [tool],
        turns: [
          {
            deltas: ["I will start by creating a worker."],
            tool: { type: "tool_use", id: "tool-1", name: "create_agent", input: {} },
          },
          { deltas: [final] },
        ],
      });
      await harness.start();
      await harness.typed("Fix the build");
      expect(harness.tts.synthesized.join(" ")).toBe(success ? "" : final);
      await harness.session.cleanup();
    },
  );

  it("continues the current reply when spoken interruption is disabled", async () => {
    const harness = createHarness({
      interruptible: false,
      autoAck: false,
      turns: [
        {
          deltas: [
            "The first check completed successfully.",
            " The second check also completed successfully.",
          ],
        },
      ],
    });
    await harness.start();
    const turn = harness.typed("Tell me the result");
    await expect.poll(() => harness.of("companion.audio.output").length).toBe(1);
    harness.detector.emit("speech_started");
    await settle();
    expect(harness.of("companion.input.state").at(-1)?.payload.isSpeaking).toBe(false);
    harness.session.handleAudioPlayed(harness.of("companion.audio.output")[0].payload.id);
    await expect.poll(() => harness.of("companion.audio.output").length).toBe(2);
    harness.session.handleAudioPlayed(harness.of("companion.audio.output")[1].payload.id);
    await turn;
    await harness.session.cleanup();
  });

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

    expect(harness.of("companion.reply").at(-1)!.payload).toMatchObject({
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
    harness.scheduler.advance(COMPANION_STALL_DELAY_MS.api);
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
    harness.scheduler.advance(COMPANION_STALL_DELAY_MS.api * 10);
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

  // Barge-in used to hang off the first STT partial, so the Companion talked
  // over the user until the recogniser produced one -- and forever when it
  // produced nothing usable. VAD onset alone must be enough.
  it("stops speaking on VAD onset, without waiting for a partial transcript", async () => {
    const gate = createGate();
    const harness = createHarness({
      turns: [
        {
          deltas: [
            "The push test only fails on Windows, as far as I can tell.",
            " I have not found the cause yet.",
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

    // No transcript event at all -- only the detector fires.
    harness.detector.emit("speech_started");
    await settle();

    expect(harness.of("companion.input.state").at(-1)!.payload.isSpeaking).toBe(true);

    gate.open();
    await turn;

    // Cut at the opening clause: the first segment is deliberately short so
    // audio starts sooner. See docs/companion-voice-design.md.
    expect(harness.tts.synthesized).toEqual(["The push test only fails on Windows,"]);
    expect(harness.of("companion.reply").some((msg) => msg.payload.isFinal)).toBe(false);
    await harness.session.cleanup();
  });

  // Audio that finishes synthesising mid-utterance must be dropped, not played
  // late on top of the user.
  it("emits no further audio once the user starts speaking", async () => {
    const gate = createGate();
    const harness = createHarness({
      turns: [
        {
          deltas: [
            "That test has been flaky on Windows for a while now.",
            " I have not found the cause yet.",
          ],
          gate: gate.promise,
        },
      ],
      autoAck: false,
    });
    await harness.start();

    const firstSynthesis = harness.tts.nextSynthesis();
    const turn = harness.typed("why is the push test flaky");
    await firstSynthesis;

    harness.detector.emit("speech_started");
    await settle();
    const afterBargeIn = harness.of("companion.audio.output").length;

    gate.open();
    await turn;
    await settle();

    expect(harness.of("companion.audio.output").length).toBe(afterBargeIn);

    harness.detector.emit("speech_stopped");
    await settle();
    expect(harness.of("companion.input.state").at(-1)!.payload.isSpeaking).toBe(false);
    await harness.session.cleanup();
  });
});

describe("companion message acknowledgements", () => {
  it("acknowledges before generation completes and deduplicates retries", async () => {
    const gate = createGate();
    const harness = createHarness({
      turns: [{ deltas: ["I am checking the task now.", " It is running."], gate: gate.promise }],
    });
    await harness.start();
    const first = harness.typed("Check my task");
    await settle();
    expect(harness.of("companion.message.send.response").at(-1)?.payload).toEqual({
      requestId: "r2",
      accepted: true,
      reasonCode: null,
    });
    await harness.typed("Check my task");
    expect(harness.of("companion.transcript")).toHaveLength(1);
    gate.open();
    await first;
    await harness.session.cleanup();
  });

  it("rejects typed input when closed", async () => {
    const harness = createHarness({});
    await harness.typed("Check my task");
    expect(harness.of("companion.message.send.response").at(-1)?.payload).toEqual({
      requestId: "r2",
      accepted: false,
      reasonCode: "companion_session_closed",
    });
    await harness.session.cleanup();
  });
  it("releases a session stopped while its backend is warming", async () => {
    const harness = createHarness();
    let release: () => void = () => {};
    let closed = 0;
    harness.runtime.createBackend = () => ({
      kind: "cli",
      warm: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      close: async () => {
        closed += 1;
        release();
      },
      beginTurn: () => {
        throw new Error("No turn should run");
      },
    });
    const starting = harness.session.handleSessionStart({
      type: "companion.session.start.request",
      requestId: "start-race",
    });
    await Promise.resolve();
    await Promise.resolve();
    await harness.session.cleanup();
    await starting;
    expect(closed).toBeGreaterThan(0);
    expect(harness.runtime.activeSession).toBeUndefined();
    expect(harness.emitted).toContainEqual(
      expect.objectContaining({
        type: "companion.session.start.response",
        payload: expect.objectContaining({ accepted: false }),
      }),
    );
  });
});
