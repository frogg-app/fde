import type { Command } from "commander";

import type { CommandOptions, OutputSchema, SingleResult } from "../../../output/index.js";
import { installLoginService, uninstallLoginService, type ServiceActionResult } from "./install.js";

/**
 * `fde daemon install-service` / `uninstall-service`: register the daemon with
 * the platform's login service manager so it comes back after a reboot. The
 * same code runs from onboarding's "start FDE when you log in?" question.
 */
function renderHuman(result: ServiceActionResult): string {
  const lines = [result.message];
  if (result.file) lines.push(`Service file: ${result.file}`);
  if (result.action === "installed") {
    lines.push(`Listen:       ${result.listen}`);
    if (result.home) lines.push(`FDE home:     ${result.home}`);
    lines.push(`Command:      ${result.command}`);
  }
  for (const hint of result.hints) lines.push(hint);
  return lines.join("\n");
}

const serviceResultSchema: OutputSchema<ServiceActionResult> = {
  idField: "action",
  columns: [
    { header: "STATUS", field: "action", color: () => "green" },
    { header: "SERVICE", field: "label" },
    { header: "FILE", field: (result) => result.file ?? "-" },
  ],
  renderHuman: (result) => (result.type === "single" ? renderHuman(result.data) : ""),
};

function readOptions(options: CommandOptions): { listen?: string; home?: string } {
  return {
    listen: typeof options.listen === "string" ? options.listen : undefined,
    home: typeof options.home === "string" ? options.home : undefined,
  };
}

export async function runInstallServiceCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ServiceActionResult>> {
  return {
    type: "single",
    data: installLoginService(readOptions(options)),
    schema: serviceResultSchema,
  };
}

export async function runUninstallServiceCommand(
  options: CommandOptions,
  _command: Command,
): Promise<SingleResult<ServiceActionResult>> {
  return {
    type: "single",
    data: uninstallLoginService(readOptions(options)),
    schema: serviceResultSchema,
  };
}
