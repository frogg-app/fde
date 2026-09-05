import type { Readable } from "node:stream";
import type { Logger } from "pino";

import { toCacheEntry } from "../notifications/spoken-alerts.js";
import type { TtsCache } from "../notifications/tts-cache.js";
import type { TextToSpeechProvider } from "../speech/speech-provider.js";

/**
 * The stall guard's bank. Deliberately short and varied: a filler heard twice in
 * a row is worse than the silence it was covering, so the bank is small enough
 * to pre-synthesise at startup and the picker never repeats itself.
 */
export const COMPANION_FILLERS = [
  "one sec",
  "let me have a look",
  "hmm, let me think",
  "give me a moment",
  "right, checking",
  "hold on",
] as const;

/** How long after end-of-speech a silence stops being a pause and starts being a bug. */
export const COMPANION_STALL_DELAY_MS = 700;

const CACHE_ID_PREFIX = "companion-filler:";

export interface CompanionFillerAudio {
  text: string;
  /** Base64, ready for `companion.audio.output`. */
  audio: string;
  format: string;
}

export interface CompanionFillerBank {
  /** Synthesise the whole bank into the TTS cache. Called once at daemon startup. */
  prewarm(): Promise<void>;
  /** The next filler to speak, or null when nothing was pre-synthesised. */
  take(): Promise<CompanionFillerAudio | null>;
}

export interface CompanionFillerBankOptions {
  cache: TtsCache;
  resolveTts: () => TextToSpeechProvider | null;
  logger: Logger;
  /** Which of `count` candidates to take. Injected so tests are not random. */
  pick?: (count: number) => number;
}

async function collectStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createCompanionFillerBank(
  options: CompanionFillerBankOptions,
): CompanionFillerBank {
  const logger = options.logger.child({ component: "companion-fillers" });
  const pick = options.pick ?? ((count: number) => Math.floor(Math.random() * count));
  let lastSpoken: string | null = null;

  async function synthesize(text: string): Promise<void> {
    const tts = options.resolveTts();
    if (!tts) {
      return;
    }
    const cacheId = `${CACHE_ID_PREFIX}${text}`;
    if (await options.cache.get(cacheId)) {
      return;
    }
    const result = await tts.synthesizeSpeech(text);
    await options.cache.put(
      cacheId,
      toCacheEntry(await collectStream(result.stream), result.format),
    );
  }

  return {
    async prewarm() {
      for (const text of COMPANION_FILLERS) {
        try {
          await synthesize(text);
        } catch (error) {
          logger.warn({ err: error, text }, "Companion filler synthesis failed");
        }
      }
    },

    async take() {
      const candidates = COMPANION_FILLERS.filter((text) => text !== lastSpoken);
      const text = candidates[pick(candidates.length)];
      const entry = await options.cache.get(`${CACHE_ID_PREFIX}${text}`);
      if (!entry) {
        logger.debug({ text }, "Companion filler was never synthesised, staying silent");
        return null;
      }
      lastSpoken = text;
      return { text, audio: entry.bytes.toString("base64"), format: entry.mimeType };
    },
  };
}

/**
 * Timer port. Tests drive the guard through a manual scheduler rather than
 * waiting on real time.
 */
export interface CompanionScheduler {
  schedule(delayMs: number, run: () => void): () => void;
}

export const systemScheduler: CompanionScheduler = {
  schedule(delayMs, run) {
    const handle = setTimeout(run, delayMs);
    return () => clearTimeout(handle);
  },
};

export interface CompanionStallGuard {
  /** Start the countdown at end-of-speech. Re-arming replaces any pending guard. */
  arm(): void;
  /** Called the instant real audio is queued, and on barge-in. */
  cancel(): void;
}

export interface CompanionStallGuardOptions {
  scheduler: CompanionScheduler;
  onStall: () => void;
  delayMs?: number;
}

export function createCompanionStallGuard(
  options: CompanionStallGuardOptions,
): CompanionStallGuard {
  const delayMs = options.delayMs ?? COMPANION_STALL_DELAY_MS;
  let cancelPending: (() => void) | null = null;

  function cancel(): void {
    cancelPending?.();
    cancelPending = null;
  }

  return {
    arm() {
      cancel();
      cancelPending = options.scheduler.schedule(delayMs, () => {
        cancelPending = null;
        options.onStall();
      });
    },
    cancel,
  };
}
