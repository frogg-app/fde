import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { DEFAULT_COMPANION_MODEL, resolveCompanionModelConfig } from "./model-config.js";

function resolve(env: NodeJS.ProcessEnv, persistedInput: unknown, claudeCliAvailable = false) {
  return resolveCompanionModelConfig({
    env,
    persisted: PersistedConfigSchema.parse(persistedInput),
    claudeCliAvailable,
  });
}

describe("resolveCompanionModelConfig", () => {
  test("is unavailable only when there is neither a key nor the Claude Code CLI", () => {
    expect(resolve({}, {})).toEqual({
      status: "unavailable",
      reasonCode: "companion_backend_missing",
      message:
        "The Companion needs an Anthropic API key or the Claude Code CLI. Set providers.anthropic.apiKey or ANTHROPIC_API_KEY, or install and sign in to Claude Code.",
    });
  });

  test("falls back to the CLI backend when no key resolves but Claude Code is installed", () => {
    expect(resolve({}, {}, true)).toEqual({
      status: "available",
      backend: "cli",
      model: DEFAULT_COMPANION_MODEL,
    });
  });

  test("prefers the faster API backend when a key resolves and the CLI is also there", () => {
    expect(resolve({ ANTHROPIC_API_KEY: "env-key" }, {}, true)).toEqual({
      status: "available",
      backend: "api",
      apiKey: "env-key",
      baseUrl: null,
      model: DEFAULT_COMPANION_MODEL,
    });
  });

  test("the CLI backend still takes the configured model override", () => {
    expect(resolve({ PASEO_COMPANION_MODEL: "env-model" }, {}, true)).toEqual({
      status: "available",
      backend: "cli",
      model: "env-model",
    });
  });

  test("prefers the config key over the environment", () => {
    const resolved = resolve(
      { ANTHROPIC_API_KEY: "env-key" },
      { providers: { anthropic: { apiKey: "config-key" } } },
    );
    expect(resolved).toEqual({
      status: "available",
      backend: "api",
      apiKey: "config-key",
      baseUrl: null,
      model: DEFAULT_COMPANION_MODEL,
    });
  });

  test("falls back to the environment key and base url", () => {
    expect(
      resolve({ ANTHROPIC_API_KEY: "env-key", ANTHROPIC_BASE_URL: "https://proxy.test" }, {}),
    ).toEqual({
      status: "available",
      backend: "api",
      apiKey: "env-key",
      baseUrl: "https://proxy.test",
      model: DEFAULT_COMPANION_MODEL,
    });
  });

  test("a whitespace-only env value does not shadow the config fallback", () => {
    expect(
      resolve(
        { ANTHROPIC_API_KEY: "   ", ANTHROPIC_BASE_URL: "  " },
        { providers: { anthropic: { apiKey: "config-key", baseUrl: "https://config.test" } } },
      ),
    ).toEqual({
      status: "available",
      backend: "api",
      apiKey: "config-key",
      baseUrl: "https://config.test",
      model: DEFAULT_COMPANION_MODEL,
    });
  });

  test("a whitespace-only env value leaves the key unresolved", () => {
    expect(resolve({ ANTHROPIC_API_KEY: " \t " }, {}).status).toBe("unavailable");
  });

  test("the default model id carries no date suffix", () => {
    expect(DEFAULT_COMPANION_MODEL).toBe("claude-haiku-4-5");
  });

  test("the config model wins over the env model, which wins over the default", () => {
    const configModel = resolve(
      { ANTHROPIC_API_KEY: "env-key", PASEO_COMPANION_MODEL: "env-model" },
      { features: { companion: { model: "config-model" } } },
    );
    expect(configModel).toMatchObject({ status: "available", model: "config-model" });

    const envModel = resolve(
      { ANTHROPIC_API_KEY: "env-key", PASEO_COMPANION_MODEL: "env-model" },
      {},
    );
    expect(envModel).toMatchObject({ status: "available", model: "env-model" });

    const envBlank = resolve({ ANTHROPIC_API_KEY: "env-key", PASEO_COMPANION_MODEL: "  " }, {});
    expect(envBlank).toMatchObject({ status: "available", model: DEFAULT_COMPANION_MODEL });
  });
});
