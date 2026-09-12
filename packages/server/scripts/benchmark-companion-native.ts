/** Opt-in probe of production voice adapters with a real subscription worker. */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";
import pino from "pino";
import { z } from "zod";
import { createCompanionNativeVoice } from "../src/server/companion/native-voice.js";
import { claudeQuery } from "../src/server/agent/providers/claude/query.js";
import { defineCompanionTool } from "../src/server/companion/tools/index.js";
import { SherpaOnnxTTS } from "../src/server/speech/providers/local/sherpa/sherpa-tts.js";

if (process.env.PASEO_COMPANION_BENCH !== "1")
  throw new Error("Set PASEO_COMPANION_BENCH=1 to spend subscription allowance on this probe.");
const modelDir = process.env.PASEO_COMPANION_BENCH_TTS_DIR;
if (!modelDir)
  throw new Error("Set PASEO_COMPANION_BENCH_TTS_DIR to the extracted Piper LJSpeech directory.");
const muted = process.argv.includes("--mute");
let muteMicrophone = async () => {};
let beforeHandoff = async () => {};
let energyBeforeHandoff = 0;
const deferred = process.argv.includes("--deferred");
const cwd = await mkdtemp(path.join(tmpdir(), "fde-companion-native-probe-"));
const logger = pino({ level: "error" });
const workerAbort = new AbortController();
const tts = new SherpaOnnxTTS({ preset: "piper-ljspeech-medium", modelDir }, logger);
let workerResult = "";
let workerTask: Promise<void> | null = null;
let transcript = "";
const voice = createCompanionNativeVoice({
  cwd,
  logger,
  model: "gpt-5.6-luna",
  tools: [
    defineCompanionTool({
      name: "think",
      description:
        "Ask a real Claude worker for the private verification number. Only the worker knows this result.",
      deferred,
      schema: z.object({ question: z.string() }),
      handler: async ({ question }) => {
        const calculate = async () => {
          const query = claudeQuery({
            prompt: `The requested verification task is ${question}. Calculate 17 times 23 and return only the number.`,
            options: {
              cwd,
              model: "claude-sonnet-4-6",
              abortController: workerAbort,
              systemPrompt:
                "You are a calculation worker. Perform the supplied arithmetic and return the numerical result.",
              tools: [],
              skills: [],
              settingSources: [],
              strictMcpConfig: true,
              mcpServers: {},
              persistSession: false,
              maxTurns: 1,
              env: {
                ...process.env,
                ANTHROPIC_API_KEY: undefined,
                ANTHROPIC_AUTH_TOKEN: undefined,
                ANTHROPIC_BASE_URL: undefined,
              },
            },
          });
          for await (const event of query) {
            if (event.type === "assistant")
              for (const block of event.message.content)
                if (block.type === "text") workerResult += block.text;
          }
        };
        if (!deferred) {
          await calculate();
          return { result: workerResult };
        }
        workerTask = calculate().then(async () => {
          if (muted) await muteMicrophone();
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await beforeHandoff();
          return voice.appendSpeech(
            `Your background calculation finished. The answer is ${workerResult}.`,
          );
        });
        void workerTask.catch((error) => console.error("Worker handoff failed", error));
        return { status: "started", jobId: "native-probe-calculation" };
      },
    }),
  ],
  onTranscript(role, text, isFinal) {
    if (role === "assistant" && isFinal) transcript += ` ${text}`;
  },
  onError(error) {
    console.error("Voice failure", error);
  },
});
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<!doctype html><html><body>Companion voice probe</body></html>");
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
const workerDeadline = setTimeout(() => workerAbort.abort(), 90000);
try {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No probe address");
  browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const bundle = path.join(cwd, "native-audio.js");
  await build({
    entryPoints: [path.resolve("../../apps/ui/src/companion/native-audio.ts")],
    bundle: true,
    outfile: bundle,
    format: "iife",
    globalName: "CompanionAudio",
    alias: { "@": path.resolve("../../apps/ui/src") },
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  // Keep the synthetic microphone clock alive with exact silence after the question.
  await page.addScriptTag({
    content: `
    window.context = new AudioContext({sampleRate: 24000});
    window.microphone = context.createMediaStreamDestination();
    const clock = context.createOscillator(); const silence = context.createGain(); silence.gain.value = 0;
    clock.connect(silence).connect(microphone); clock.start();
    navigator.mediaDevices.getUserMedia = async () => microphone.stream;
    const OriginalPeer = RTCPeerConnection;
    window.audioEnergy = 0; window.receivedSamples = 0;
    window.RTCPeerConnection = class extends OriginalPeer {
      constructor(...args) { super(...args); window.peer = this; this.addEventListener('track', event => {
        const source = context.createMediaStreamSource(event.streams[0]); const meter = context.createScriptProcessor(2048, 1, 1);
        meter.onaudioprocess = event => { for (const sample of event.inputBuffer.getChannelData(0)) { audioEnergy += sample * sample; receivedSamples++; } };
        source.connect(meter).connect(context.destination);
      }); }
    };
  `,
  });
  await page.addScriptTag({ content: await readFile(bundle, "utf8") });
  const offer = await page.evaluate<string>(
    "window.adapter = CompanionAudio.createCompanionNativeAudio(() => {}); adapter.prepare()",
  );
  muteMicrophone = async () => {
    await page.evaluate("adapter.mute(true)");
  };
  beforeHandoff = async () => {
    energyBeforeHandoff = await page.evaluate<number>("audioEnergy");
  };
  const answer = await voice.start(offer);
  await page.evaluate(`adapter.connect(${JSON.stringify(answer)})`);
  const recording = await tts.synthesizeSpeech(
    "Please ask my worker for the private verification number and tell me what it returns.",
  );
  const chunks: Buffer[] = [];
  for await (const chunk of recording.stream) chunks.push(Buffer.from(chunk));
  const pcm = Buffer.concat(chunks);
  const samples = Array.from(
    { length: pcm.length / 2 },
    (_, index) => pcm.readInt16LE(index * 2) / 32768,
  );
  const sampleRate = Number(/rate=(\d+)/.exec(recording.format)?.[1]);
  await page.evaluate(
    `(() => { const buffer = context.createBuffer(1, ${samples.length}, ${sampleRate}); buffer.copyToChannel(Float32Array.from(${JSON.stringify(samples)}), 0); const input = context.createBufferSource(); input.buffer = buffer; input.connect(microphone); input.start(); })()`,
  );
  const deadline = Date.now() + 90000;
  while (
    Date.now() < deadline &&
    !/391|three (hundred (and )?)?ninety.one|three nine one/i.test(transcript)
  )
    await new Promise((resolve) => setTimeout(resolve, 1000));
  await workerTask;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const audio = z
    .object({ energy: z.number(), samples: z.number() })
    .parse(await page.evaluate("({energy: audioEnergy, samples: receivedSamples})"));
  const passed =
    /391/.test(workerResult) &&
    /391|three (hundred (and )?)?ninety.one|three nine one/i.test(transcript) &&
    audio.energy - energyBeforeHandoff > 0.01;
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      deferred,
      muted,
      workerResult,
      transcript,
      audio,
      energyAfterHandoff: audio.energy - energyBeforeHandoff,
      inputAfterQuestion: "continuous exact silence",
      coverage:
        "production browser and server adapters; synthetic microphone; one account; no physical device",
    }),
  );
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await voice.close();
  workerAbort.abort();
  clearTimeout(workerDeadline);
  tts.free();
  await browser?.close();
  server.close();
  await rm(cwd, { recursive: true, force: true });
}
