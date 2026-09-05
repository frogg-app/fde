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

export interface CompanionModelUnavailable {
  status: "unavailable";
  reasonCode: typeof COMPANION_BACKEND_MISSING_REASON_CODE;
  message: string;
}

export type CompanionModelConfig =
  | CompanionApiModelConfig
  | CompanionCliModelConfig
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
    inputs.env.PASEO_COMPANION_MODEL,
  ]);
  return configured ?? DEFAULT_COMPANION_MODEL;
}

/**
 * The API path wins whenever a key resolves: it answers roughly a second sooner
 * than the CLI, which pays for a local process, a harness init and no prompt
 * cache. The CLI is the fallback that lets a machine with Claude Code and no
 * key hold a conversation at all.
 */
export function resolveCompanionModelConfig(inputs: CompanionModelInputs): CompanionModelConfig {
  const model = resolveCompanionModel(inputs);
  const anthropic = inputs.persisted.providers?.anthropic;
  const apiKey = firstDefined([anthropic?.apiKey, inputs.env.ANTHROPIC_API_KEY]);
  if (apiKey) {
    const baseUrl = firstDefined([anthropic?.baseUrl, inputs.env.ANTHROPIC_BASE_URL]);
    return { status: "available", backend: "api", apiKey, baseUrl: baseUrl ?? null, model };
  }
  if (inputs.claudeCliAvailable) {
    return { status: "available", backend: "cli", model };
  }
  return {
    status: "unavailable",
    reasonCode: COMPANION_BACKEND_MISSING_REASON_CODE,
    message:
      "The Companion needs an Anthropic API key or the Claude Code CLI. Set providers.anthropic.apiKey or ANTHROPIC_API_KEY, or install and sign in to Claude Code.",
  };
}

export async function isClaudeCliAvailable(commandConfig?: ProviderCommand): Promise<boolean> {
  const launch = await resolveProviderLaunch({
    ...(commandConfig ? { commandConfig } : {}),
    defaultBinary: "claude",
  });
  const availability = await checkProviderLaunchAvailable(launch);
  return availability.available;
}
