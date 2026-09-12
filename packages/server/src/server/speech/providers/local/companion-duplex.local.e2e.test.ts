import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";
import { createVoiceTurnController } from "../../../session/voice/voice-turn-controller.js";
import { parsePcm16MonoWav, wordSimilarity } from "../../../test-utils/dictation-e2e.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
  WorkerBackedTurnDetectionProvider,
} from "./worker-client.js";

const modelsDir = process.env.PASEO_LOCAL_MODELS_DIR;
const available = Boolean(
  modelsDir &&
  existsSync(
    path.join(modelsDir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx"),
  ),
);

test.skipIf(!available)(
  "real microphone-paced recognition keeps listening while a reply callback is held",
  async () => {
    if (!modelsDir) throw new Error("PASEO_LOCAL_MODELS_DIR is required");
    const logger = pino({ level: "silent" });
    const config = {
      modelsDir,
      voiceSttModel: "parakeet-tdt-0.6b-v2-int8",
      dictationSttModel: "parakeet-tdt-0.6b-v2-int8",
      voiceTtsModel: "kokoro-en-v0_19",
    } as const;
    const stt = new LocalSpeechWorkerClient({ config, logger });
    const vad = new LocalSpeechWorkerClient({ config, logger });
    const finals: string[] = [];
    const partials: string[] = [];
    const starts: number[] = [];
    const errors: Error[] = [];
    let release!: () => void;
    const reply = new Promise<void>((resolve) => {
      release = resolve;
    });
    const controller = createVoiceTurnController({
      logger,
      stt: new WorkerBackedSpeechToTextProvider(stt, "voiceStt"),
      turnDetection: new WorkerBackedTurnDetectionProvider(vad),
      continuousTranscripts: true,
      endpointing: { confirmMs: 120, silenceMs: 1400 },
      callbacks: {
        async onSpeechStarted() {
          starts.push(Date.now());
        },
        async onSpeechStopped() {},
        async onPartialTranscript({ transcript }) {
          partials.push(transcript);
        },
        async onFinalTranscript({ transcript }) {
          finals.push(transcript);
          await reply;
        },
        onError(error) {
          errors.push(error);
        },
      },
    });
    async function feed(pcm: Buffer) {
      for (let offset = 0; offset < pcm.length; offset += 1600) {
        await controller.appendClientChunk({
          audioBase64: pcm.subarray(offset, offset + 1600).toString("base64"),
          format: "audio/pcm;rate=16000",
        });
        await delay(50);
      }
    }
    try {
      const fixture = path.resolve("../../apps/ui/e2e/support/fixtures/recording.wav");
      const { pcm16 } = parsePcm16MonoWav(await readFile(fixture));
      // The saved fixture peaks at only 423/32768. Supply ordinary microphone
      // levels to the real VAD; recognition itself already normalizes quiet PCM.
      for (let offset = 0; offset < pcm16.length; offset += 2)
        pcm16.writeInt16LE(pcm16.readInt16LE(offset) * 40, offset);
      await controller.start();
      await feed(pcm16.subarray(0, 64000));
      await feed(Buffer.alloc(22400)); // A 700ms mid-sentence pause must not commit.
      expect(finals).toEqual([]);
      await feed(pcm16.subarray(64000));
      await feed(Buffer.alloc(64000));
      await expect.poll(() => finals.length, { timeout: 10000 }).toBe(1);
      const before = partials.length;
      await feed(pcm16);
      await feed(Buffer.alloc(64000));
      await expect.poll(() => finals.length, { timeout: 10000 }).toBe(2);
      expect(starts).toHaveLength(2);
      expect(partials.length - before).toBeGreaterThan(1);
      expect(wordSimilarity(finals[0], "This is a voice note.")).toBeGreaterThan(0.45);
      expect(wordSimilarity(finals[1], "This is a voice note.")).toBeGreaterThan(0.45);
      expect(errors).toEqual([]);
    } finally {
      release();
      await controller.stop();
      stt.shutdown();
      vad.shutdown();
    }
  },
  90000,
);
