import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveConfigFromPersisted } from "./config.js";

const roots: string[] = [];

async function createFdeHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fde-config-relay-"));
  roots.push(root);
  const fdeHome = path.join(root, ".fde");
  await mkdir(fdeHome, { recursive: true });
  await writeFile(path.join(fdeHome, "config.json"), JSON.stringify(config, null, 2));
  return fdeHome;
}

describe("daemon relay config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("starts locally when relay has no configured endpoint", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: {} } });
    expect(loadConfig(home, { env: {} }).relayEnabled).toBe(false);
  });

  test("loads an enabled self-hosted relay with an explicit endpoint", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { enabled: true, endpoint: "relay.example.invalid:443", useTls: true } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayEnabled).toBe(true);
    expect(config.relayEndpoint).toBe("relay.example.invalid:443");
    expect(config.relayUseTls).toBe(true);
  });

  test("accepts a relay opt-in without an endpoint and leaves the endpoint empty", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: { enabled: true } } });
    const config = loadConfig(home, { env: {} });
    expect(config.relayEnabled).toBe(true);
    expect(config.relayEndpoint).toBe("");
    expect(config.relayEndpointMutable).toBe(true);
    expect(() => loadConfig(home, { env: { FDE_RELAY_ENABLED: "true" } })).not.toThrow();
  });

  test("defaults relay TLS on for a configured endpoint unless explicitly disabled", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { enabled: true, endpoint: "relay.example.invalid:8080" } },
    });
    expect(loadConfig(home, { env: {} }).relayUseTls).toBe(true);
    expect(loadConfig(home, { env: { FDE_RELAY_USE_TLS: "false" } }).relayUseTls).toBe(false);
  });

  test("marks the endpoint immutable under an endpoint launch override", async () => {
    const home = await createFdeHome({ version: 1 });
    const config = loadConfig(home, { env: { FDE_RELAY_ENDPOINT: "relay.example.invalid:443" } });
    expect(config.relayEndpoint).toBe("relay.example.invalid:443");
    expect(config.relayEndpointMutable).toBe(false);
  });

  test("keeps explicit persisted relay state and marks it mutable", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { enabled: false } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayEnabled).toBe(false);
    expect(config.relayEnabledMutable).toBe(true);
  });

  test("removing enabled from a modern config keeps relay disabled", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { enabled: false } },
    });
    const startup = loadConfig(home, { env: {} });
    const reloaded = resolveConfigFromPersisted(
      home,
      { version: 1, daemon: { relay: {} } },
      {
        env: startup.configReload?.env,
        relayEnabledFallback: startup.configReload?.relayEnabledFallback,
      },
    );

    expect(reloaded.relayEnabled).toBe(false);
  });

  test("keeps an unconfigured relay disabled across reloads", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: {} } });
    const startup = loadConfig(home, { env: {} });
    const reloaded = resolveConfigFromPersisted(
      home,
      { version: 1, daemon: { relay: {} } },
      {
        env: startup.configReload?.env,
        relayEnabledFallback: startup.configReload?.relayEnabledFallback,
      },
    );

    expect(reloaded.relayEnabled).toBe(false);
  });

  test("marks environment relay overrides immutable", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { enabled: false } },
    });
    const config = loadConfig(home, {
      env: { FDE_RELAY_ENABLED: "true", FDE_RELAY_ENDPOINT: "relay.example.invalid:443" },
    });
    expect(config.relayEnabled).toBe(true);
    expect(config.relayEnabledMutable).toBe(false);
  });

  test.each(["", "treu"])(
    "ignores invalid relay override %j without locking config",
    async (value) => {
      const home = await createFdeHome({
        version: 1,
        daemon: { relay: { enabled: false } },
      });
      const config = loadConfig(home, { env: { FDE_RELAY_ENABLED: value } });
      expect(config.relayEnabled).toBe(false);
      expect(config.relayEnabledMutable).toBe(true);
    },
  );

  test("loads relay TLS from env, persisted config, and the TLS default", async () => {
    const persistedHome = await createFdeHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: true,
        },
      },
    });
    expect(loadConfig(persistedHome, { env: {} }).relayUseTls).toBe(true);

    const envHome = await createFdeHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: false,
        },
      },
    });
    expect(loadConfig(envHome, { env: { FDE_RELAY_USE_TLS: "true" } }).relayUseTls).toBe(true);

    const hostedHome = await createFdeHome({
      version: 1,
      daemon: { relay: {} },
    });
    expect(loadConfig(hostedHome, { env: {} }).relayUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when unset", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: {} } });
    // Both sides share the TLS default, even while relay is disabled.
    expect(loadConfig(home, { env: {} }).relayPublicUseTls).toBe(true);
  });

  test("FDE_RELAY_PUBLIC_USE_TLS overrides relayUseTls for public side", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, {
      env: { FDE_RELAY_USE_TLS: "false", FDE_RELAY_PUBLIC_USE_TLS: "true" },
    });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when only FDE_RELAY_USE_TLS is set", async () => {
    const home = await createFdeHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, { env: { FDE_RELAY_USE_TLS: "false" } });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(false);
  });

  test("persisted publicUseTls overrides relayUseTls fallback", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { relay: { useTls: false, publicUseTls: true } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });
});

