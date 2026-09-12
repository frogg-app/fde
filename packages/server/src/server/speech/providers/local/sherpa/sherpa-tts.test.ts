import { describe, expect, it, vi, beforeEach } from "vitest";
import pino from "pino";

const generate = vi.fn();
const free = vi.fn();
const initialize = vi.fn();

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
}));

vi.mock("./sherpa-onnx-node-loader.js", () => ({
  loadSherpaOnnxNode: () => ({
    OfflineTts: class {
      public readonly sampleRate = 24000;
      constructor(config: unknown) {
        initialize(config);
      }

      generate = generate;
      free = free;
    },
  }),
}));

describe("SherpaOnnxTTS", () => {
  beforeEach(() => {
    generate.mockReset();
    free.mockReset();
    initialize.mockReset();
  });

  it("disables external buffers when calling sherpa generate", async () => {
    generate.mockReturnValue({
      samples: Float32Array.from([0, 0.5, -0.5, 0.25]),
      sampleRate: 24000,
    });

    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kokoro-en-v0_19",
        modelDir: "/tmp/fake-model",
      },
      pino({ level: "silent" }),
    );

    const result = await tts.synthesizeSpeech("hello");

    expect(generate).toHaveBeenCalledWith({
      text: "hello",
      sid: 0,
      speed: 1,
      enableExternalBuffer: false,
    });
    expect(result.format).toBe("pcm;rate=24000");
  });
  it("uses the expressive local voice and passes thread settings where the native binding reads them", async () => {
    generate.mockReturnValue({
      samples: Float32Array.from([0, 0.4, -0.3]),
      sampleRate: 24000,
    });
    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kitten-nano-en-v0_8-fp32",
        modelDir: "/models/kitten",
        numThreads: 3,
      },
      pino({ level: "silent" }),
    );
    await tts.synthesizeSpeech("The change is ready.");
    expect(initialize).toHaveBeenCalledWith({
      model: {
        numThreads: 3,
        provider: "cpu",
        kitten: {
          model: "/models/kitten/model.fp32.onnx",
          voices: "/models/kitten/voices.bin",
          tokens: "/models/kitten/tokens.txt",
          dataDir: "/models/kitten/espeak-ng-data",
          lengthScale: 1,
        },
      },
      maxNumSentences: 1,
    });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sid: 5, speed: 1 }));
  });
  it("preserves a selected Kokoro voice, speed and its matching English lexicon", async () => {
    generate.mockReturnValue({
      samples: Float32Array.from([0, 0.4, -0.3]),
      sampleRate: 24000,
    });
    const { SherpaOnnxTTS } = await import("./sherpa-tts.js");
    const tts = new SherpaOnnxTTS(
      {
        preset: "kokoro-int8-multi-lang-v1_0",
        modelDir: "/models/kokoro",
        speakerId: 21,
        speed: 1.15,
      },
      pino({ level: "silent" }),
    );
    await tts.synthesizeSpeech("Ready.");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          kokoro: expect.objectContaining({
            model: "/models/kokoro/model.int8.onnx",
            lexicon: "/models/kokoro/lexicon-gb-en.txt",
            lang: "en-gb",
          }),
        }),
      }),
    );
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ sid: 21, speed: 1.15 }));
  });
});
