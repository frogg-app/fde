import { describe, expect, it } from "vitest";

import {
  createCompanionSpeechStream,
  cutSpeakableSegment,
  type CompanionSpeechSink,
} from "./speech-stream.js";

interface RecordingSink extends CompanionSpeechSink {
  spoken: string[];
}

function createRecordingSink(): RecordingSink {
  const spoken: string[] = [];
  return {
    spoken,
    async speak(text) {
      spoken.push(text);
    },
  };
}

describe("cutSpeakableSegment", () => {
  it("waits while the buffer is shorter than a speakable segment", () => {
    expect(cutSpeakableSegment("Sure thing.")).toBeNull();
  });

  it("cuts at the first sentence boundary past the minimum", () => {
    const cut = cutSpeakableSegment(
      "I had a look at the flaky push test just now. It fails on Windows only.",
    );
    expect(cut).toEqual({
      segment: "I had a look at the flaky push test just now.",
      rest: " It fails on Windows only.",
    });
  });

  it("cuts at a clause boundary when no sentence has ended yet", () => {
    const cut = cutSpeakableSegment(
      "There are three agents running in the checkout workspace, and two of them",
    );
    expect(cut).toEqual({
      segment: "There are three agents running in the checkout workspace,",
      rest: " and two of them",
    });
  });

  it("does not cut inside a decimal number", () => {
    const cut = cutSpeakableSegment("The whole push finished in about 4.5 seconds. All green.");
    expect(cut).toEqual({
      segment: "The whole push finished in about 4.5 seconds.",
      rest: " All green.",
    });
  });

  it("cuts at a word when a clause-free run runs too long", () => {
    const buffer = "word ".repeat(60);
    const cut = cutSpeakableSegment(buffer);
    expect(cut).not.toBeNull();
    expect(cut!.segment.length).toBeLessThanOrEqual(220);
    expect(cut!.segment.endsWith("word")).toBe(true);
  });
});

describe("createCompanionSpeechStream", () => {
  function createStream(sink: CompanionSpeechSink) {
    const errors: Error[] = [];
    let speakingAt = -1;
    let pushes = 0;
    const controller = new AbortController();
    const stream = createCompanionSpeechStream({
      sink,
      onSpeaking: () => {
        speakingAt = pushes;
      },
      onError: (error) => errors.push(error),
      signal: controller.signal,
    });
    return {
      controller,
      errors,
      speakingAt: () => speakingAt,
      push(text: string) {
        pushes += 1;
        stream.push(text);
      },
      end: () => stream.end(),
      idle: () => stream.idle(),
    };
  }

  it("speaks mid-generation, before the turn ends", async () => {
    const sink = createRecordingSink();
    const stream = createStream(sink);

    stream.push("I had a look at the flaky push test just now.");
    stream.push(" It fails on Windows only.");
    await stream.idle();

    expect(sink.spoken).toEqual(["I had a look at the flaky push test just now."]);

    stream.end();
    await stream.idle();
    expect(sink.spoken).toEqual([
      "I had a look at the flaky push test just now.",
      "It fails on Windows only.",
    ]);
  });

  it("reports it is speaking as the first segment is queued", async () => {
    const sink = createRecordingSink();
    const stream = createStream(sink);

    stream.push("Sure,");
    expect(stream.speakingAt()).toBe(-1);

    stream.push(" I will start an agent on that in the checkout workspace.");
    expect(stream.speakingAt()).toBe(2);
    await stream.idle();
  });

  it("speaks a short final reply that never reaches a boundary", async () => {
    const sink = createRecordingSink();
    const stream = createStream(sink);

    stream.push("Yep, done.");
    stream.end();
    await stream.idle();

    expect(sink.spoken).toEqual(["Yep, done."]);
  });

  it("drops buffered and queued speech once the turn is aborted", async () => {
    const sink = createRecordingSink();
    const stream = createStream(sink);

    stream.push("I had a look at the flaky push test just now.");
    stream.controller.abort();
    stream.push(" It fails on Windows only.");
    stream.end();
    await stream.idle();

    expect(sink.spoken).toEqual([]);
  });

  it("keeps speaking after one segment fails to synthesise", async () => {
    const spoken: string[] = [];
    const sink: CompanionSpeechSink = {
      async speak(text) {
        if (spoken.length === 0) {
          spoken.push(text);
          throw new Error("TTS not configured");
        }
        spoken.push(text);
      },
    };
    const stream = createStream(sink);

    stream.push("I had a look at the flaky push test just now.");
    stream.push(" It fails on Windows only.");
    stream.end();
    await stream.idle();

    expect(spoken).toEqual([
      "I had a look at the flaky push test just now.",
      "It fails on Windows only.",
    ]);
    expect(stream.errors.map((error) => error.message)).toEqual(["TTS not configured"]);
  });
});
