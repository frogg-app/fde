import type { Command } from "commander";

/**
 * Splits `fde --help` into "Commands" and "Command groups".
 *
 * A flat list mixes verbs you type directly (`fde start`) with namespaces you
 * have to drill into (`fde agent ...`), which reads as one long menu of
 * unrelated things. Commander 12 has no help grouping - `.helpGroup()` arrived
 * in v14 - so groups are registered hidden and rendered in their own section.
 */
export interface CommandGroup {
  name: string;
  description: string;
  count: number;
}

const GROUPS_HEADING = "Command groups:";

export function addCommandGroup(program: Command, group: Command): Command {
  // Hidden only from commander's own listing; it still parses and still shows
  // its own --help.
  program.addCommand(group, { hidden: true });
  return program;
}

export function collectCommandGroups(groups: readonly Command[]): CommandGroup[] {
  return groups.map((group) => ({
    name: [group.name(), ...group.aliases()].join("|"),
    description: group.description(),
    count: group.commands.filter((command) => command.name() !== "help").length,
  }));
}

export function renderCommandGroups(groups: readonly CommandGroup[], indent = "  "): string {
  if (groups.length === 0) return "";
  const width = Math.max(...groups.map((group) => group.name.length));
  const lines = groups.map(
    (group) => `${indent}${group.name.padEnd(width + 2)}${group.description}`,
  );
  return [`\n${GROUPS_HEADING}`, ...lines].join("\n");
}

/** Appends the groups section to `program`'s help output. */
export function addCommandGroupsHelp(program: Command, groups: readonly Command[]): void {
  program.addHelpText("after", () => renderCommandGroups(collectCommandGroups(groups)));
}
