import type { Command } from "commander";

const resolutionHelp =
  "\nHub origin precedence: command origin/--hub, FROGG_HUB_URL, active stored login. A Hub URL must be configured.\nCredential precedence: --api-key, FROGG_HUB_API_KEY, then a stored login for the exact resolved origin.\n";

export function addHubResolutionHelp(command: Command): Command {
  return command.addHelpText("after", resolutionHelp);
}
