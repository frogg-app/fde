/** Opt-in real subscription probe. It only asks short questions and reads a fixture tool. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cpus, totalmem } from "node:os";
import { resolveProviderLaunch } from "../src/server/agent/provider-launch-config.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import pino from "pino";
import { z } from "zod";
import { createCompanionCliBackend } from "../src/server/companion/backends/cli.js";
import { createCompanionCodexBackend } from "../src/server/companion/backends/codex.js";
import { CompanionOrchestrator } from "../src/server/companion/orchestrator.js";
import { CompanionNotebookStore } from "../src/server/companion/store.js";
import { defineCompanionTool } from "../src/server/companion/tools/index.js";
import { SherpaOnnxTTS } from "../src/server/speech/providers/local/sherpa/sherpa-tts.js";

if (process.env.FROGG_COMPANION_BENCH !== "1")
  throw new Error(
    "Set FROGG_COMPANION_BENCH=1 to use your subscription allowance for this benchmark.",
  );
const provider =
  process.argv.find((arg) => arg.startsWith("--provider="))?.split("=")[1] ?? "claude";
if (provider !== "claude" && provider !== "codex")
  throw new Error("Expected --provider=claude or --provider=codex");
const count = Number(process.argv.find((arg) => arg.startsWith("--turns="))?.split("=")[1] ?? 30);
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Expected 1–100 turns");
const cwd = await mkdtemp(path.join(tmpdir(), "frogg-companion-benchmark-"));
const logger = pino({ level: "error" });
let verifiedStatusCalls = 0;
const tools = [
  defineCompanionTool({
    name: "get_agent_status",
    description: "Read the current state of fixture agent fixture-agent.",
    deferred: false,
    schema: z.object({ agentId: z.literal("fixture-agent") }),
    handler: async () => {
      verifiedStatusCalls += 1;
      return { status: "running", result: null };
    },
  }),
];
const model = provider === "claude" ? "claude-haiku-4-5" : "gpt-5.6-luna";
const backend = (provider === "claude" ? createCompanionCliBackend : createCompanionCodexBackend)({
  cwd,
  model,
  tools,
  logger,
});
const ttsDir = process.env.FROGG_COMPANION_BENCH_TTS_DIR;
const tts = ttsDir
  ? new SherpaOnnxTTS({ preset: "piper-ljspeech-medium", modelDir: ttsDir }, logger)
  : null;
const results: { firstTextMs: number; firstPcmMs: number | null; totalMs: number }[] = [];
try {
  const launch = await resolveProviderLaunch({ defaultBinary: provider });
  const version = await promisify(execFile)(launch.command, [...launch.args, "--version"], {
    timeout: 5000,
  });
  console.log(
    JSON.stringify({
      provider,
      cliVersion: version.stdout.trim(),
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model,
      memoryGiB: Math.round(totalmem() / 2 ** 30),
      node: process.version,
    }),
  );
  const cold = performance.now();
  await backend.warm();
  const startupMs = performance.now() - cold;
  const orchestrator = new CompanionOrchestrator({
    backend,
    tools,
    notebook: new CompanionNotebookStore({ filePath: path.join(cwd, "notebook.json") }),
  });
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    let firstTextMs: number | null = null;
    let firstPcmMs: number | null = null;
    let text = "";
    for await (const event of orchestrator.turn("Are you there? Answer in one short sentence.")) {
      if (event.type !== "text_delta") continue;
      firstTextMs ??= performance.now() - start;
      text += event.text;
      if (tts && firstPcmMs === null && /[.!?]/.test(text)) {
        const audio = await tts.synthesizeSpeech(text);
        firstPcmMs = await measureFirstPcm(audio.stream, start);
      }
    }
    if (firstTextMs === null) throw new Error("No spoken text returned");
    if (tts && firstPcmMs === null) {
      const audio = await tts.synthesizeSpeech(text);
      for await (const _chunk of audio.stream) firstPcmMs ??= performance.now() - start;
    }
    const result = {
      firstTextMs: Math.round(firstTextMs),
      firstPcmMs: firstPcmMs === null ? null : Math.round(firstPcmMs),
      totalMs: Math.round(performance.now() - start),
    };
    results.push(result);
    console.log(JSON.stringify({ provider, turn: index + 1, ...result }));
  }
  let toolInvoked = false;
  for await (const event of orchestrator.turn(
    "Check the status of fixture-agent using get_agent_status. Do not invent its result.",
  ))
    if (event.type === "tool_started") toolInvoked = true;
  if (!toolInvoked || verifiedStatusCalls === 0) throw new Error("The status tool was not called");
  const percentile = (values: number[], fraction: number) =>
    values.sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
  console.log(
    JSON.stringify({
      status: "passed",
      provider,
      model,
      count,
      startupMs: Math.round(startupMs),
      firstTextP50: percentile(
        results.map((r) => r.firstTextMs),
        0.5,
      ),
      firstTextP95: percentile(
        results.map((r) => r.firstTextMs),
        0.95,
      ),
      firstPcmP50: tts
        ? percentile(
            results.map((r) => r.firstPcmMs!),
            0.5,
          )
        : null,
      firstPcmP95: tts
        ? percentile(
            results.map((r) => r.firstPcmMs!),
            0.95,
          )
        : null,
      measurement:
        "text input to generated PCM; excludes recognition, transport and device playback",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      status: "failed",
      provider,
      completedTurns: results.length,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  tts?.free();
  await backend.close();
  await rm(cwd, { recursive: true, force: true });
}

async function measureFirstPcm(stream: AsyncIterable<unknown>, start: number): Promise<number> {
  let first: number | null = null;
  for await (const _chunk of stream) first ??= performance.now() - start;
  if (first === null) throw new Error("No PCM returned");
  return first;
}
