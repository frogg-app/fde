import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { isClaudeCliAvailable } from "../model-config.js";
import { CompanionOrchestrator } from "../orchestrator.js";
import { CompanionNotebookStore, companionNotebookPath } from "../store.js";
import { defineCompanionTool } from "../tools/index.js";
import { createCompanionCliBackend } from "./cli.js";
import type { CompanionBackend } from "../backend.js";

// Info level on purpose: the measurement is the point of this test.
const logger = pino({ level: "info" });
const claudeAvailable = await isClaudeCliAvailable();

const statusTool = defineCompanionTool({
  name: "get_agent_status",
  description: "One agent's status, model and current turn state.",
  deferred: false,
  schema: z.object({ agentId: z.string().min(1) }),
  handler: async () => ({ status: "running", model: "claude-haiku-4-5" }),
});

/**
 * The CLI path's whole viability is a latency question, so this test measures
 * it rather than asserting a shape. The numbers it prints are the ones written
 * down in docs/companion.md; the assertions are the loose bounds that would
 * make the feature unusable if crossed.
 */
describe.skipIf(!claudeAvailable)("the Companion's CLI backend against a real Claude Code", () => {
  let home: string;
  let notebook: CompanionNotebookStore;
  let backend: CompanionBackend;

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "companion-cli-real-"));
    notebook = new CompanionNotebookStore({ filePath: companionNotebookPath(home) });
    backend = createCompanionCliBackend({
      model: "claude-haiku-4-5",
      tools: [statusTool],
      cwd: home,
      logger,
    });
  }, 120_000);

  afterAll(async () => {
    await backend.close();
    await rm(home, { recursive: true, force: true });
  });

  it("pays its cold start on warm and answers warm turns in about a second and a half", async () => {
    const warmStarted = Date.now();
    await backend.warm();
    const warmMs = Date.now() - warmStarted;

    const orchestrator = new CompanionOrchestrator({ backend, tools: [statusTool], notebook });
    const firstDeltaMs: number[] = [];

    for (const said of ["are you there?", "and how are things?", "anything else?"]) {
      const started = Date.now();
      let firstDelta: number | null = null;
      for await (const event of orchestrator.turn(said)) {
        if (event.type === "text_delta" && firstDelta === null) {
          firstDelta = Date.now() - started;
        }
      }
      expect(firstDelta).not.toBeNull();
      firstDeltaMs.push(firstDelta ?? 0);
    }

    const sorted = [...firstDeltaMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    logger.info({ warmMs, firstDeltaMs, median }, "Companion CLI backend latency");

    expect(median).toBeLessThan(3000);
  }, 180_000);
});
