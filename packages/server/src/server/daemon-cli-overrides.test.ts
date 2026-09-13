import { describe, expect, test } from "vitest";
import { resolveConfigFromPersisted } from "./config.js";
import { parseDaemonCliOverrides } from "./daemon-cli-overrides.js";

describe("daemon startup flag overrides", () => {
  test("disables a saved relay before validation and retains the override on reload", () => {
    const persisted = { version: 1 as const, daemon: { relay: { enabled: true } } };
    const cli = parseDaemonCliOverrides(["--no-relay"]);
    const config = resolveConfigFromPersisted("/tmp/frogg-cli-overrides", persisted, {
      env: {},
      cli,
    });
    expect(config.relayEnabled).toBe(false);
    expect(config.relayEnabledMutable).toBe(false);
    expect(config.configReload?.overrideControlledPaths).toContain("daemon.relay.enabled");
    const reloaded = resolveConfigFromPersisted("/tmp/frogg-cli-overrides", persisted, {
      env: {},
      cli: config.configReload?.cli,
    });
    expect(reloaded.relayEnabled).toBe(false);
  });

  test("explicit relay enable without an endpoint resolves with relay inactive", () => {
    const config = resolveConfigFromPersisted(
      "/tmp/frogg-cli-overrides",
      { version: 1 },
      {
        env: {},
        cli: parseDaemonCliOverrides(["--relay"]),
      },
    );
    expect(config.relayEnabled).toBe(true);
    expect(config.relayEndpoint).toBe("");
  });

  test("keeps all supported flags and negative-flag precedence", () => {
    expect(
      parseDaemonCliOverrides([
        "--relay",
        "--no-relay",
        "--relay-use-tls",
        "--no-mcp",
        "--no-inject-mcp",
        "--web-ui",
        "--no-web-ui",
      ]),
    ).toEqual({
      relayEnabled: false,
      relayUseTls: true,
      mcpEnabled: false,
      mcpInjectIntoAgents: false,
      webUiEnabled: false,
    });
    expect(parseDaemonCliOverrides([])).toEqual({});
  });
});
