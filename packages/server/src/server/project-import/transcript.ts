import { createHash } from "node:crypto";

export interface ImportedTranscript {
  id: string;
  provider: "claude" | "codex";
  nativeSessionId: string | null;
  title: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
}

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 50000;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const block = object(part);
      return block &&
        ["text", "input_text", "output_text"].includes(String(block.type)) &&
        typeof block.text === "string"
        ? [block.text]
        : [];
    })
    .join("\n");
}

function parseProviderRow(row: Record<string, unknown>): {
  provider: ImportedTranscript["provider"] | null;
  sessionId?: string;
  role?: unknown;
  text: string;
} {
  const payload = object(row.payload);
  const message = object(row.message);
  if (row.type === "session_meta" && payload && typeof payload.id === "string")
    return { provider: "codex", sessionId: payload.id, text: "" };
  if (row.type === "response_item" && payload?.type === "message")
    return { provider: "codex", role: payload.role, text: textContent(payload.content) };
  if (["user", "assistant"].includes(String(row.type)) && message)
    return {
      provider: "claude",
      sessionId: typeof row.sessionId === "string" ? row.sessionId : undefined,
      role: message.role ?? row.type,
      text: textContent(message.content),
    };
  return { provider: null, text: "" };
}

function parseRecord(line: string, index: number): Record<string, unknown> {
  let row: Record<string, unknown> | null;
  try {
    row = object(JSON.parse(line));
  } catch {
    throw new Error(`Invalid JSON at conversation line ${index + 1}`);
  }
  if (!row) throw new Error(`Invalid record at conversation line ${index + 1}`);
  return row;
}

function isConversationRole(role: unknown): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

function transcriptTitle(messages: ImportedTranscript["messages"]): string {
  return (messages.find((message) => message.role === "user")?.text ?? messages[0].text).slice(
    0,
    120,
  );
}

function transcriptIdentity(
  provider: string,
  nativeSessionId: string | null,
  messages: ImportedTranscript["messages"],
): string {
  return createHash("sha256")
    .update(JSON.stringify({ provider, source: nativeSessionId ?? messages }))
    .digest("hex");
}

/** Recognizes provider JSONL exports; never executes tools or trusts embedded paths. */
export function parseImportedTranscript(content: Buffer): ImportedTranscript {
  if (content.length > MAX_BYTES) throw new Error("Conversation exceeds the 16 MiB limit");
  const lines = content
    .toString("utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (!lines.length || lines.length > MAX_ROWS) throw new Error("Invalid conversation row count");
  let provider: ImportedTranscript["provider"] | null = null;
  let nativeSessionId: string | null = null;
  const messages: ImportedTranscript["messages"] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const row = parseRecord(line, index);
    const { provider: identified, sessionId, role, text } = parseProviderRow(row);
    if (sessionId) {
      if (nativeSessionId && nativeSessionId !== sessionId)
        throw new Error("A conversation file contains multiple sessions");
      nativeSessionId = sessionId;
    }
    if (identified) {
      if (provider && provider !== identified)
        throw new Error("Mixed provider conversation format");
      provider = identified;
    }
    if (isConversationRole(role) && text.trim()) {
      if (Buffer.byteLength(text) > 128 * 1024)
        throw new Error("A conversation message exceeds the 128 KiB text limit");
      const identity = typeof row.uuid === "string" ? row.uuid : null;
      if (identity && seen.has(identity)) continue;
      if (identity) seen.add(identity);
      messages.push({ role, text });
    }
  }
  if (!provider || !messages.length)
    throw new Error("Select a Claude or Codex JSONL conversation containing text messages");
  const digest = transcriptIdentity(provider, nativeSessionId, messages);
  return {
    id: digest,
    provider,
    nativeSessionId,
    title: transcriptTitle(messages),
    messages,
  };
}
