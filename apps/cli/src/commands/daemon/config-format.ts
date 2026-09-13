import type { Command } from "commander";
import { formatPersistedConfig } from "@frogg/server";
import type { CommandOptions, OutputSchema, SingleResult } from "../../output/index.js";
import { resolveLocalFroggHome } from "./local-daemon.js";

interface ConfigFormatResult {
  configPath: string;
}

const schema: OutputSchema<ConfigFormatResult> = {
  idField: "configPath",
  columns: [],
  renderHuman(result) {
    return result.type === "single" ? `Formatted ${result.data.configPath}` : "";
  },
};

export async function runConfigFormatCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ConfigFormatResult>> {
  const home = resolveLocalFroggHome(typeof options.home === "string" ? options.home : undefined);
  return { type: "single", data: { configPath: formatPersistedConfig(home) }, schema };
}
