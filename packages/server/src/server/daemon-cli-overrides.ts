import type { CliConfigOverrides } from "./config.js";

export function parseDaemonCliOverrides(argv: readonly string[]): CliConfigOverrides {
  const cli: CliConfigOverrides = {};
  if (argv.includes("--relay")) cli.relayEnabled = true;
  if (argv.includes("--no-relay")) cli.relayEnabled = false;
  if (argv.includes("--relay-use-tls")) cli.relayUseTls = true;
  if (argv.includes("--no-mcp")) cli.mcpEnabled = false;
  if (argv.includes("--no-inject-mcp")) cli.mcpInjectIntoAgents = false;
  if (argv.includes("--web-ui")) cli.webUiEnabled = true;
  if (argv.includes("--no-web-ui")) cli.webUiEnabled = false;
  return cli;
}
