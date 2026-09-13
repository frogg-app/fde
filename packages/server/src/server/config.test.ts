import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig, resolveBundledWebUiDistDir, resolveConfigFromPersisted } from "./config.js";
import { loadPersistedConfig } from "./persisted-config.js";

const roots: string[] = [];

describe("server config", () => {
  test.each([
    [{}, {}, {}, "0.0.0.0:9999"],
    [{}, { PORT: "8123" }, {}, "0.0.0.0:8123"],
    [{ daemon: { listen: "127.0.0.1:7001" } }, {}, {}, "127.0.0.1:7001"],
    [{ daemon: { listen: "127.0.0.1:7001" } }, { FROGG_LISTEN: "[::1]:7002" }, {}, "[::1]:7002"],
    [
      { daemon: { listen: "127.0.0.1:7001" } },
      { FROGG_LISTEN: "[::1]:7002" },
      { listen: "/tmp/frogg.sock" },
      "/tmp/frogg.sock",
    ],
  ])(
    "resolves listen precedence for persisted %j env %j cli %j",
    async (persisted, env, cli, expected) => {
      const home = await mkdtemp(path.join(os.tmpdir(), "frogg-listen-config-"));
      roots.push(home);
      await writeFile(path.join(home, "config.json"), JSON.stringify(persisted));
      expect(loadConfig(home, { env, cli }).listen).toBe(expected);
    },
  );

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("records when the daemon is managed by Frogg Desktop", async () => {
    const froggHome = await mkdtemp(path.join(os.tmpdir(), "frogg-config-desktop-managed-"));
    roots.push(froggHome);

    const desktopConfig = loadConfig(froggHome, {
      env: { FROGG_DESKTOP_MANAGED: "1" },
    });
    const standaloneConfig = loadConfig(froggHome, { env: {} });

    expect(desktopConfig.desktopManaged).toBe(true);
    expect(standaloneConfig.desktopManaged).toBe(false);
  });

  test("loads the provider catalog refresh timeout", async () => {
    const froggHome = await mkdtemp(path.join(os.tmpdir(), "frogg-config-provider-timeout-"));
    roots.push(froggHome);
    await writeFile(
      path.join(froggHome, "config.json"),
      JSON.stringify({ agents: { catalogRefreshTimeoutMs: 180_000 } }),
    );

    const config = loadConfig(froggHome, { env: {} });

    expect(config.providerCatalogRefreshTimeoutMs).toBe(180_000);
  });

  test("resolves reload state from the supplied validated snapshot", async () => {
    const froggHome = await mkdtemp(path.join(os.tmpdir(), "frogg-config-snapshot-"));
    roots.push(froggHome);
    const snapshot = loadPersistedConfig(froggHome);
    await writeFile(
      path.join(froggHome, "config.json"),
      JSON.stringify({
        ...snapshot,
        daemon: { ...snapshot.daemon, browserTools: { enabled: true } },
      }),
    );

    expect(resolveConfigFromPersisted(froggHome, snapshot, { env: {} }).browserToolsEnabled).toBe(
      false,
    );
    expect(loadConfig(froggHome, { env: {} }).browserToolsEnabled).toBe(true);
  });

  test("records mutable and startup launch overrides by persisted leaf", async () => {
    const froggHome = await mkdtemp(path.join(os.tmpdir(), "frogg-config-overrides-"));
    roots.push(froggHome);
    const config = loadConfig(froggHome, {
      env: {
        FROGG_LISTEN: "127.0.0.1:7000",
        FROGG_PASSWORD: "secret",
        FROGG_RELAY_ENDPOINT: "relay.example.test:443",
        FROGG_TRUSTED_PROXIES: "true",
        FROGG_TRUST_LAN: "0",
        FROGG_WEB_UI_ENABLED: "true",
        FROGG_LOG_FILE_PATH: "custom.log",
        FROGG_VOICE_LLM_PROVIDER: "codex",
      },
      cli: { relayUseTls: false },
    });

    expect(config.configReload?.overrideControlledPaths).toEqual([
      "daemon.auth.password",
      "daemon.auth.trustLan",
      "daemon.listen",
      "daemon.relay.endpoint",
      "daemon.relay.useTls",
      "daemon.trustedProxies",
      "features.voiceMode.llm.provider",
      "features.webUi.enabled",
      "log.file.path",
    ]);
    expect(config.trustLan).toBe(false);
    expect(config.listen).toBe("127.0.0.1:7000");
    expect(config.trustedProxies).toBe(true);
    expect(config.log?.file?.path).toBe("custom.log");
    expect(config.voiceLlmProvider).toBe("codex");
  });

  test("trusts the LAN by default, honors daemon.auth.trustLan, and lets FROGG_TRUST_LAN win", async () => {
    const froggHome = await mkdtemp(path.join(os.tmpdir(), "frogg-config-trust-lan-"));
    roots.push(froggHome);

    expect(loadConfig(froggHome, { env: {} }).trustLan).toBe(true);

    await writeFile(
      path.join(froggHome, "config.json"),
      JSON.stringify({ version: 1, daemon: { auth: { trustLan: false } } }),
    );
    expect(loadConfig(froggHome, { env: {} }).trustLan).toBe(false);
    expect(loadConfig(froggHome, { env: { FROGG_TRUST_LAN: "1" } }).trustLan).toBe(true);
    expect(loadConfig(froggHome, { env: { FROGG_TRUST_LAN: "off" } }).trustLan).toBe(false);
    expect(
      loadConfig(froggHome, { env: { FROGG_TRUST_LAN: "1" } }).configReload
        ?.overrideControlledPaths,
    ).toEqual(["daemon.auth.trustLan"]);
    expect(loadConfig(froggHome, { env: {} }).configReload?.overrideControlledPaths).toEqual([]);
  });

  test.each([
    {
      name: "local speech providers",
      providers: { dictation: "local", voiceStt: "local", voiceTts: "local" },
      expected: [
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
    {
      name: "OpenAI speech providers",
      providers: { dictation: "openai", voiceStt: "openai", voiceTts: "openai" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
        "features.voiceMode.tts.voice",
      ],
    },
    {
      name: "mixed local and OpenAI speech providers",
      providers: { dictation: "local", voiceStt: "openai", voiceTts: "local" },
      expected: [
        "features.dictation.stt.confidenceThreshold",
        "features.dictation.stt.model",
        "features.voiceMode.stt.model",
        "features.voiceMode.tts.model",
      ],
    },
  ])("classifies speech overrides for $name", ({ providers, expected }) => {
    const config = resolveConfigFromPersisted(
      "/tmp/frogg-speech-override-classification",
      {
        version: 1,
        features: {
          dictation: { enabled: true, stt: { provider: providers.dictation } },
          voiceMode: {
            enabled: true,
            stt: { provider: providers.voiceStt },
            tts: { provider: providers.voiceTts },
          },
        },
      },
      {
        env: {
          OPENAI_API_KEY: "test-api-key",
          FROGG_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          FROGG_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
          FROGG_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
          STT_CONFIDENCE_THRESHOLD: "0.5",
          STT_MODEL: "whisper-1",
          TTS_MODEL: "tts-1",
          TTS_VOICE: "alloy",
        },
      },
    );

    expect(config.configReload?.overrideControlledPaths).toEqual(expected);
  });

  test("resolves bundled web UI path from source-tree modules", () => {
    const root = path.parse(process.cwd()).root;
    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(root, "repo", "packages", "server", "src", "server", "config.ts"),
        ),
      }),
    ).toBe(path.join(root, "repo", "packages", "server", "dist", "server", "web-ui"));
  });

  test("resolves bundled web UI path from globally installed compiled modules", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "frogg-config-compiled-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "dist", "server", "web-ui"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(path.join(packageRoot, "dist", "server", "server", "config.js")),
      }),
    ).toBe(path.join(packageRoot, "dist", "server", "web-ui"));
  });

  test("resolves packaged desktop web UI path from resources app-dist", async () => {
    const packageRoot = await mkdtemp(path.join(os.tmpdir(), "frogg-config-packaged-"));
    roots.push(packageRoot);
    await mkdir(path.join(packageRoot, "app-dist"), { recursive: true });

    expect(
      resolveBundledWebUiDistDir({
        moduleUrl: pathToFileURL(
          path.join(
            packageRoot,
            "app.asar",
            "node_modules",
            "@frogg",
            "server",
            "dist",
            "server",
            "server",
            "config.js",
          ),
        ),
        resourcesPath: packageRoot,
      }),
    ).toBe(path.join(packageRoot, "app-dist"));
  });
});
