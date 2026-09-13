import type { Page } from "@playwright/test";
import { test, expect } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import { startRunningMockAgent } from "../support/helpers/composer";

/**
 * Diagnostic probe (not a budget test). Streams a long realistic agent run and
 * samples CDP performance metrics so a leak shows up as monotonic growth in
 * JS heap, DOM nodes or event listeners rather than as a single number.
 */
const RUN = process.env.FROGG_IDLE_LEAK_PROBE === "1";
const probeDescribe = RUN ? test.describe : test.describe.skip;

const SAMPLES = Number(process.env.FROGG_LEAK_SAMPLES ?? "12");
const SAMPLE_EVERY_MS = Number(process.env.FROGG_LEAK_INTERVAL_MS ?? "15000");
const MODEL = process.env.FROGG_LEAK_MODEL ?? "five-minute-stream";

interface Metrics {
  t: number;
  heapMb: number;
  nodes: number;
  listeners: number;
  documents: number;
  layouts: number;
  recalcs: number;
  commits: number;
}

interface DaemonTraffic {
  frames: number;
  bytes: number;
  biggest: number;
  over8kb: number;
  bytesOver8kb: number;
}

/**
 * Counts inbound daemon frames. The Tauri shell emits one
 * `ICoreWebView2::ExecuteScript` per frame on Windows, so frame rate and frame
 * size are what the desktop IPC cost scales with.
 */
function trackDaemonFrames(page: Page): DaemonTraffic {
  const traffic: DaemonTraffic = { frames: 0, bytes: 0, biggest: 0, over8kb: 0, bytesOver8kb: 0 };
  const record = (payload: string | Buffer) => {
    const size = typeof payload === "string" ? payload.length : payload.byteLength;
    traffic.frames += 1;
    traffic.bytes += size;
    if (size > traffic.biggest) traffic.biggest = size;
    // Tauri's Channel API switches from eval to fetch above 8 KB; `emit` never does.
    if (size > 8192) {
      traffic.over8kb += 1;
      traffic.bytesOver8kb += size;
    }
  };
  page.on("websocket", (ws) => ws.on("framereceived", (data) => record(data.payload)));
  return traffic;
}

probeDescribe("Leak probe", () => {
  test("samples heap, nodes and listeners across a long stream", async ({ page }, testInfo) => {
    test.setTimeout(SAMPLES * SAMPLE_EVERY_MS + 180_000);
    await page.addInitScript(() => {
      Reflect.set(globalThis, "__FROGG_RENDER_PROFILE_ENABLED__", true);
    });

    const traffic = trackDaemonFrames(page);

    const agent = await startRunningMockAgent(page, {
      prefix: "leak-probe-",
      model: MODEL,
      prompt: "Do a long realistic run.",
    });
    try {
      await awaitAssistantMessage(page);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.enable");
      await cdp.send("Performance.enable");

      const start = Date.now();
      const sample = async (): Promise<Metrics> => {
        await cdp.send("HeapProfiler.collectGarbage");
        const { metrics } = await cdp.send("Performance.getMetrics");
        const read = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
        const commits = await page.evaluate(countRenderProfileSamplesById);
        return {
          t: Math.round((Date.now() - start) / 1000),
          heapMb: +(read("JSHeapUsedSize") / 1e6).toFixed(1),
          nodes: read("Nodes"),
          listeners: read("JSEventListeners"),
          documents: read("Documents"),
          layouts: read("LayoutCount"),
          recalcs: read("RecalcStyleCount"),
          commits,
        };
      };

      const series: Metrics[] = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        series.push(await sample());
        console.log(`[leak] ${JSON.stringify(series[series.length - 1])}`);
        if (i < SAMPLES - 1) await page.waitForTimeout(SAMPLE_EVERY_MS);
      }

      const secs = (Date.now() - start) / 1000;
      const wsReport = {
        frames: traffic.frames,
        framesPerSec: +(traffic.frames / secs).toFixed(1),
        totalMb: +(traffic.bytes / 1e6).toFixed(2),
        mbPerMin: +((traffic.bytes / 1e6 / secs) * 60).toFixed(2),
        biggestKb: +(traffic.biggest / 1024).toFixed(1),
        framesOver8kb: traffic.over8kb,
        mbOver8kb: +(traffic.bytesOver8kb / 1e6).toFixed(2),
      };
      console.log(`[leak-ws] ${JSON.stringify(wsReport)}`);

      const byId = await page.evaluate(() => Reflect.get(globalThis, "__LEAK_BY_ID__") ?? {});
      const top = Object.entries(byId as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25);
      console.log(`[leak-by-id] ${JSON.stringify(top)}`);

      await testInfo.attach("leak-report", {
        body: JSON.stringify({ series, daemonFrames: wsReport, commitsById: top }, null, 2),
        contentType: "application/json",
      });
      expect(series.length).toBe(SAMPLES);
    } finally {
      await agent.cleanup();
    }
  });
});

/** Runs in the page: totals React profiler samples per profiler id. */
function countRenderProfileSamplesById(): number {
  const samples = Reflect.get(globalThis, "__FROGG_RENDER_PROFILE__");
  if (!Array.isArray(samples)) return 0;
  const byId: Record<string, number> = {};
  for (const sample of samples) {
    const id = String(Reflect.get(sample as object, "id"));
    byId[id] = (byId[id] ?? 0) + 1;
  }
  Reflect.set(globalThis, "__LEAK_BY_ID__", byId);
  return samples.length;
}
