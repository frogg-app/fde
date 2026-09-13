import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderCommand,
} from "../agent/provider-launch-config.js";
import type { PersistedConfig } from "../persisted-config.js";

export const DEFAULT_COMPANION_MODEL = "claude-haiku-4-5";

export const COMPANION_BACKEND_MISSING_REASON_CODE = "companion_backend_missing";

export interface CompanionModelInputs {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  /** Whether the Claude Code CLI is installed and can be launched. */
  claudeCliAvailable: boolean;
  codexCliAvailable?: boolean;
}

export interface CompanionApiModelConfig {
  status: "available";
  backend: "api";
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

export interface CompanionCliModelConfig {
  status: "available";
  backend: "cli";
  model: string;
}

export interface CompanionCodexModelConfig {
  status: "available";
  backend: "codex";
  model: string;
}

export interface CompanionModelUnavailable {
  status: "unavailable";
  reasonCode: typeof COMPANION_BACKEND_MISSING_REASON_CODE;
  message: string;
}

export type CompanionModelConfig =
  | CompanionApiModelConfig
  | CompanionCliModelConfig
  | CompanionCodexModelConfig
  | CompanionModelUnavailable;

// Empty/whitespace env vars (e.g. a copied .env.example with ANTHROPIC_API_KEY=)
// must not shadow a later fallback.
function firstDefined(values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    return trimmed;
  }
  return undefined;
}

export function resolveCompanionModel(inputs: CompanionModelInputs): string {
  const configured = firstDefined([
    inputs.persisted.features?.companion?.model,
    inputs.env.FDE_COMPANION_MODEL,
  ]);
  return configured ?? DEFAULT_COMPANION_MODEL;
}

/** Subscription authentication is the default; API billing requires an explicit selection. */
export function resolveCompanionModelConfig(inputs: CompanionModelInputs): CompanionModelConfig {
  const model = resolveCompanionModel(inputs);
  const anthropic = inputs.persisted.providers?.anthropic;
  const apiKey = firstDefined([anthropic?.apiKey, inputs.env.ANTHROPIC_API_KEY]);
  const selection =
    inputs.persisted.features?.companion?.backend ??
    inputs.env.FDE_COMPANION_BACKEND ??
    "subscription";
  if (selection === "api" && apiKey) {
    const baseUrl = firstDefined([anthropic?.baseUrl, inputs.env.ANTHROPIC_BASE_URL]);
    return { status: "available", backend: "api", apiKey, baseUrl: baseUrl ?? null, model };
  }
  if ((selection === "subscription" || selection === "claude") && inputs.claudeCliAvailable) {
    return { status: "available", backend: "cli", model };
  }
  if ((selection === "subscription" || selection === "codex") && inputs.codexCliAvailable) {
    return {
      status: "available",
      backend: "codex",
      model:
        firstDefined([
          inputs.persisted.features?.companion?.model,
          inputs.env.FDE_COMPANION_MODEL,
        ]) ?? "gpt-5.6-luna",
    };
  }
  return {
    status: "unavailable",
    reasonCode: COMPANION_BACKEND_MISSING_REASON_CODE,
    message:
      "Sign in to Claude Code or Codex on this daemon. API usage requires explicitly selecting the API backend.",
  };
}

/**
 * Probing for the CLI is async, so bootstrap resolves the inputs once here and
 * both the capability and the model config are answered from the same snapshot.
 */
export async function resolveCompanionModelInputs(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}): Promise<CompanionModelInputs> {
  const [claudeCliAvailable, codexCliAvailable] = await Promise.all([
    isClaudeCliAvailable(),
    checkProviderLaunchAvailable(await resolveProviderLaunch({ defaultBinary: "codex" })).then(
      (result) => result.available,
    ),
  ]);
  const [claudeSignedIn, codexSignedIn] = await Promise.all([
    claudeCliAvailable ? probeSubscription("claude") : false,
    codexCliAvailable ? probeSubscription("codex") : false,
  ]);
  return { ...params, claudeCliAvailable: claudeSignedIn, codexCliAvailable: codexSignedIn };
}

export async function isClaudeCliAvailable(commandConfig?: ProviderCommand): Promise<boolean> {
  const launch = await resolveProviderLaunch({
    ...(commandConfig ? { commandConfig } : {}),
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  return availability.available;
}

async function probeSubscription(provider: "claude" | "codex"): Promise<boolean> {
  try {
    const launch = await resolveProviderLaunch({ defaultBinary: provider });
    const result = await promisify(execFile)(
      launch.command,
      [
        ...launch.args,
        ...(provider === "claude" ? ["auth", "status", "--json"] : ["login", "status"]),
      ],
      {
        timeout: 5000,
        windowsHide: true,
        env: { ...process.env, ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined },
      },
    );
    if (provider === "codex") return /chatgpt/i.test(`${result.stdout} ${result.stderr}`);
    const auth: unknown = JSON.parse(result.stdout);
    return (
      typeof auth === "object" &&
      auth !== null &&
      "loggedIn" in auth &&
      auth.loggedIn === true &&
      "authMethod" in auth &&
      auth.authMethod === "claude.ai"
    );
  } catch {
    return false;
  }
}

export function isCompanionNativeVoiceEnabled(persisted: PersistedConfig): boolean {
  return persisted.features?.companion?.nativeVoicePreview === true;
}

export function isCompanionNativeVoiceAvailable(inputs: CompanionModelInputs): boolean {
  return isCompanionNativeVoiceEnabled(inputs.persisted) && inputs.codexCliAvailable === true;
}
