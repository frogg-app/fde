import path from "node:path";

import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";

describe("resolveSpeechConfig", () => {
  test("spoken notifications follow the voice umbrella and honour their own opt-outs", () => {
    const fdeHome = "/tmp/fde-home";
    const resolve = (env: NodeJS.ProcessEnv, persistedInput: unknown) =>
      resolveSpeechConfig({
        fdeHome,
        env,
        persisted: PersistedConfigSchema.parse(persistedInput),
        localRuntimeAvailable: true,
      }).speech.notifications;

    expect(resolve({}, {})).toEqual({ enabled: true });
    expect(resolve({ FDE_VOICE: "0" }, {})).toEqual({ enabled: false });
    expect(resolve({ FDE_VOICE_NOTIFICATIONS: "0" }, {})).toEqual({
      enabled: false,
    });
    expect(resolve({}, { features: { voice: { notifications: { enabled: false } } } })).toEqual({
      enabled: false,
    });
    expect(
      resolve(
        {},
        {
          features: {
            voice: { enabled: false, notifications: { enabled: true } },
          },
        },
      ),
    ).toEqual({ enabled: false });
    expect(
      resolveSpeechConfig({
        fdeHome,
        env: {} as NodeJS.ProcessEnv,
        persisted: PersistedConfigSchema.parse({}),
        localRuntimeAvailable: false,
      }).speech.notifications,
    ).toEqual({ enabled: false });
  });

  test("resolves local-first defaults without env overrides", () => {
    const fdeHome = "/tmp/fde-home";
    const persisted = PersistedConfigSchema.parse({});
    const env = {} as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      fdeHome,
      env,
      persisted,
    });

    expect(result.openai).toBeUndefined();
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.local).toEqual({
      modelsDir: path.join(fdeHome, "models", "local-speech"),
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kitten-nano-en-v0_8-fp32",
        voiceTtsSpeakerId: 5,
      },
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kitten-nano-en-v0_8-fp32");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(5);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "en",
      voice: "en",
    });
  });

  test("resolves feature-scoped local speech settings", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        voiceMode: {
          turnDetection: { provider: "local" },
          stt: { provider: "openai", model: "gpt-4o-transcribe" },
        },
      },
      providers: {
        openai: { apiKey: "persisted-key" },
      },
    });
    const env = {
      FDE_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      FDE_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      FDE_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
      FDE_VOICE_LOCAL_TTS_SPEAKER_ID: "5",
      FDE_VOICE_LOCAL_TTS_SPEED: "1.35",
      FDE_DICTATION_LANGUAGE: "es",
      FDE_VOICE_LANGUAGE: "pt",
      FDE_LOCAL_MODELS_DIR: "/tmp/models",
      OPENAI_API_KEY: "env-key",
      FDE_VOICE_STT_PROVIDER: "openai",
      FDE_DICTATION_STT_PROVIDER: "local",
      FDE_VOICE_TTS_PROVIDER: "local",
    } as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env,
      persisted,
    });

    expect(result.speech.local).toEqual({
      modelsDir: "/tmp/models",
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 5,
        voiceTtsSpeed: 1.35,
      },
    });
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "openai",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(5);
    expect(result.speech.local?.models.voiceTtsSpeed).toBe(1.35);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "pt",
    });
    expect(result.openai?.stt?.apiKey).toBe("persisted-key");
    expect(result.openai?.tts?.apiKey).toBe("persisted-key");
    expect(result.openai?.stt?.model).toBe("gpt-4o-transcribe");
  });

  test("resolves STT language from env, settings, and voice-to-dictation fallback", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: {
          stt: {
            language: "fr",
          },
        },
        voiceMode: {
          stt: {
            language: "de",
          },
        },
      },
    });

    const result = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env: {
        FDE_DICTATION_LANGUAGE: "es",
        FDE_VOICE_LANGUAGE: "  ",
      } as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "es",
    });
  });

  test("respects disabled dictation and voice mode feature flags", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    });

    const result = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env: {} as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
  });

  function enabledFlags(result: ReturnType<typeof resolveSpeechConfig>) {
    return {
      dictation: result.speech.providers.dictationStt.enabled,
      voice: result.speech.providers.voiceStt.enabled,
      hasLocalConfig: result.speech.local !== undefined,
    };
  }

  test("voice defaults on only when the local speech runtime is available", () => {
    const persisted = PersistedConfigSchema.parse({});
    const env = {} as NodeJS.ProcessEnv;
    const withRuntime = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env,
      persisted,
      localRuntimeAvailable: true,
    });
    const withoutRuntime = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env,
      persisted,
      localRuntimeAvailable: false,
    });
    expect(enabledFlags(withRuntime)).toEqual({
      dictation: true,
      voice: true,
      hasLocalConfig: true,
    });
    expect(enabledFlags(withoutRuntime)).toEqual({
      dictation: false,
      voice: false,
      hasLocalConfig: false,
    });
  });

  test("the umbrella opt-out wins over fine-grained keys; umbrella on forces defaults on", () => {
    const explicitOn = PersistedConfigSchema.parse({
      features: { dictation: { enabled: true }, voiceMode: { enabled: true } },
    });
    const off = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env: { FDE_VOICE: "0" } as NodeJS.ProcessEnv,
      persisted: explicitOn,
      localRuntimeAvailable: true,
    });
    expect(enabledFlags(off)).toEqual({
      dictation: false,
      voice: false,
      hasLocalConfig: false,
    });

    const persistedOff = PersistedConfigSchema.parse({
      features: { voice: { enabled: false } },
    });
    expect(
      enabledFlags(
        resolveSpeechConfig({
          fdeHome: "/tmp/fde-home",
          env: {} as NodeJS.ProcessEnv,
          persisted: persistedOff,
          localRuntimeAvailable: true,
        }),
      ),
    ).toEqual({ dictation: false, voice: false, hasLocalConfig: false });

    const forcedOn = resolveSpeechConfig({
      fdeHome: "/tmp/fde-home",
      env: {
        FDE_VOICE: "1",
        FDE_VOICE_MODE_ENABLED: "0",
      } as NodeJS.ProcessEnv,
      persisted: PersistedConfigSchema.parse({}),
      localRuntimeAvailable: false,
    });
    expect(enabledFlags(forcedOn)).toEqual({
      dictation: true,
      voice: false,
      hasLocalConfig: true,
    });
  });
});
