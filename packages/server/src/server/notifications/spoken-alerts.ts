import type { Readable } from "node:stream";
import type { Logger } from "pino";

import type { PaseoSpeechConfig } from "../bootstrap.js";

import { encodePcm16MonoWav, parsePcmRateFromFormat } from "../speech/audio.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";
import type { TtsCache, TtsCacheEntry } from "./tts-cache.js";

const SYNTHESIS_TIMEOUT_MS = 30_000;
const DEFAULT_PCM_RATE = 24_000;

export interface SpokenAlertService {
  /** Whether alerts get audio at all: the feature is on and a TTS provider is ready. */
  isAvailable(): boolean;
  /**
   * Starts synthesis in the background and answers whether audio will exist for `id`.
   * The notification goes out immediately; `read` waits for the audio to land.
   */
  prepare(params: { id: string; text: string }): boolean;
  read(id: string): Promise<TtsCacheEntry | null>;
}

interface SpokenAlertServiceDeps {
  enabled: boolean;
  resolveTts: () => TextToSpeechProvider | null;
  cache: TtsCache;
  logger: Logger;
  synthesisTimeoutMs?: number;
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Alert audio is cached as a self-describing file: raw PCM gets a WAV header, codecs stay as-is. */
export function toCacheEntry(audio: Buffer, format: string): TtsCacheEntry {
  const normalized = format.trim().toLowerCase();
  if (normalized.startsWith("pcm") || normalized.startsWith("audio/pcm")) {
    const rate = parsePcmRateFromFormat(normalized, DEFAULT_PCM_RATE) ?? DEFAULT_PCM_RATE;
    return { bytes: encodePcm16MonoWav(audio, rate), mimeType: "audio/wav" };
  }
  if (normalized === "wav" || normalized === "audio/wav")
    return { bytes: audio, mimeType: "audio/wav" };
  if (normalized === "mp3" || normalized === "audio/mpeg")
    return { bytes: audio, mimeType: "audio/mpeg" };
  if (normalized === "opus" || normalized === "ogg") return { bytes: audio, mimeType: "audio/ogg" };
  if (normalized === "aac") return { bytes: audio, mimeType: "audio/aac" };
  if (normalized === "flac") return { bytes: audio, mimeType: "audio/flac" };
  return { bytes: audio, mimeType: "application/octet-stream" };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isSpokenNotificationsEnabled(speech: PaseoSpeechConfig | undefined): boolean {
  return speech?.notifications?.enabled === true;
}

export function createSpokenAlertService(deps: SpokenAlertServiceDeps): SpokenAlertService {
  const logger = deps.logger.child({ module: "spoken-alerts" });
  const timeoutMs = deps.synthesisTimeoutMs ?? SYNTHESIS_TIMEOUT_MS;
  const inFlight = new Map<string, Promise<TtsCacheEntry | null>>();

  function isAvailable(): boolean {
    return deps.enabled && deps.resolveTts() !== null;
  }

  async function synthesize(
    id: string,
    text: string,
    tts: TextToSpeechProvider,
  ): Promise<TtsCacheEntry | null> {
    try {
      const result = await withTimeout(tts.synthesizeSpeech(text), timeoutMs, "Alert synthesis");
      const audio = await withTimeout(collectStream(result.stream), timeoutMs, "Alert audio read");
      const entry = toCacheEntry(audio, result.format);
      await deps.cache.put(id, entry);
      logger.debug(
        { id, bytes: entry.bytes.length, mimeType: entry.mimeType },
        "Spoken alert cached",
      );
      return entry;
    } catch (error) {
      logger.warn({ err: error, id }, "Spoken alert synthesis failed");
      return null;
    } finally {
      inFlight.delete(id);
    }
  }

  return {
    isAvailable,
    prepare({ id, text }) {
      if (!deps.enabled) return false;
      const tts = deps.resolveTts();
      if (!tts) return false;
      if (!inFlight.has(id)) {
        inFlight.set(id, synthesize(id, text, tts));
      }
      return true;
    },
    async read(id) {
      const pending = inFlight.get(id);
      if (pending) return pending;
      return deps.cache.get(id);
    },
  };
}
