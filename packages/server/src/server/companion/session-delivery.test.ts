import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "../messages.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import { CompanionTurnError, type CompanionBackend } from "./backend.js";
import { CompanionDeferredJobs } from "./deferred-jobs.js";
import { CompanionSession, type CompanionRuntime } from "./session.js";
import { CompanionNotebookStore } from "./store.js";

const logger = pino({ level: "silent" });
let home: string;
let sessions: CompanionSession[];

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "fde-companion-delivery-"));
  sessions = [];
});

afterEach(async () => {
  await Promise.all(sessions.map((session) => session.cleanup()));
  await rm(home, { recursive: true, force: true });
});

class SpeechSession extends EventEmitter {
  readonly requiredSampleRate = 16000;
  async connect() {}
  appendPcm16() {}
  flush() {}
  reset() {}
  commit() {}
  clear() {}
  close() {}
}

function createHarness() {
  let synthesis: "ok" | "error" | "empty" = "ok";
  let response: "ok" | "error" | "silent" = "ok";
  let autoAck = true;
  let workerRuns = 0;
  const prompts: string[] = [];
  const emitted: SessionOutboundMessage[] = [];
  const tts: TextToSpeechProvider = {
    async synthesizeSpeech() {
      if (synthesis === "error") throw new Error("Synthesis failed");
      return {
        stream: Readable.from(synthesis === "empty" ? [] : [Buffer.from("audio")]),
        format: "pcm;rate=24000",
      };
    },
  };
  const backend: CompanionBackend = {
    kind: "cli",
    async warm() {},
    async close() {},
    beginTurn({ text }) {
      prompts.push(text);
      return {
        async *respond() {
          if (response === "error") throw new CompanionTurnError("connection", "Offline", null);
          if (response === "ok") {
            yield { type: "text_delta", text: "Your worker finished the requested change." };
            yield { type: "text_delta", text: " The checks all passed successfully." };
          }
          return { toolCalls: [] };
        },
      };
    },
  };
  function loadJobs() {
    return new CompanionDeferredJobs({
      logger,
      filePath: path.join(home, "jobs.json"),
      run: async () => {
        workerRuns += 1;
        return "The change is complete.";
      },
    });
  }
  const jobs = loadJobs();
  const runtime: CompanionRuntime = {
    capability: { enabled: true, reason: "" },
    modelConfig: { status: "available", backend: "cli", model: "haiku" },
    notebook: new CompanionNotebookStore({ filePath: path.join(home, "notebook.json") }),
    fillers: {
      async prewarm() {},
      async take() {
        return null;
      },
    },
    createTools: () => [],
    runDeferredJob: async () => "unused",
    createBackend: () => backend,
    jobs,
  };
  function connect() {
    const detector = new SpeechSession();
    const session = new CompanionSession({
      sessionId: `delivery-${sessions.length}`,
      logger,
      runtime,
      tts,
      stt: { id: "local", createSession: () => new SpeechSession() },
      turnDetection: { id: "local", createSession: () => detector },
      sttLanguage: "en",
      host: {
        emit(message) {
          emitted.push(message);
          if (message.type === "companion.audio.output" && autoAck)
            queueMicrotask(() => session.handleAudioPlayed(message.payload.id));
        },
      },
    });
    sessions.push(session);
    return { session, detector };
  }
  const connection = connect();
  return {
    ...connection,
    prompts,
    jobs,
    loadJobs,
    connect,
    runtime,
    setSynthesis(value: typeof synthesis) {
      synthesis = value;
    },
    setResponse(value: typeof response) {
      response = value;
    },
    setAutoAck(value: boolean) {
      autoAck = value;
    },
    get workerRuns() {
      return workerRuns;
    },
    audio() {
      return emitted.filter((message) => message.type === "companion.audio.output");
    },
    async startJob() {
      const receipt = jobs.start({
        kind: "think",
        label: "Test change",
        question: "Do the work",
        agentId: null,
      });
      await jobs.drain();
      return receipt.jobId;
    },
  };
}

async function start(session: CompanionSession) {
  await session.handleSessionStart({ type: "companion.session.start.request", requestId: "start" });
}

// Synchronize with queued work; assertions below observe persisted receipts and audio.
async function idle(session: CompanionSession) {
  let queued: Promise<void>;
  do {
    queued = session["turnQueue"];
    await queued;
    await new Promise<void>((resolve) => setImmediate(resolve));
  } while (queued !== session["turnQueue"]);
}