describe("daemon service proxy config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads public base URL from env before persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: {
        serviceProxy: {
          publicBaseUrl: "https://persisted.example.com",
        },
      },
    });

    const config = loadConfig(home, {
      env: { FDE_SERVICE_PROXY_PUBLIC_BASE_URL: "https://env.example.com/" },
    });

    expect(config.serviceProxy).toEqual({
      publicBaseUrl: "https://env.example.com",
      standaloneListen: null,
    });
  });

  test("does not synthesize a standalone service listener from enabled true", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: { serviceProxy: { enabled: true } },
    });

    expect(loadConfig(home, { env: {} }).serviceProxy).toEqual({
      publicBaseUrl: null,
      standaloneListen: null,
    });
  });

  test("enabled false suppresses optional service proxy layers only", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: {
        serviceProxy: {
          enabled: false,
          listen: "127.0.0.1:9999",
          publicBaseUrl: "https://persisted.example.com",
        },
      },
    });

    expect(loadConfig(home, { env: {} }).serviceProxy).toEqual({
      publicBaseUrl: null,
      standaloneListen: null,
    });
  });

  test("rejects invalid FDE_SERVICE_PROXY_PUBLIC_BASE_URL values", async () => {
    const home = await createFdeHome({ version: 1 });

    expect(() =>
      loadConfig(home, {
        env: { FDE_SERVICE_PROXY_PUBLIC_BASE_URL: "not-a-url" },
      }),
    ).toThrow("Invalid FDE_SERVICE_PROXY_PUBLIC_BASE_URL: not-a-url");
  });
});

describe("daemon trusted proxy config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("trusts loopback proxies by default", async () => {
    const home = await createFdeHome({ version: 1 });

    expect(loadConfig(home, { env: {} }).trustedProxies).toEqual(["loopback"]);
  });

  test("loads trusted proxies from persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: {
        trustedProxies: ["loopback", "10.0.0.0/8"],
      },
    });

    expect(loadConfig(home, { env: {} }).trustedProxies).toEqual(["loopback", "10.0.0.0/8"]);
  });

  test("FDE_TRUSTED_PROXIES overrides persisted config", async () => {
    const home = await createFdeHome({
      version: 1,
      daemon: {
        trustedProxies: ["loopback"],
      },
    });

    const config = loadConfig(home, {
      env: { FDE_TRUSTED_PROXIES: "loopback,172.16.0.0/12" },
    });

    expect(config.trustedProxies).toEqual(["loopback", "172.16.0.0/12"]);
  });

  test("FDE_TRUSTED_PROXIES supports explicit trust-all and trust-none modes", async () => {
    const trustAllHome = await createFdeHome({ version: 1 });
    expect(loadConfig(trustAllHome, { env: { FDE_TRUSTED_PROXIES: "true" } }).trustedProxies).toBe(
      true,
    );

    const trustNoneHome = await createFdeHome({ version: 1 });
    expect(
      loadConfig(trustNoneHome, { env: { FDE_TRUSTED_PROXIES: "false" } }).trustedProxies,
    ).toEqual([]);
  });
});

describe("daemon worktree root config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("resolves relative worktrees.root against FDE_HOME", async () => {
    const home = await createFdeHome({
      version: 1,
      worktrees: { root: "custom-worktrees" },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(path.join(home, "custom-worktrees"));
  });

  test("keeps absolute worktrees.root absolute", async () => {
    const home = await createFdeHome({
      version: 1,
      worktrees: { root: path.join(os.tmpdir(), "fde-custom-worktrees") },
    });

    expect(loadConfig(home, { env: {} }).worktreesRoot).toBe(
      path.join(os.tmpdir(), "fde-custom-worktrees"),
    );
  });
});
