import { describe, expect, it } from "vitest";
import { availableStarterTriggerConnections } from "./starter-trigger.js";

describe("starter trigger connections", () => {
  it("returns only concrete connections that can back the generated workflow", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-frogg-app",
              accountLogin: "frogg-app",
              accountType: "Organization",
              repositories: ["frogg-app/frogg"],
            },
          ],
          slack: [{ teamId: "T123", teamName: "Frogg" }],
          discord: [{ guildId: "456", guildName: "Frogg Discord" }],
        },
        "frogg-app/frogg",
      ),
    ).toEqual([
      {
        id: "github:frogg-app/frogg",
        label: "GitHub — frogg-app/frogg",
        provider: "github",
        filters: { repo: "frogg-app/frogg" },
      },
      {
        id: "slack:T123",
        label: "Slack — Frogg",
        provider: "slack",
        filters: { workspace: "T123" },
      },
      {
        id: "discord:456",
        label: "Discord — Frogg Discord",
        provider: "discord",
        filters: { guild: "456" },
      },
    ]);
  });

  it("does not offer GitHub when the current repository is not connected", () => {
    expect(
      availableStarterTriggerConnections(
        {
          github: [
            {
              slug: "github-frogg-app",
              accountLogin: "frogg-app",
              accountType: "Organization",
              repositories: ["frogg-app/hub"],
            },
          ],
          slack: [],
          discord: [],
        },
        "frogg-app/frogg",
      ),
    ).toEqual([]);
  });
});
