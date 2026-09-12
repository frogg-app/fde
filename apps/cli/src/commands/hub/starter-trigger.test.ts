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
              repositories: ["frogg-app/fde"],
            },
          ],
          slack: [{ teamId: "T123", teamName: "Fde" }],
          discord: [{ guildId: "456", guildName: "Fde Discord" }],
        },
        "frogg-app/fde",
      ),
    ).toEqual([
      {
        id: "github:frogg-app/fde",
        label: "GitHub — frogg-app/fde",
        provider: "github",
        filters: { repo: "frogg-app/fde" },
      },
      {
        id: "slack:T123",
        label: "Slack — Fde",
        provider: "slack",
        filters: { workspace: "T123" },
      },
      {
        id: "discord:456",
        label: "Discord — Fde Discord",
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
        "frogg-app/fde",
      ),
    ).toEqual([]);
  });
});
