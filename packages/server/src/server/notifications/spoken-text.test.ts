import { describe, expect, it } from "vitest";
import { SPOKEN_NOTIFICATION_MAX_CHARS, composeSpokenNotificationText } from "./spoken-text.js";

describe("composeSpokenNotificationText", () => {
  it("names the agent and workspace and reads the finished gist without markdown", () => {
    const text = composeSpokenNotificationText({
      reason: "finished",
      agentTitle: "Fix login bug",
      workspaceName: "webapp",
      assistantMessage: "**Done**. Updated `auth.ts` and [the docs](https://example.com/docs).",
    });
    expect(text).toBe("Fix login bug in webapp finished. Done. Updated auth.ts and the docs.");
  });

  it("falls back to a generic subject and lead when nothing else is known", () => {
    expect(
      composeSpokenNotificationText({ reason: "finished", agentTitle: null, workspaceName: null }),
    ).toBe("An agent finished.");
    expect(
      composeSpokenNotificationText({ reason: "error", agentTitle: null, workspaceName: "api" }),
    ).toBe("The agent in api hit an error.");
  });

  it("distinguishes questions, plans, and tool permissions", () => {
    const base = { reason: "permission" as const, agentTitle: "Refactor", workspaceName: null };
    expect(
      composeSpokenNotificationText({
        ...base,
        permissionRequest: {
          id: "p1",
          provider: "claude",
          name: "AskUserQuestion",
          kind: "question",
          title: "Which database should I use?",
        },
      }),
    ).toBe("Refactor has a question. Which database should I use?");
    expect(
      composeSpokenNotificationText({
        ...base,
        permissionRequest: { id: "p2", provider: "claude", name: "ExitPlanMode", kind: "plan" },
      }),
    ).toBe("Refactor wants you to review a plan. ExitPlanMode");
    expect(
      composeSpokenNotificationText({
        ...base,
        permissionRequest: {
          id: "p3",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          title: "Run npm test",
        },
      }),
    ).toBe("Refactor needs permission. Run npm test");
  });

  it("replaces bare URLs and caps the result at the spoken limit on a word boundary", () => {
    const longMessage = `See https://example.com/very/long/path for details. ${"Lorem ipsum dolor sit amet. ".repeat(20)}`;
    const text = composeSpokenNotificationText({
      reason: "finished",
      agentTitle: "Docs",
      workspaceName: null,
      assistantMessage: longMessage,
    });
    expect(text.length).toBeLessThanOrEqual(SPOKEN_NOTIFICATION_MAX_CHARS);
    expect(text.startsWith("Docs finished. See a link for details.")).toBe(true);
    expect(text.endsWith(".")).toBe(true);
    expect(text).not.toContain("https://");
  });

  it("keeps the lead alone when the subject leaves no room for a gist", () => {
    const text = composeSpokenNotificationText({
      reason: "finished",
      agentTitle: "A".repeat(190),
      workspaceName: null,
      assistantMessage: "All tests pass.",
    });
    expect(text.length).toBeLessThanOrEqual(SPOKEN_NOTIFICATION_MAX_CHARS);
    expect(text).not.toContain("All tests pass");
  });
});
