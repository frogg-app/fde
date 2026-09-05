import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTtsCache } from "../notifications/tts-cache.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import {
  COMPANION_FILLERS,
  COMPANION_STALL_DELAY_MS,
  createCompanionFillerBank,
  createCompanionStallGuard,
  type CompanionScheduler,
} from "./fillers.js";

let dir: string;
const logger = pino({ level: "silent" });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fde-companion-fillers-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createFakeTts(): TextToSpeechProvider & { synthesized: string[] } {
  const synthesized: string[] = [];
  return {
    synthesized,
    async synthesizeSpeech(text) {
      synthesized.push(text);
      const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 0]).buffer);
      return { stream: Readable.from([pcm]), format: "pcm;rate=24000" };
    },
  };
}

interface ManualScheduler extends CompanionScheduler {
  advance(ms: number): void;
  pending: number;
}

function createManualScheduler(): ManualScheduler {
  interface Scheduled {
    dueAt: number;
    run: () => void;
  }
  let now = 0;
  let scheduled: Scheduled[] = [];
  return {
    get pending() {
      return scheduled.length;
    },
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

describe("createCompanionFillerBank", () => {
  it("pre-synthesises the whole bank so playback needs no provider round trip", async () => {
    const tts = createFakeTts();
    const bank = createCompanionFillerBank({
      cache: createTtsCache({ dir }),
      resolveTts: () => tts,
      logger,
    });

    await bank.prewarm();
    expect(tts.synthesized).toEqual([...COMPANION_FILLERS]);

    await bank.prewarm();
    expect(tts.synthesized).toEqual([...COMPANION_FILLERS]);

    const filler = await bank.take();
    expect(filler).not.toBeNull();
    expect(filler!.format).toBe("audio/wav");
    expect(Buffer.from(filler!.audio, "base64").length).toBeGreaterThan(0);
  });

  it("never speaks the same filler twice in a row", async () => {
    const bank = createCompanionFillerBank({
      cache: createTtsCache({ dir }),
      resolveTts: () => createFakeTts(),
      logger,
      // Always the first remaining candidate: the worst case for repetition.
      pick: () => 0,
    });
    await bank.prewarm();

    const spoken: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const filler = await bank.take();
      spoken.push(filler!.text);
    }

    expect(spoken).toHaveLength(6);
    for (let i = 1; i < spoken.length; i += 1) {
      expect(spoken[i]).not.toBe(spoken[i - 1]);
    }
  });

  it("stays silent rather than stalling on synthesis when nothing was pre-warmed", async () => {
    const bank = createCompanionFillerBank({
      cache: createTtsCache({ dir }),
      resolveTts: () => null,
      logger,
    });

    await bank.prewarm();
    expect(await bank.take()).toBeNull();
  });
});

describe("createCompanionStallGuard", () => {
  it("waits far longer on the CLI backend, whose routine turn is already a second slower", () => {
    const scheduler = createManualScheduler();
    let stalls = 0;
    const guard = createCompanionStallGuard({
      scheduler,
      onStall: () => (stalls += 1),
      delayMs: COMPANION_STALL_DELAY_MS.cli,
    });

    guard.arm();
    scheduler.advance(COMPANION_STALL_DELAY_MS.api);
    expect(stalls).toBe(0);

    scheduler.advance(COMPANION_STALL_DELAY_MS.cli - COMPANION_STALL_DELAY_MS.api);
    expect(stalls).toBe(1);
  });

  it("speaks once the silence outlasts the stall delay", () => {
    const scheduler = createManualScheduler();
    let stalls = 0;
    const guard = createCompanionStallGuard({
      scheduler,
      onStall: () => (stalls += 1),
      delayMs: COMPANION_STALL_DELAY_MS.api,
    });

    guard.arm();
    scheduler.advance(COMPANION_STALL_DELAY_MS.api - 1);
    expect(stalls).toBe(0);

    scheduler.advance(1);
    expect(stalls).toBe(1);
  });

  it("stays quiet when real audio is queued before the delay elapses", () => {
    const scheduler = createManualScheduler();
    let stalls = 0;
    const guard = createCompanionStallGuard({
      scheduler,
      onStall: () => (stalls += 1),
      delayMs: COMPANION_STALL_DELAY_MS.api,
    });

    guard.arm();
    scheduler.advance(400);
    guard.cancel();
    scheduler.advance(10_000);

    expect(stalls).toBe(0);
    expect(scheduler.pending).toBe(0);
  });

  it("replaces the pending guard when a new turn re-arms it", () => {
    const scheduler = createManualScheduler();
    let stalls = 0;
    const guard = createCompanionStallGuard({
      scheduler,
      onStall: () => (stalls += 1),
      delayMs: COMPANION_STALL_DELAY_MS.api,
    });

    guard.arm();
    scheduler.advance(400);
    guard.arm();
    scheduler.advance(400);
    expect(stalls).toBe(0);

    scheduler.advance(COMPANION_STALL_DELAY_MS.api);
    expect(stalls).toBe(1);
  });
});
