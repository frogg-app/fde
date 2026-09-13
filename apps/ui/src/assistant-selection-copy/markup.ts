export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-frogg-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-frogg-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-frogg-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-frogg-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-frogg-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-frogg-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-frogg-markdown-align";

/**
 * Trailing line breaks, with any indentation that followed the last one.
 *
 * Both ways of copying code strip these, for the same reason: pasting a trailing
 * newline into a terminal runs the last line. A fence body always ends in one, and
 * ends in several when the author left blank lines before the closing fence; a
 * selection picks one up whenever it overshoots the end of a rendered line.
 */
export const TRAILING_CODE_LINE_BREAKS = /(\r?\n[ \t]*)+$/;

export const markdownCopyDataSet = {
  blockquote: { froggMarkdownTag: "blockquote" },
  br: { froggMarkdownTag: "br" },
  code: { froggMarkdownTag: "code" },
  h1: { froggMarkdownTag: "h1" },
  h2: { froggMarkdownTag: "h2" },
  h3: { froggMarkdownTag: "h3" },
  h4: { froggMarkdownTag: "h4" },
  h5: { froggMarkdownTag: "h5" },
  h6: { froggMarkdownTag: "h6" },
  hr: { froggMarkdownTag: "hr" },
  ignore: { froggMarkdownIgnore: "true" },
  li: { froggMarkdownTag: "li" },
  listMarker: { froggMarkdownIgnore: "true", froggMarkdownListMarker: "true" },
  ol: { froggMarkdownTag: "ol" },
  p: { froggMarkdownTag: "p" },
  pre: { froggMarkdownTag: "pre" },
  s: { froggMarkdownTag: "s" },
  strong: { froggMarkdownTag: "strong" },
  em: { froggMarkdownTag: "em" },
  table: { froggMarkdownTag: "table" },
  tbody: { froggMarkdownTag: "tbody" },
  td: { froggMarkdownTag: "td" },
  th: { froggMarkdownTag: "th" },
  thead: { froggMarkdownTag: "thead" },
  tr: { froggMarkdownTag: "tr" },
  ul: { froggMarkdownTag: "ul" },
  unwrap: { froggMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    froggMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { froggMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { froggMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
