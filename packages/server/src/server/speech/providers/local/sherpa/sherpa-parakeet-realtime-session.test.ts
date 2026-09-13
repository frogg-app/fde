import { afterEach, describe, expect, it, vi } from "vitest";
import { SherpaParakeetRealtimeTranscriptionSession } from "./sherpa-parakeet-realtime-session.js";

function setup(sampleRate = 16000) {
  let samples = 0;
  const decoded: number[] = [];
  const engine = {
    sampleRate,
    createStream: () => ({ acceptWaveform() {} }),
    acceptWaveform(_stream: unknown, _rate: number, audio: Float32Array) {
      samples = audio.length;
    },
    recognizer: {
      createStream() {},
      decode() {
        decoded.push(samples);
      },
      getResult: () => String(samples),
    },
  };
  const session = new SherpaParakeetRealtimeTranscriptionSession({ engine });
  const events: { segmentId: string; transcript: string; isFinal: boolean }[] = [];
  session.on("transcript", (event) => events.push(event));
  return { session, events, decoded };
}

describe("incremental Parakeet session", () => {
  afterEach(() => vi.useRealTimers());
  it("publishes growing partials before a pause and keeps consecutive commits separate", async () => {
    vi.useFakeTimers();
    const { session, events } = setup();
    await session.connect();
    session.appendPcm16(Buffer.from([1, 0]));
    await vi.advanceTimersByTimeAsync(401);
    session.appendPcm16(Buffer.from([2, 0]));
    await vi.advanceTimersByTimeAsync(401);
    expect(events.map((event) => event.transcript)).toEqual(["1", "2"]);
    expect(events.every((event) => !event.isFinal)).toBe(true);
    session.commit();
    session.appendPcm16(Buffer.from([3, 0, 4, 0, 5, 0]));
    session.commit();
    await vi.runAllTimersAsync();
    const finals = events.filter((event) => event.isFinal);
    expect(finals.map((event) => event.transcript)).toEqual(["2", "3"]);
    expect(finals[0].segmentId).not.toBe(finals[1].segmentId);
    session.close();
  });

  it("bounds decoding windows while assembling long speech, and cancels queued output at close", async () => {
    vi.useFakeTimers();
    const { session, events, decoded } = setup(10);
    await session.connect();
    session.appendPcm16(Buffer.alloc(1000, 1));
    await vi.advanceTimersByTimeAsync(401);
    expect(decoded).toEqual([200, 200, 100]);
    expect(events[0].transcript).toBe("200 200 100");
    session.commit();
    session.close();
    await vi.runAllTimersAsync();
    expect(events).toHaveLength(1);
  });
});
