import type pino from "pino";
import { Readable } from "node:stream";
import { existsSync } from "node:fs";

import type { SpeechStreamResult, TextToSpeechProvider } from "../../../speech-provider.js";
import { chunkBuffer, float32ToPcm16le } from "../../../audio.js";
import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.js";

import { defaultTtsSpeakerId, type LocalTtsModelId } from "./model-catalog.js";

export type SherpaTtsPreset = LocalTtsModelId;

export interface SherpaTtsConfig {
  preset: SherpaTtsPreset;
  modelDir: string;
  speakerId?: number;
  speed?: number;
  lengthScale?: number;
  numThreads?: number;
}

function assertFileExists(filePath: string, label: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function createModelConfig(config: SherpaTtsConfig, speakerId: number) {
  const files: Record<LocalTtsModelId, string> = {
    "piper-ljspeech-medium": "en_US-ljspeech-medium.onnx",
    "kitten-nano-en-v0_8-fp32": "model.fp32.onnx",
    "kokoro-int8-multi-lang-v1_0": "model.int8.onnx",
    "kokoro-en-v0_19": "model.onnx",
  };
  const model = `${config.modelDir}/${files[config.preset]}`;
  const voices = `${config.modelDir}/voices.bin`;
  const tokens = `${config.modelDir}/tokens.txt`;
  const dataDir = `${config.modelDir}/espeak-ng-data`;
  assertFileExists(model, "TTS model");
  assertFileExists(tokens, "TTS tokens");
  assertFileExists(dataDir, "TTS espeak-ng dataDir");
  const common = { model, tokens, dataDir, lengthScale: config.lengthScale ?? 1.0 };
  if (config.preset === "piper-ljspeech-medium") return { vits: common };
  assertFileExists(voices, "TTS voices");
  if (config.preset === "kitten-nano-en-v0_8-fp32") return { kitten: { ...common, voices } };
  if (config.preset === "kokoro-int8-multi-lang-v1_0") {
    const british = speakerId >= 20 && speakerId <= 27;
    const lexicon = `${config.modelDir}/${british ? "lexicon-gb-en.txt" : "lexicon-us-en.txt"}`;
    assertFileExists(lexicon, "TTS pronunciation lexicon");
    return { kokoro: { ...common, voices, lexicon, lang: british ? "en-gb" : "en-us" } };
  }
  return { kokoro: { ...common, voices } };
}

interface SherpaOfflineTtsNative {
  sampleRate?: number;
  generate: (args: {
    text: string;
    sid: number;
    speed: number;
    enableExternalBuffer: boolean;
  }) => { samples?: Float32Array | number[]; sampleRate?: number } | undefined;
  free?: () => void;
}

export class SherpaOnnxTTS implements TextToSpeechProvider {
  private readonly tts: SherpaOfflineTtsNative;
  private readonly speakerId: number;
  private readonly speed: number;
  private readonly logger: pino.Logger;

  constructor(config: SherpaTtsConfig, logger: pino.Logger) {
    this.logger = logger.child({
      module: "speech",
      provider: "local",
      component: "tts",
    });
    this.speakerId = config.speakerId ?? defaultTtsSpeakerId(config.preset) ?? 0;
    this.speed = config.speed ?? 1.0;

    const sherpa = loadSherpaOnnxNode();
    if (typeof sherpa.OfflineTts !== "function") {
      throw new Error("sherpa-onnx-node OfflineTts is unavailable");
    }

    const modelConfig = createModelConfig(config, this.speakerId);

    const offlineTtsConfig = {
      // The native binding reads these inside model, not at the config root.
      model: {
        ...modelConfig,
        numThreads: config.numThreads ?? 2,
        provider: "cpu",
      },
      maxNumSentences: 1,
    };

    this.tts = new (
      sherpa as unknown as {
        OfflineTts: new (config: unknown) => SherpaOfflineTtsNative;
      }
    ).OfflineTts(offlineTtsConfig);
    this.logger.info(
      { preset: config.preset, modelDir: config.modelDir },
      "Sherpa offline TTS initialized",
    );
  }

  async synthesizeSpeech(text: string, options?: { speed?: number }): Promise<SpeechStreamResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot synthesize empty text");
    }

    const audio = this.tts.generate({
      text: trimmed,
      sid: this.speakerId,
      speed: this.speed * (options?.speed ?? 1),
      // Electron rejects native external-backed typed arrays. Request a copied buffer
      // from sherpa itself instead of trying to clone after generate() returns.
      enableExternalBuffer: false,
    });
    let rawSamples: Float32Array | null = null;
    if (audio && audio.samples instanceof Float32Array) {
      rawSamples = audio.samples;
    } else if (audio && Array.isArray(audio.samples)) {
      rawSamples = Float32Array.from(audio.samples);
    }
    // Copy to avoid "External buffers are not allowed" when sherpa-onnx
    // returns a Float32Array backed by native memory.
    const samples = rawSamples ? Float32Array.from(rawSamples) : null;
    let sampleRate: number;
    if (
      audio &&
      typeof audio.sampleRate === "number" &&
      Number.isFinite(audio.sampleRate) &&
      audio.sampleRate > 0
    ) {
      sampleRate = audio.sampleRate;
    } else if (typeof this.tts.sampleRate === "number") {
      sampleRate = this.tts.sampleRate;
    } else {
      sampleRate = 24000;
    }

    if (!samples) {
      throw new Error("Unexpected sherpa TTS output: missing Float32 samples");
    }

    const pcm16 = float32ToPcm16le(samples);
    const chunkBytes = Math.max(2, Math.round(sampleRate * 0.05) * 2); // ~50ms
    const chunks = chunkBuffer(pcm16, chunkBytes);

    return {
      stream: Readable.from(chunks),
      format: `pcm;rate=${sampleRate}`,
    };
  }

  free(): void {
    try {
      this.tts?.free?.();
    } catch {
      // ignore
    }
  }
}
