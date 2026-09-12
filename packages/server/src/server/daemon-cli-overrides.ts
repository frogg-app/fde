import type { loadConfig } from "./config.js";

export function applyCliFlagOverrides(config: ReturnType<typeof loadConfig>): void {
  const configReload = config.configReload;
  if (!configReload) throw new Error("Loaded daemon config is missing reload metadata");
  const cli = (configReload.cli ??= {});
  const override = (configPath: string) => {
    if (!configReload.overrideControlledPaths.includes(configPath)) {
      configReload.overrideControlledPaths.push(configPath);
    }
  };
  if (process.argv.includes("--relay")) {
    config.relayEnabled = true;
    config.relayEnabledMutable = false;
    cli.relayEnabled = true;
    override("daemon.relay.enabled");
  }
  if (process.argv.includes("--no-relay")) {
    config.relayEnabled = false;
    config.relayEnabledMutable = false;
    cli.relayEnabled = false;
    override("daemon.relay.enabled");
  }
  if (process.argv.includes("--relay-use-tls")) {
    config.relayUseTls = true;
    cli.relayUseTls = true;
    override("daemon.relay.useTls");
  }
  if (process.argv.includes("--no-mcp")) {
    config.mcpEnabled = false;
    cli.mcpEnabled = false;
    override("daemon.mcp.enabled");
  }
  if (process.argv.includes("--no-inject-mcp")) {
    config.mcpInjectIntoAgents = false;
    cli.mcpInjectIntoAgents = false;
    override("daemon.mcp.injectIntoAgents");
  }
  if (process.argv.includes("--web-ui")) {
    config.webUi = { ...(config.webUi ?? { distDir: null }), enabled: true };
    cli.webUiEnabled = true;
    override("features.webUi.enabled");
  }
  if (process.argv.includes("--no-web-ui")) {
    config.webUi = { ...(config.webUi ?? { distDir: null }), enabled: false };
    cli.webUiEnabled = false;
    override("features.webUi.enabled");
  }
}
