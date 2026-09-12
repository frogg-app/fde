import { describe, expect, it } from "vitest";
import { CompanionConversationOptionsSchema, SessionInboundMessageSchema } from "./messages.js";

describe("Companion conversation options", () => {
  it("keeps starts from older clients valid", () => {
    const request = { type: "companion.session.start.request", requestId: "start" };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });
  it("carries project context while supplying quiet conversational defaults", () => {
    const conversation = CompanionConversationOptionsSchema.parse({
      workspaceId: "project",
      agentId: "worker",
    });
    expect(conversation).toEqual({
      workspaceId: "project",
      agentId: "worker",
      verbosity: "brief",
      updates: "important",
      acknowledgeTasks: false,
      pauseMs: 1400,
      interruptible: true,
    });
    const request = { type: "companion.session.start.request", requestId: "start", conversation };
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });
  it.each([0, -100, 999999, 900.5])(
    "rejects invalid silence duration %s at the wire boundary",
    (pauseMs) => {
      expect(CompanionConversationOptionsSchema.safeParse({ pauseMs }).success).toBe(false);
    },
  );
});
