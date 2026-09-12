import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveCompanionCapability } from "./capability.js";

const BACKEND_MISSING_REASON =
  "Sign in to Claude Code or Codex on this daemon. API usage requires explicitly selecting the API backend.";
const DISABLED_REASON = "The Companion is turned off on this daemon.";

function resolve(params: {
  env: NodeJS.ProcessEnv;
  persisted?: unknown;
  claudeCliAvailable?: boolean;
  localRuntimeAvailable?: boolean;
}) {
  return resolveCompanionCapability({
    env: params.env,
    persisted: PersistedConfigSchema.parse(params.persisted ?? {}),
    claudeCliAvailable: params.claudeCliAvailable ?? false,
    localRuntimeAvailable: params.localRuntimeAvailable ?? true,
  });
}

describe("resolveCompanionCapability", () => {
  test("is enabled with no reason when the flag defaults on and a key resolves", () => {
    expect(
      resolve({
        env: { FDE_COMPANION_BACKEND: "api", ANTHROPIC_API_KEY: "key" },
      }),
    ).toEqual({
      enabled: true,
      reason: "",
    });
  });

  test("is disabled only when neither an Anthropic key nor the Claude Code CLI is there", () => {
    expect(resolve({ env: {} })).toEqual({
      enabled: false,
      reason: BACKEND_MISSING_REASON,
    });
  });

  test("is enabled with no key when the Claude Code CLI can back it", () => {
    expect(resolve({ env: {}, claudeCliAvailable: true })).toEqual({
      enabled: true,
      reason: "",
    });
  });

  test("the voice umbrella turns the Companion off even when its own flag is on", () => {
    expect(
      resolve({
        env: {
          FDE_COMPANION_BACKEND: "api",
          ANTHROPIC_API_KEY: "key",
          FDE_VOICE: "0",
          FDE_COMPANION_ENABLED: "1",
        },
      }),
    ).toEqual({ enabled: false, reason: DISABLED_REASON });
  });

  test("the fine-grained flag wins over the umbrella", () => {
    expect(
      resolve({
        env: {
          FDE_COMPANION_BACKEND: "api",
          ANTHROPIC_API_KEY: "key",
          FDE_COMPANION_ENABLED: "0",
          FDE_VOICE: "1",
        },
      }),
    ).toEqual({ enabled: false, reason: DISABLED_REASON });
    expect(
      resolve({
        env: {
          FDE_COMPANION_BACKEND: "api",
          ANTHROPIC_API_KEY: "key",
          FDE_COMPANION_ENABLED: "1",
        },
        localRuntimeAvailable: false,
      }),
    ).toEqual({ enabled: true, reason: "" });
  });

  test("the env flag wins over the persisted flag", () => {
    expect(
      resolve({
        env: {
          FDE_COMPANION_BACKEND: "api",
          ANTHROPIC_API_KEY: "key",
          FDE_COMPANION_ENABLED: "0",
        },
        persisted: { features: { companion: { enabled: true } } },
      }),
    ).toEqual({ enabled: false, reason: DISABLED_REASON });
  });

  test("defaults on independently of local speech readiness", () => {
    expect(
      resolve({
        env: { FDE_COMPANION_BACKEND: "api", ANTHROPIC_API_KEY: "key" },
        localRuntimeAvailable: false,
      }),
    ).toEqual({
      enabled: true,
      reason: "",
    });
  });

  test("a disabled Companion reports the disabled reason ahead of the missing backend", () => {
    expect(resolve({ env: { FDE_COMPANION_ENABLED: "0" } })).toEqual({
      enabled: false,
      reason: DISABLED_REASON,
    });
  });
});
