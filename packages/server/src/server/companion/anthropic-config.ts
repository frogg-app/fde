import type { PersistedConfig } from "../persisted-config.js";

export const DEFAULT_COMPANION_MODEL = "claude-haiku-4-5";

export const COMPANION_KEY_MISSING_REASON_CODE = "companion_key_missing";

export interface CompanionModelInputs {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}

export interface CompanionModelAvailable {
  status: "available";
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

export interface CompanionModelUnavailable {
  status: "unavailable";
  reasonCode: typeof COMPANION_KEY_MISSING_REASON_CODE;
  message: string;
}

export type CompanionModelConfig = CompanionModelAvailable | CompanionModelUnavailable;

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

export function resolveCompanionModelConfig(inputs: CompanionModelInputs): CompanionModelConfig {
  const anthropic = inputs.persisted.providers?.anthropic;
  const apiKey = firstDefined([anthropic?.apiKey, inputs.env.ANTHROPIC_API_KEY]);
  if (!apiKey) {
    return {
      status: "unavailable",
      reasonCode: COMPANION_KEY_MISSING_REASON_CODE,
      message:
        "The Companion needs an Anthropic API key. Set providers.anthropic.apiKey or ANTHROPIC_API_KEY.",
    };
  }
  const baseUrl = firstDefined([anthropic?.baseUrl, inputs.env.ANTHROPIC_BASE_URL]);
  return {
    status: "available",
    apiKey,
    baseUrl: baseUrl ?? null,
    model: resolveCompanionModel(inputs),
  };
}
