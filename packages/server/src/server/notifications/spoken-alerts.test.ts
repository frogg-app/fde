import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parsePcm16MonoWav } from "../speech/audio.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import { createSpokenAlertService, toCacheEntry } from "./spoken-alerts.js";
import { createTtsCache } from "./tts-cache.js";

let dir: string;
const logger = pino({ level: "silent" });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fde-spoken-alerts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createFakeTts(): TextToSpeechProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async synthesizeSpeech(text) {
      calls.push(text);
      const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 0]).buffer);
      return { stream: Readable.from([pcm]), format: "pcm;rate=24000" };
    },
  };
}

describe("toCacheEntry", () => {
  it("wraps raw PCM in a WAV header at the advertised rate and keeps codecs verbatim", () => {
    const pcm = Buffer.from(new Int16Array([1, 2, 3]).buffer);
    const wav = toCacheEntry(pcm, "pcm;rate=16000");
    expect(wav.mimeType).toBe("audio/wav");
    expect(parsePcm16MonoWav(wav.bytes)).toEqual({ sampleRate: 16000, pcm16: pcm });

    const mp3 = toCacheEntry(Buffer.from("mp3-bytes"), "mp3");
    expect(mp3).toEqual({ bytes: Buffer.from("mp3-bytes"), mimeType: "audio/mpeg" });
  });
});

describe("createSpokenAlertService", () => {
  it("synthesises once in the background and serves the cached WAV to readers", async () => {
    const tts = createFakeTts();
    const service = createSpokenAlertService({
      enabled: true,
      resolveTts: () => tts,
      cache: createTtsCache({ dir }),
      logger,
    });

    expect(service.isAvailable()).toBe(true);
    expect(service.prepare({ id: "n1", text: "Agent finished." })).toBe(true);
    expect(service.prepare({ id: "n1", text: "Agent finished." })).toBe(true);

    const entry = await service.read("n1");
    expect(entry?.mimeType).toBe("audio/wav");
    expect(parsePcm16MonoWav(entry!.bytes).sampleRate).toBe(24000);
    expect(tts.calls).toEqual(["Agent finished."]);

    const again = await service.read("n1");
    expect(again).toEqual(entry);
  });

  it("refuses to prepare when disabled or when no TTS provider is ready", async () => {
    const disabled = createSpokenAlertService({
      enabled: false,
      resolveTts: () => createFakeTts(),
      cache: createTtsCache({ dir }),
      logger,
    });
    expect(disabled.isAvailable()).toBe(false);
    expect(disabled.prepare({ id: "n1", text: "x" })).toBe(false);
    expect(await disabled.read("n1")).toBeNull();

    const noTts = createSpokenAlertService({
      enabled: true,
      resolveTts: () => null,
      cache: createTtsCache({ dir }),
      logger,
    });
    expect(noTts.isAvailable()).toBe(false);
    expect(noTts.prepare({ id: "n1", text: "x" })).toBe(false);
  });

  it("reports no audio when synthesis fails instead of failing the notification", async () => {
    const service = createSpokenAlertService({
      enabled: true,
      resolveTts: () => ({
        async synthesizeSpeech() {
          throw new Error("tts crashed");
        },
      }),
      cache: createTtsCache({ dir }),
      logger,
    });
    expect(service.prepare({ id: "broken", text: "x" })).toBe(true);
    expect(await service.read("broken")).toBeNull();
  });
});
