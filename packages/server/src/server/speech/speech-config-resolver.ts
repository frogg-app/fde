import { z } from "zod";

import type { PersistedConfig } from "../persisted-config.js";
import type { PaseoOpenAIConfig, PaseoSpeechConfig } from "../bootstrap.js";
import { resolveLocalSpeechConfig } from "./providers/local/config.js";
import { resolveOpenAiSpeechConfig } from "./providers/openai/config.js";
import { resolveSherpaLoaderEnv } from "./providers/local/sherpa/sherpa-runtime-env.js";
import {
  SpeechProviderIdSchema,
  type RequestedSpeechProvider,
  type RequestedSpeechProviders,
} from "./speech-types.js";

const OptionalSpeechProviderSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(SpeechProviderIdSchema)
  .optional();

const OptionalBooleanFlagSchema = z
  .union([z.boolean(), z.string().trim().toLowerCase()])
  .optional()
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === undefined) {
      return undefined;
    }
    if (["1", "true", "yes", "y", "on"].includes(value)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(value)) {
      return false;
    }
    return undefined;
  });

const RequestedSpeechProvidersSchema = z.object({
  dictationStt: OptionalSpeechProviderSchema.default("local"),
  voiceTurnDetection: OptionalSpeechProviderSchema.default("local"),
  voiceStt: OptionalSpeechProviderSchema.default("local"),
  voiceTts: OptionalSpeechProviderSchema.default("local"),
});

function parseOptionalBooleanFlag(value: unknown): boolean | undefined {
  return OptionalBooleanFlagSchema.parse(value);
}

/**
 * Voice defaults on, but only when the local speech runtime (the sherpa-onnx
 * platform package) is present: a bundle without it would otherwise start a
 * worker that can only fail. Precedence for each feature:
 *
 * 1. `PASEO_VOICE=0` / `features.voice.enabled=false` turns everything off
 * 2. the fine-grained key (`PASEO_DICTATION_ENABLED`, `features.dictation.enabled`, ...)
 * 3. `PASEO_VOICE=1` / `features.voice.enabled=true`
 * 4. whether the local runtime is available
 */
export interface VoiceDefaultsInput {
  umbrella: boolean | undefined;
  localRuntimeAvailable: boolean;
}

export function resolveVoiceFeatureEnabled(
  fineGrained: boolean | undefined,
  defaults: VoiceDefaultsInput,
): boolean {
  if (defaults.umbrella === false) return false;
  return fineGrained ?? defaults.umbrella ?? defaults.localRuntimeAvailable;
}

export function isLocalSpeechRuntimeAvailable(): boolean {
  return resolveSherpaLoaderEnv() !== null;
}

interface FeatureProviderInputs {
  configuredValue: string | undefined;
  enabled: boolean;
}

function firstSpeechDefinedValue<T>(values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

function buildFeatureProviderInputs(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  localRuntimeAvailable: boolean;
}): Record<keyof RequestedSpeechProviders, FeatureProviderInputs> {
  const defaults: VoiceDefaultsInput = {
    umbrella: parseOptionalBooleanFlag(
      firstSpeechDefinedValue<string | boolean>([
        params.env.PASEO_VOICE,
        params.persisted.features?.voice?.enabled,
      ]),
    ),
    localRuntimeAvailable: params.localRuntimeAvailable,
  };
  const voiceModeEnabled = resolveVoiceFeatureEnabled(
    parseOptionalBooleanFlag(
      firstSpeechDefinedValue<string | boolean>([
        params.env.PASEO_VOICE_MODE_ENABLED,
        params.persisted.features?.voiceMode?.enabled,
      ]),
    ),
    defaults,
  );
  return {
    dictationStt: {
      configuredValue: firstSpeechDefinedValue<string>([
        params.env.PASEO_DICTATION_STT_PROVIDER,
        params.persisted.features?.dictation?.stt?.provider,
      ]),
      enabled: resolveVoiceFeatureEnabled(
        parseOptionalBooleanFlag(
          firstSpeechDefinedValue<string | boolean>([
            params.env.PASEO_DICTATION_ENABLED,
            params.persisted.features?.dictation?.enabled,
          ]),
        ),
        defaults,
      ),
    },
    voiceTurnDetection: {
      configuredValue: firstSpeechDefinedValue<string>([
        params.env.PASEO_VOICE_TURN_DETECTION_PROVIDER,
        params.persisted.features?.voiceMode?.turnDetection?.provider,
      ]),
      enabled: voiceModeEnabled,
    },
    voiceStt: {
      configuredValue: firstSpeechDefinedValue<string>([
        params.env.PASEO_VOICE_STT_PROVIDER,
        params.persisted.features?.voiceMode?.stt?.provider,
      ]),
      enabled: voiceModeEnabled,
    },
    voiceTts: {
      configuredValue: firstSpeechDefinedValue<string>([
        params.env.PASEO_VOICE_TTS_PROVIDER,
        params.persisted.features?.voiceMode?.tts?.provider,
      ]),
      enabled: voiceModeEnabled,
    },
  };
}

function buildRequestedFeatureProvider(
  inputs: FeatureProviderInputs,
  parsedValue: z.infer<typeof SpeechProviderIdSchema>,
): RequestedSpeechProvider {
  return {
    provider: parsedValue,
    explicit: inputs.configuredValue !== undefined,
    enabled: inputs.enabled,
  };
}

function resolveRequestedSpeechProviders(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  localRuntimeAvailable: boolean;
}): RequestedSpeechProviders {
  const featureProviders = buildFeatureProviderInputs(params);

  const parsed = RequestedSpeechProvidersSchema.parse({
    dictationStt: featureProviders.dictationStt.configuredValue ?? "local",
    voiceTurnDetection: featureProviders.voiceTurnDetection.configuredValue ?? "local",
    voiceStt: featureProviders.voiceStt.configuredValue ?? "local",
    voiceTts: featureProviders.voiceTts.configuredValue ?? "local",
  });

  return {
    dictationStt: buildRequestedFeatureProvider(featureProviders.dictationStt, parsed.dictationStt),
    voiceTurnDetection: buildRequestedFeatureProvider(
      featureProviders.voiceTurnDetection,
      parsed.voiceTurnDetection,
    ),
    voiceStt: buildRequestedFeatureProvider(featureProviders.voiceStt, parsed.voiceStt),
    voiceTts: buildRequestedFeatureProvider(featureProviders.voiceTts, parsed.voiceTts),
  };
}

export function resolveSpeechConfig(params: {
  paseoHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  /** Defaults to probing for the sherpa-onnx platform package. */
  localRuntimeAvailable?: boolean;
}): {
  openai: PaseoOpenAIConfig | undefined;
  speech: PaseoSpeechConfig;
} {
  const providers = resolveRequestedSpeechProviders({
    env: params.env,
    persisted: params.persisted,
    localRuntimeAvailable: params.localRuntimeAvailable ?? isLocalSpeechRuntimeAvailable(),
  });

  const local = resolveLocalSpeechConfig({
    paseoHome: params.paseoHome,
    env: params.env,
    persisted: params.persisted,
    providers,
  });

  const openai = resolveOpenAiSpeechConfig({
    env: params.env,
    persisted: params.persisted,
    providers,
  });

  return {
    openai,
    speech: {
      providers,
      sttLanguages: local.sttLanguages,
      ...(local.local ? { local: local.local } : {}),
    },
  };
}
