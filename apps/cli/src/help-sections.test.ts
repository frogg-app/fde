import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { collectCommandGroups, renderCommandGroups } from "./help-sections.js";

function group(name: string, description: string, subcommands: string[]): Command {
  const command = new Command(name).description(description);
  for (const sub of subcommands) command.command(sub);
  return command;
}

describe("command groups help section", () => {
  it("counts real subcommands, ignoring the generated help entry", () => {
    const agent = group("agent", "Manage agents", ["ls", "run"]);
    agent.command("help");
    expect(collectCommandGroups([agent])).toEqual([
      { name: "agent", description: "Manage agents", count: 2 },
    ]);
  });

  it("shows aliases so a renamed group is still findable", () => {
    const trigger = group("trigger", "External events", ["connect"]).alias("hub");
    expect(collectCommandGroups([trigger])[0].name).toBe("trigger|hub");
  });

  it("aligns descriptions to the widest name", () => {
    const rendered = renderCommandGroups([
      { name: "agent", description: "Manage agents", count: 2 },
      { name: "permissions|permit", description: "Manage permission requests", count: 3 },
    ]);
    const lines = rendered.split("\n").filter((line) => line.startsWith("  "));
    const descriptionColumn = lines.map((line) => line.indexOf("Manage"));
    expect(new Set(descriptionColumn).size).toBe(1);
    expect(rendered).toContain("Command groups:");
  });

  it("renders nothing when there are no groups", () => {
    expect(renderCommandGroups([])).toBe("");
  });
});
