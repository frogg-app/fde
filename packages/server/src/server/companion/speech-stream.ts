/**
 * Turns the orchestrator's token stream into speech while the model is still
 * generating.
 *
 * The whole feature lives or dies here. Waiting for the turn's `completed` event
 * before synthesising costs roughly a second of dead air, which reads as the
 * Companion not having heard you. So deltas are accumulated and cut at the first
 * sentence or clause boundary past `MIN_SEGMENT_CHARS`, and each cut is handed
 * to the sink immediately.
 */

/** Below this a segment is too short to be worth the round trip and sounds clipped. */
const MIN_SEGMENT_CHARS = 40;

/**
 * A clause-free run this long is never going to reach a boundary in time, so it
 * is cut at the last word instead of holding the listener in silence.
 */
const MAX_SEGMENT_CHARS = 220;

const SENTENCE_BOUNDARY = /[.!?…](?=["')\]]*(\s|$))/g;
const CLAUSE_BOUNDARY = /[,;:—–](?=\s|$)/g;

function findBoundary(buffer: string, pattern: RegExp, minChars: number): number | null {
  pattern.lastIndex = 0;
  for (const match of buffer.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (end >= minChars) {
      return end;
    }
  }
  return null;
}

function findWordCut(buffer: string): number | null {
  if (buffer.length <= MAX_SEGMENT_CHARS) {
    return null;
  }
  const space = buffer.lastIndexOf(" ", MAX_SEGMENT_CHARS);
  return space > MIN_SEGMENT_CHARS ? space : MAX_SEGMENT_CHARS;
}

export interface CompanionSpeakableCut {
  segment: string;
  rest: string;
}

/**
 * The first speakable segment in `buffer`, or null while it is still too short
 * or has no boundary yet. Exported because the cut points are the behaviour
 * worth testing directly.
 */
export function cutSpeakableSegment(buffer: string): CompanionSpeakableCut | null {
  const trimmedStart = buffer.replace(/^\s+/, "");
  if (trimmedStart.length < MIN_SEGMENT_CHARS) {
    return null;
  }

  const sentenceEnd = findBoundary(trimmedStart, SENTENCE_BOUNDARY, MIN_SEGMENT_CHARS);
  const clauseEnd = sentenceEnd ?? findBoundary(trimmedStart, CLAUSE_BOUNDARY, MIN_SEGMENT_CHARS);
  const cut = clauseEnd ?? findWordCut(trimmedStart);
  if (cut === null) {
    return null;
  }

  const segment = trimmedStart.slice(0, cut).trim();
  if (!segment) {
    return null;
  }
  return { segment, rest: trimmedStart.slice(cut) };
}

/** Where a cut segment goes. `TTSManager.generateAndWaitForPlayback` satisfies it. */
export interface CompanionSpeechSink {
  speak(text: string): Promise<void>;
}

export interface CompanionSpeechStreamOptions {
  sink: CompanionSpeechSink;
  /**
   * Fired as the first segment of a turn is queued, before the sink is called.
   * The stall guard cancels itself here.
   */
  onSpeaking: () => void;
  onError: (error: Error) => void;
  signal: AbortSignal;
}

export interface CompanionSpeechStream {
  /** Accept one text delta. Speaks as soon as a boundary is reachable. */
  push(text: string): void;
  /** End of generation: speak whatever is left, however short. */
  end(): void;
  /** Resolves once everything queued has finished playback, or the turn aborted. */
  idle(): Promise<void>;
}

export function createCompanionSpeechStream(
  options: CompanionSpeechStreamOptions,
): CompanionSpeechStream {
  let buffer = "";
  let spoke = false;
  let queue: Promise<void> = Promise.resolve();

  async function speakAfter(previous: Promise<void>, segment: string): Promise<void> {
    await previous;
    if (options.signal.aborted) {
      return;
    }
    try {
      await options.sink.speak(segment);
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function enqueue(segment: string): void {
    if (!spoke) {
      spoke = true;
      options.onSpeaking();
    }
    queue = speakAfter(queue, segment);
  }

  return {
    push(text) {
      if (options.signal.aborted) {
        return;
      }
      buffer += text;
      let cut = cutSpeakableSegment(buffer);
      while (cut) {
        buffer = cut.rest;
        enqueue(cut.segment);
        cut = cutSpeakableSegment(buffer);
      }
    },

    end() {
      const remainder = buffer.trim();
      buffer = "";
      if (remainder && !options.signal.aborted) {
        enqueue(remainder);
      }
    },

    async idle() {
      await queue;
    },
  };
}
