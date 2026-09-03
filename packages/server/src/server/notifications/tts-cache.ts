import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const TTS_CACHE_DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export interface TtsCacheEntry {
  bytes: Buffer;
  mimeType: string;
}

export interface TtsCache {
  get(id: string): Promise<TtsCacheEntry | null>;
  put(id: string, entry: TtsCacheEntry): Promise<void>;
  /** Bytes currently held on disk, after eviction. */
  totalBytes(): Promise<number>;
}

interface IndexedFile {
  fileName: string;
  bytes: number;
  lastUsedMs: number;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

const MIME_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_MIME).map(([mime, extension]) => [extension, mime]),
);

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

function resolveExtension(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? "bin";
}

function resolveMimeType(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1);
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Synthesised alert audio, one file per notification under `$PASEO_HOME/tts-cache`.
 *
 * The index is rebuilt from the directory on first use so a daemon restart keeps serving audio
 * for pushes that are still sitting on a phone. Eviction is least-recently-used by file mtime,
 * which `get` refreshes; every notification is played a handful of times at most, so the
 * cache only has to stay bounded, not clever.
 */
export function createTtsCache(options: {
  dir: string;
  maxBytes?: number;
  now?: () => number;
}): TtsCache {
  const maxBytes = options.maxBytes ?? TTS_CACHE_DEFAULT_MAX_BYTES;
  const now = options.now ?? Date.now;
  const index = new Map<string, IndexedFile>();
  let loaded: Promise<void> | null = null;

  async function load(): Promise<void> {
    await mkdir(options.dir, { recursive: true });
    const names = await readdir(options.dir);
    await Promise.all(
      names.map(async (fileName) => {
        const fileStat = await stat(join(options.dir, fileName));
        if (!fileStat.isFile()) return;
        const hash = fileName.slice(0, fileName.indexOf("."));
        index.set(hash, { fileName, bytes: fileStat.size, lastUsedMs: fileStat.mtimeMs });
      }),
    );
  }

  function ensureLoaded(): Promise<void> {
    loaded ??= load();
    return loaded;
  }

  function usedBytes(): number {
    let total = 0;
    for (const entry of index.values()) total += entry.bytes;
    return total;
  }

  async function evictUntilFits(incomingBytes: number): Promise<void> {
    const budget = Math.max(0, maxBytes - incomingBytes);
    const oldestFirst = [...index.entries()].sort((a, b) => a[1].lastUsedMs - b[1].lastUsedMs);
    for (const [hash, entry] of oldestFirst) {
      if (usedBytes() <= budget) break;
      index.delete(hash);
      await rm(join(options.dir, entry.fileName), { force: true });
    }
  }

  return {
    async get(id) {
      await ensureLoaded();
      const hash = hashId(id);
      const entry = index.get(hash);
      if (!entry) return null;
      const path = join(options.dir, entry.fileName);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        index.delete(hash);
        return null;
      }
      const usedAt = now();
      entry.lastUsedMs = usedAt;
      await utimes(path, new Date(usedAt), new Date(usedAt)).catch(() => undefined);
      return { bytes, mimeType: resolveMimeType(entry.fileName) };
    },

    async put(id, entry) {
      await ensureLoaded();
      const hash = hashId(id);
      const previous = index.get(hash);
      if (previous) {
        index.delete(hash);
        await rm(join(options.dir, previous.fileName), { force: true });
      }
      await evictUntilFits(entry.bytes.length);
      const fileName = `${hash}.${resolveExtension(entry.mimeType)}`;
      const path = join(options.dir, fileName);
      await writeFile(path, entry.bytes);
      const writtenAt = now();
      await utimes(path, new Date(writtenAt), new Date(writtenAt)).catch(() => undefined);
      index.set(hash, { fileName, bytes: entry.bytes.length, lastUsedMs: writtenAt });
    },

    async totalBytes() {
      await ensureLoaded();
      return usedBytes();
    },
  };
}
