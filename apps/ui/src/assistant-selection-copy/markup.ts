export const MARKDOWN_COPY_TAG_ATTRIBUTE = "data-fde-markdown-tag";
export const MARKDOWN_COPY_IGNORE_ATTRIBUTE = "data-fde-markdown-ignore";
export const MARKDOWN_COPY_LIST_MARKER_ATTRIBUTE = "data-fde-markdown-list-marker";
export const MARKDOWN_COPY_UNWRAP_ATTRIBUTE = "data-fde-markdown-unwrap";
export const MARKDOWN_COPY_LIST_START_ATTRIBUTE = "data-fde-markdown-list-start";
export const MARKDOWN_COPY_LANGUAGE_ATTRIBUTE = "data-fde-markdown-language";
export const MARKDOWN_COPY_ALIGN_ATTRIBUTE = "data-fde-markdown-align";

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
  blockquote: { fdeMarkdownTag: "blockquote" },
  br: { fdeMarkdownTag: "br" },
  code: { fdeMarkdownTag: "code" },
  h1: { fdeMarkdownTag: "h1" },
  h2: { fdeMarkdownTag: "h2" },
  h3: { fdeMarkdownTag: "h3" },
  h4: { fdeMarkdownTag: "h4" },
  h5: { fdeMarkdownTag: "h5" },
  h6: { fdeMarkdownTag: "h6" },
  hr: { fdeMarkdownTag: "hr" },
  ignore: { fdeMarkdownIgnore: "true" },
  li: { fdeMarkdownTag: "li" },
  listMarker: { fdeMarkdownIgnore: "true", fdeMarkdownListMarker: "true" },
  ol: { fdeMarkdownTag: "ol" },
  p: { fdeMarkdownTag: "p" },
  pre: { fdeMarkdownTag: "pre" },
  s: { fdeMarkdownTag: "s" },
  strong: { fdeMarkdownTag: "strong" },
  em: { fdeMarkdownTag: "em" },
  table: { fdeMarkdownTag: "table" },
  tbody: { fdeMarkdownTag: "tbody" },
  td: { fdeMarkdownTag: "td" },
  th: { fdeMarkdownTag: "th" },
  thead: { fdeMarkdownTag: "thead" },
  tr: { fdeMarkdownTag: "tr" },
  ul: { fdeMarkdownTag: "ul" },
  unwrap: { fdeMarkdownUnwrap: "true" },
} as const;

export type MarkdownCopyInlineTag = "br" | "code" | "em" | "s" | "strong";

export function markdownCopyOrderedListDataSet(start: unknown) {
  return {
    ...markdownCopyDataSet.ol,
    fdeMarkdownListStart: String(start ?? 1),
  } as const;
}

export function markdownCopyCodeBlockDataSet(language: string | null | undefined) {
  const fenceLanguage = language?.trim().split(/\s+/)[0];
  return {
    ...markdownCopyDataSet.pre,
    ...(fenceLanguage ? { fdeMarkdownLanguage: fenceLanguage } : {}),
  } as const;
}

export function markdownCopyTableCellDataSet(tag: "td" | "th", style: unknown) {
  const alignment =
    typeof style === "string"
      ? style.match(/(?:^|;)\s*text-align\s*:\s*(left|right|center)/i)?.[1]
      : null;
  return {
    ...markdownCopyDataSet[tag],
    ...(alignment ? { fdeMarkdownAlign: alignment.toLowerCase() } : {}),
  } as const;
}
