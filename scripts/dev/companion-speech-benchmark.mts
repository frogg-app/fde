#!/usr/bin/env -S node --import tsx
/** Opt-in local voice qualification. No provider account or inference API is used. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cpus, platform, arch } from "node:os";
import { parseArgs } from "node:util";
import pino from "pino";
import { LocalSpeechWorkerClient } from "../../packages/server/src/server/speech/providers/local/worker-client.js";
import {
  DEFAULT_LOCAL_STT_MODEL,
  DEFAULT_LOCAL_TTS_MODEL,
  ensureLocalSpeechModels,
  LocalTtsModelIdSchema,
} from "../../packages/server/src/server/speech/providers/local/models.js";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: DEFAULT_LOCAL_TTS_MODEL },
    "models-dir": { type: "string" },
    "out-dir": { type: "string", default: ".dev/companion-speech-benchmark" },
    samples: { type: "string", default: "30" },
    speaker: { type: "string" },
    speed: { type: "string", default: "1.3" },
    download: { type: "boolean", default: false },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "Usage: node --import tsx scripts/dev/companion-speech-benchmark.mts [--model ID] [--models-dir DIR] [--out-dir DIR] [--samples 30] [--speaker ID] [--speed 1.3] [--download]",
  );
  process.exit(0);
}
const model = LocalTtsModelIdSchema.parse(values.model);
const count = Number(values.samples);
if (!Number.isInteger(count) || count < 3 || count > 100)
  throw new Error("--samples must be between 3 and 100");
const speed = Number(values.speed);
if (!Number.isFinite(speed) || speed < 0.75 || speed > 2) throw new Error("Invalid speech speed");
const speaker = values.speaker === undefined ? undefined : Number(values.speaker);
if (speaker !== undefined && (!Number.isInteger(speaker) || speaker < 0))
  throw new Error("Invalid speaker ID");
const out = path.resolve(values["out-dir"]);
const modelsDir = path.resolve(values["models-dir"] ?? path.join(out, "models"));
await mkdir(out, { recursive: true });
const logger = pino({ level: "silent" });
if (values.download) await ensureLocalSpeechModels({ modelsDir, modelIds: [model], logger });
const texts = [
  "The change is ready. All twelve tests passed.",
  "I found the issue. The connection was closing before the reply arrived.",
  "Take your time. I'm still listening.",
  "The build finished successfully. You can review the changes now.",
  "I need your approval before running that command.",
  "The server disconnected. Your coding task is still running on the host.",
];
const client = new LocalSpeechWorkerClient({
  logger,
  config: {
    modelsDir,
    voiceTtsModel: model,
    voiceTtsSpeakerId: speaker,
    voiceSttModel: DEFAULT_LOCAL_STT_MODEL,
    dictationSttModel: DEFAULT_LOCAL_STT_MODEL,
  },
});
interface Sample {
  text: string;
  firstPcmMs: number;
  durationSeconds: number;
  rms: number;
  peak: number;
  bytes: number;
}
const samples: Sample[] = [];
function wav(pcm: Buffer, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
try {
  // Sample zero includes worker/model startup; report it separately from warm turns.
  for (let i = 0; i <= count; i++) {
    const text = texts[i % texts.length];
    const start = performance.now();
    const result = await client.synthesizeSpeech(text, { speed });
    const match = /rate=(\d+)/.exec(result.format);
    if (!match) throw new Error(`Unexpected format: ${result.format}`);
    const rate = Number(match[1]);
    const chunks: Buffer[] = [];
    let firstPcmMs = 0;
    for await (const chunk of result.stream) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Expected PCM buffer");
      if (chunks.length === 0) firstPcmMs = performance.now() - start;
      chunks.push(chunk);
    }
    const pcm = Buffer.concat(chunks);
    let energy = 0,
      peak = 0;
    for (let j = 0; j < pcm.length; j += 2) {
      const value = pcm.readInt16LE(j) / 32768;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const rms = Math.sqrt(energy / (pcm.length / 2));
    if (!pcm.length || !Number.isFinite(rms) || rms < 0.001 || peak >= 0.999)
      throw new Error("Invalid, silent or clipped speech");
    samples.push({
      text,
      firstPcmMs,
      durationSeconds: pcm.length / 2 / rate,
      rms,
      peak,
      bytes: pcm.length,
    });
    if (i < texts.length) await writeFile(path.join(out, `sample-${i}.wav`), wav(pcm, rate));
    console.log(`${i === 0 ? "cold" : `warm ${i}/${count}`}: ${Math.round(firstPcmMs)} ms`);
  }
  const times = samples
    .slice(1)
    .map((s) => s.firstPcmMs)
    .sort((a, b) => a - b);
  const result = {
    passed: true,
    model,
    speaker,
    speed,
    platform: platform(),
    arch: arch(),
    node: process.version,
    cpu: cpus()[0]?.model,
    coldFirstPcmMs: samples[0].firstPcmMs,
    warmSamples: count,
    medianFirstPcmMs: times[Math.ceil(times.length * 0.5) - 1],
    p95FirstPcmMs: times[Math.ceil(times.length * 0.95) - 1],
    scope:
      "Local synthesis and worker transport only; not microphone-to-speaker latency or human voice-quality qualification",
    samples,
  };
  await writeFile(path.join(out, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `PASS: ${count} warm samples; median ${Math.round(
      result.medianFirstPcmMs,
    )} ms, p95 ${Math.round(result.p95FirstPcmMs)} ms. ${out}`,
  );
} catch (error) {
  await writeFile(
    path.join(out, "results.json"),
    JSON.stringify(
      {
        passed: false,
        model,
        samples,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  client.shutdown();
}
