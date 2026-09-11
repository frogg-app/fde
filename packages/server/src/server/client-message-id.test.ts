import { describe, expect, test } from "vitest";

import { normalizeClientMessageId, resolveClientMessageId } from "./client-message-id.js";

describe("normalizeClientMessageId", () => {
  test("returns undefined for missing, empty, and whitespace values", () => {
    expect(normalizeClientMessageId(undefined)).toBeUndefined();
    expect(normalizeClientMessageId("")).toBeUndefined();
    expect(normalizeClientMessageId("   ")).toBeUndefined();
  });

  test("returns trimmed clientMessageId for non-empty values", () => {
    expect(normalizeClientMessageId("client-msg-1")).toBe("client-msg-1");
    expect(normalizeClientMessageId("  client-msg-2  ")).toBe("client-msg-2");
  });
});

describe("resolveClientMessageId", () => {
  test("generates distinct UUID v4 message ids with the production Node crypto implementation", () => {
    const ids = Array.from({ length: 32 }, () => resolveClientMessageId(undefined));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  test("preserves a non-empty clientMessageId", () => {
    expect(resolveClientMessageId("client-msg-3", () => "generated-id")).toBe("client-msg-3");
  });

  test("falls back to generated id for empty/whitespace values", () => {
    expect(resolveClientMessageId("", () => "generated-empty")).toBe("generated-empty");
    expect(resolveClientMessageId("   ", () => "generated-space")).toBe("generated-space");
    expect(resolveClientMessageId(undefined, () => "generated-missing")).toBe("generated-missing");
  });
});
