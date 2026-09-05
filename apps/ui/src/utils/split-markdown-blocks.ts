import MarkdownIt from "markdown-it";

const markdownBlockParser = new MarkdownIt();

/** A block together with the half-open source range it was cut from. */
export interface MarkdownBlockRange {
  text: string;
  start: number;
  end: number;
}

/**
 * Split `text` into renderable blocks, keeping each block's source range.
 *
 * The range matters for streaming: a caller painting a paced prefix of a message
 * can split the whole text once and then clip the blocks to however much is
 * revealed, instead of re-splitting a longer prefix on every animation frame.
 * `text.slice(start, end)` always reproduces `text` for a returned block.
 */
export function splitMarkdownBlocksWithRanges(text: string): MarkdownBlockRange[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: MarkdownBlockRange[] = [];
  const lines = text.split("\n");
  const structuralBlankLines = getStructuralBlankLines(text, lines);

  // Offset of the first character of each line, so a run of consecutive lines
  // maps back to a slice of the original text.
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1; // + the "\n" that split consumed
  }

  // A block is always a run of consecutive lines: the only lines dropped are
  // non-structural blanks, and the first of those arms the separator so the next
  // non-blank line starts a fresh block.
  let firstLine = -1;
  let lastLine = -1;
  let sawBlockSeparator = false;

  const flush = () => {
    if (firstLine < 0) {
      return;
    }
    const start = lineStarts[firstLine] ?? 0;
    const end = (lineStarts[lastLine] ?? 0) + (lines[lastLine]?.length ?? 0);
    if (end > start) {
      blocks.push({ text: text.slice(start, end), start, end });
    }
    firstLine = -1;
    lastLine = -1;
  };

  for (const [index, line] of lines.entries()) {
    const isBlankLine = line.trim().length === 0;

    if (isBlankLine && structuralBlankLines.has(index)) {
      if (firstLine < 0) {
        firstLine = index;
      }
      lastLine = index;
      continue;
    }

    if (isBlankLine) {
      if (firstLine >= 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (sawBlockSeparator) {
      flush();
      sawBlockSeparator = false;
    }

    if (firstLine < 0) {
      firstLine = index;
    }
    lastLine = index;
  }

  flush();

  return blocks;
}

export function splitMarkdownBlocks(text: string): string[] {
  return splitMarkdownBlocksWithRanges(text).map((block) => block.text);
}

/**
 * Clip pre-split blocks to a revealed prefix length.
 *
 * Equivalent to splitting the prefix directly, but without re-parsing: blocks
 * past the reveal point are dropped and the straddling block is cut short.
 */
export function clipMarkdownBlocksToLength(
  blocks: readonly MarkdownBlockRange[],
  revealedLength: number,
): string[] {
  const clipped: string[] = [];
  for (const block of blocks) {
    if (block.start >= revealedLength) {
      break;
    }
    if (block.end <= revealedLength) {
      clipped.push(block.text);
      continue;
    }
    // Splitting the prefix directly would never end a block on a blank line, so
    // drop any the cut exposed. Trailing spaces on a *content* line are kept, as
    // they would be there.
    const partial = block.text.slice(0, revealedLength - block.start).replace(/(?:\n[ \t]*)+$/, "");
    if (partial.trim().length > 0) {
      clipped.push(partial);
    }
    break;
  }
  return clipped;
}

function getStructuralBlankLines(text: string, lines: string[]): Set<number> {
  const blankLines = new Set<number>();
  for (const token of markdownBlockParser.parse(text, {})) {
    if (token.level !== 0 || !token.map) {
      continue;
    }
    const [start, end] = token.map;
    for (let index = start; index < end - 1; index += 1) {
      if (lines[index]?.trim().length === 0) {
        blankLines.add(index);
      }
    }
  }
  return blankLines;
}
