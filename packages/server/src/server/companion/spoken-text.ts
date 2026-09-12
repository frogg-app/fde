/** Keep pronunciation free of presentation syntax without changing code or numbers. */
export function toSpokenText(text: string): string {
  return text
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/!?\[([^\]]+)\]\([^\s)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+(?=\S)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
