import { highlightCode, type HighlightToken } from "@fde/highlight";

// Shared, theme-independent tokenization + cache for syntax highlighting.
// Used by markdown code blocks, file preview, and tool-call detail blocks
// (Edit diff / Write / Read). Colors are applied at render time, so the cache
// key is just (extension, code) and one entry serves both light and dark.

export interface KeyedToken {
  key: string;
  token: HighlightToken;
}

export interface KeyedLine {
  key: string;
  tokens: KeyedToken[];
}

// Above this, highlighting a whole document on the main thread risks a visible
// stall when a large Read/Write block is expanded. Callers fall back to plain
// monospace text. Generous enough to cover the vast majority of real blocks.
export const MAX_HIGHLIGHT_CHARS = 100_000;

// Budget in source characters rather than entry count. Entries vary by four orders
// of magnitude — MAX_HIGHLIGHT_CHARS admits 100k-char inputs — so a count-based
// bound puts no ceiling on the memory this holds, and the token arrays are
// themselves several times the size of the source they came from.
const TOKENIZATION_CACHE_MAX_CHARS = 2_000_000;

interface CacheEntry {
  value: HighlightToken[][];
  cost: number;
}

class SizedLRUCache<K> {
  private readonly map = new Map<K, CacheEntry>();
  private totalCost = 0;
  constructor(private readonly maxCost: number) {}

  get(key: K): HighlightToken[][] | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: HighlightToken[][], cost: number): void {
    const existing = this.map.get(key);
    if (existing) {
      this.totalCost -= existing.cost;
      this.map.delete(key);
    }
    this.map.set(key, { value, cost });
    this.totalCost += cost;
    while (this.totalCost > this.maxCost) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      this.totalCost -= evicted?.cost ?? 0;
    }
  }

  /** Test seam: current budget consumption in source characters. */
  get size(): number {
    return this.totalCost;
  }
}

const tokenizationCache = new SizedLRUCache<string>(TOKENIZATION_CACHE_MAX_CHARS);

// Tokenize `code` to per-line tokens, cached. Returns null when the language is
// unsupported, the input is over the size cap, or parsing throws — callers then
// render plain text.
export function tokenizeToLines(
  code: string,
  ext: string | null,
  options?: { cache?: boolean },
): HighlightToken[][] | null {
  if (!ext) return null;
  if (code.length > MAX_HIGHLIGHT_CHARS) return null;
  const shouldCache = options?.cache ?? true;
  const cacheKey = `${ext}:${code}`;
  if (shouldCache) {
    const cached = tokenizationCache.get(cacheKey);
    if (cached) return cached;
  }
  let lines: HighlightToken[][];
  try {
    lines = highlightCode(code, `x.${ext}`);
  } catch {
    return null;
  }
  // The key holds a full copy of the source, so charge both to the budget.
  if (shouldCache) tokenizationCache.set(cacheKey, lines, code.length * 2);
  return lines;
}

function toKeyedLine(tokens: HighlightToken[], lineIndex: number): KeyedLine {
  return {
    key: `line-${lineIndex}`,
    tokens: tokens.map((token, tokenIndex) => ({
      key: `${lineIndex}-${tokenIndex}`,
      token,
    })),
  };
}

export function highlightToKeyedLines(code: string, ext: string | null): KeyedLine[] | null {
  const lines = tokenizeToLines(code, ext);
  return lines ? lines.map(toKeyedLine) : null;
}

// Extension for grammar selection from a file path. We only need the suffix —
// absolute vs relative paths are equivalent here.
export function extensionFromPath(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}
