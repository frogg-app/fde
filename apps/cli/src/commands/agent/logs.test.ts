import { describe, expect, it } from "vitest";
import { formatAgentActivityTranscript, NO_ACTIVITY_MESSAGE } from "./logs.js";

describe("formatAgentActivityTranscript", () => {
  it("leaves out plugin timeline items sent by older daemons", () => {
    const plugin = {
      type: "plugin" as const,
      id: "review-1",
      pluginId: "review",
      kind: "review",
      version: 1,
      data: { status: "running" },
    };

    expect(formatAgentActivityTranscript([plugin])).toBe(NO_ACTIVITY_MESSAGE);
    const transcript = formatAgentActivityTranscript([
      { type: "assistant_message", text: "Finished the review" },
      plugin,
    ]);
    expect(transcript).toContain("Finished the review");
    expect(transcript).not.toContain("review-1");
  });
});
