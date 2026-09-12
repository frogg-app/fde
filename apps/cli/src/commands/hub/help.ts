import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, FDE_HUB_URL, active stored login. A Hub URL must be configured.\nCredential precedence: --api-key, FDE_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