describe("Companion result delivery", () => {
  it.each(["error", "empty"] as const)(
    "retains results when synthesis is %s and retries after user input",
    async (failure) => {
      const h = createHarness();
      h.setSynthesis(failure);
      const jobId = await h.startJob();
      await start(h.session);
      await idle(h.session);
      expect(h.jobs.get(jobId)?.announced).not.toBe(true);
      expect(h.loadJobs().get(jobId)?.announced).not.toBe(true);
      expect(h.prompts).toHaveLength(1);
      h.setSynthesis("ok");
      await h.session.handleMessageSend({
        type: "companion.message.send.request",
        requestId: "retry",
        text: "Anything finished?",
      });
      await idle(h.session);
      expect(h.jobs.get(jobId)?.announced).toBe(true);
      expect(h.loadJobs().get(jobId)?.announced).toBe(true);
      expect(h.prompts).toHaveLength(3);
      expect(h.workerRuns).toBe(1);
    },
  );

  it.each(["error", "silent"] as const)(
    "retains results after a %s model response and replays on reconnect",
    async (failure) => {
      const h = createHarness();
      h.setResponse(failure);
      const jobId = await h.startJob();
      await start(h.session);
      await idle(h.session);
      expect(h.jobs.get(jobId)?.announced).not.toBe(true);
      expect(h.prompts).toHaveLength(1);
      expect(h.audio().length).toBe(failure === "error" ? 2 : 0);
      await h.session.cleanup();
      h.setResponse("ok");
      h.runtime.jobs = h.loadJobs();
      const reconnected = h.connect().session;
      await start(reconnected);
      await idle(reconnected);
      expect(h.loadJobs().get(jobId)?.announced).toBe(true);
      expect(h.prompts).toHaveLength(2);
      expect(h.workerRuns).toBe(1);
    },
  );

  it("waits for all audio acknowledgements and does not replay a delivered result", async () => {
    const h = createHarness();
    h.setAutoAck(false);
    const jobId = await h.startJob();
    await start(h.session);
    await expect.poll(() => h.audio().length).toBe(1);
    expect(h.audio()).toHaveLength(1);
    expect(h.jobs.get(jobId)?.announced).not.toBe(true);
    h.session.handleAudioPlayed(h.audio()[0].payload.id);
    await expect.poll(() => h.audio().length).toBe(2);
    expect(h.audio()).toHaveLength(2);
    expect(h.jobs.get(jobId)?.announced).not.toBe(true);
    h.session.handleAudioPlayed(h.audio()[1].payload.id);
    await idle(h.session);
    expect(h.jobs.get(jobId)?.announced).toBe(true);
    await h.session.cleanup();
    const reconnected = h.connect().session;
    await start(reconnected);
    await idle(reconnected);
    expect(h.prompts).toHaveLength(1);
  });

  it("retains partially heard results and ignores late playback after interruption", async () => {
    const h = createHarness();
    h.setAutoAck(false);
    const jobId = await h.startJob();
    await start(h.session);
    await expect.poll(() => h.audio().length).toBe(1);
    h.session.handleAudioPlayed(h.audio()[0].payload.id);
    await expect.poll(() => h.audio().length).toBe(2);
    expect(h.audio()).toHaveLength(2);
    h.detector.emit("speech_started");
    await idle(h.session);
    h.session.handleAudioPlayed(h.audio()[1].payload.id);
    await idle(h.session);
    expect(h.jobs.get(jobId)?.announced).not.toBe(true);
    expect(h.prompts).toHaveLength(1);
    await h.session.cleanup();
    h.setAutoAck(true);
    const reconnected = h.connect().session;
    await start(reconnected);
    await idle(reconnected);
    expect(h.jobs.get(jobId)?.announced).toBe(true);
    expect(h.workerRuns).toBe(1);
  });

  it("keeps the receipt unannounced if persisting delivery fails", async () => {
    const h = createHarness();
    const jobId = await h.startJob();
    const temporary = path.join(home, "jobs.json.tmp");
    await mkdir(temporary);
    await start(h.session);
    await idle(h.session);
    expect(h.jobs.get(jobId)?.announced).not.toBe(true);
    expect(h.loadJobs().get(jobId)?.announced).not.toBe(true);
    expect(h.prompts).toHaveLength(1);
    await rm(temporary, { recursive: true });
    await h.session.handleMessageSend({
      type: "companion.message.send.request",
      requestId: "retry",
      text: "Read the result again",
    });
    await idle(h.session);
    expect(h.loadJobs().get(jobId)?.announced).toBe(true);
    expect(h.workerRuns).toBe(1);
  });

  it("gives user input priority over an announcement queued before generation", async () => {
    const h = createHarness();
    await start(h.session);
    let userTurn: Promise<void> | undefined;
    const unsubscribe = h.jobs.subscribe((job) => {
      if (job.status === "succeeded")
        userTurn = h.session.handleMessageSend({
          type: "companion.message.send.request",
          requestId: "resume",
          text: "What happened?",
        });
    });
    const jobId = await h.startJob();
    await userTurn;
    await idle(h.session);
    unsubscribe();
    expect(h.jobs.get(jobId)?.announced).toBe(true);
    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[0]).toContain("They said: What happened?");
    expect(h.prompts[1]).toContain("The change is complete.");
    expect(h.workerRuns).toBe(1);
  });
});
