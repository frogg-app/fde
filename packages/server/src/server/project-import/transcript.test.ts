import { describe, expect, it } from "vitest";
import { parseImportedTranscript } from "./transcript.js";
const encode = (...rows: unknown[]) =>
  Buffer.from(rows.map((row) => JSON.stringify(row)).join("\n"));

describe("imported conversation history", () => {
  it("reads Claude text without treating tool output as executable content", () => {
    const row = {
      type: "user",
      uuid: "u1",
      sessionId: "s1",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Fix the app" },
          { type: "tool_result", content: "ignored" },
        ],
      },
    };
    const parsed = parseImportedTranscript(
      encode(row, row, {
        type: "assistant",
        sessionId: "s1",
        message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
      }),
    );
    expect(parsed).toMatchObject({
      provider: "claude",
      nativeSessionId: "s1",
      title: "Fix the app",
      messages: [
        { role: "user", text: "Fix the app" },
        { role: "assistant", text: "Done" },
      ],
    });
  });
  it("reads Codex rollout response items without duplicating event messages", () => {
    const result = parseImportedTranscript(
      encode(
        { type: "session_meta", payload: { id: "s1" } },
        { type: "event_msg", payload: { type: "user_message", message: "Hello" } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }],
          },
        },
      ),
    );
    expect(result.messages).toEqual([{ role: "user", text: "Hello" }]);
    expect(result.provider).toBe("codex");
  });
  it("deduplicates equivalent exports independent of formatting and metadata", () => {
    const row = { type: "user", message: { content: "Hello" } };
    expect(parseImportedTranscript(encode(row)).id).toBe(
      parseImportedTranscript(encode({ ...row, timestamp: "today" })).id,
    );
  });
  it("rejects malformed, unsupported, oversized and mixed session input", () => {
    expect(() => parseImportedTranscript(Buffer.from("not json"))).toThrow("line 1");
    expect(() => parseImportedTranscript(encode({ message: "arbitrary json" }))).toThrow(
      "Claude or Codex",
    );
    expect(() => parseImportedTranscript(Buffer.alloc(16 * 1024 * 1024 + 1))).toThrow("16 MiB");
    expect(() =>
      parseImportedTranscript(
        encode(
          { type: "user", sessionId: "a", message: { content: "A" } },
          { type: "user", sessionId: "b", message: { content: "B" } },
        ),
      ),
    ).toThrow("multiple sessions");
  });
});
it("retains distinct provider sessions even when their text is identical", () => {
  const session = (id: string) =>
    encode({ type: "user", sessionId: id, message: { content: "Hello" } });
  expect(parseImportedTranscript(session("a")).id).not.toBe(
    parseImportedTranscript(session("b")).id,
  );
});
it("keeps stable provider identity when a newer export adds conversation messages", () => {
  const first = { type: "user", sessionId: "same", message: { content: "Hello" } };
  const next = { type: "assistant", sessionId: "same", message: { content: "Answer" } };
  expect(parseImportedTranscript(encode(first)).id).toBe(
    parseImportedTranscript(encode(first, next)).id,
  );
});
