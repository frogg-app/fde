import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CompanionDeferredJobs } from "../deferred-jobs.js";
import { CompanionNotebookStore, companionNotebookPath } from "../store.js";
import { createCompanionThinkingTools } from "./thinking.js";
import {
  COMPANION_TOOL_NAMES,
  createCompanionNotebookTool,
  invokeCompanionTool,
  toAnthropicTools,
  type CompanionTool,
} from "./index.js";

describe("companion tools", () => {
  let home: string;
  let notebook: CompanionNotebookStore;
  let deferredJobs: CompanionDeferredJobs;
  let tools: CompanionTool[];

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "companion-tools-"));
    notebook = new CompanionNotebookStore({
      filePath: companionNotebookPath(home),
      now: () => new Date("2025-01-01T00:00:00.000Z"),
    });
    let counter = 0;
    deferredJobs = new CompanionDeferredJobs({
      run: async () => "an answer",
      logger: { warn: () => {} },
      idFactory: () => `job-${(counter += 1)}`,
    });
    tools = createCompanionThinkingTools({ deferredJobs });
  });

  afterEach(async () => {
    await deferredJobs.drain();
    await rm(home, { recursive: true, force: true });
  });

  it("declares every deferred tool with an object input schema Anthropic accepts", () => {
    expect(toAnthropicTools(tools)).toEqual([
      {
        name: "think",
        description: tools[0].description,
        input_schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["question", "label"],
          properties: {
            question: { type: "string", minLength: 1 },
            label: {
              type: "string",
              minLength: 1,
              description: "Three or four words naming the work, for the UI.",
            },
          },
        },
      },
      {
        name: "read_timeline",
        description: tools[1].description,
        input_schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["agentId", "question", "label"],
          properties: {
            agentId: { type: "string", minLength: 1 },
            question: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1 },
          },
        },
      },
      {
        name: "research",
        description: tools[2].description,
        input_schema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          required: ["question", "label"],
          properties: {
            question: { type: "string", minLength: 1 },
            label: { type: "string", minLength: 1 },
          },
        },
      },
    ]);
  });

  it("names every tool in the catalog constant", () => {
    for (const tool of tools) {
      expect(COMPANION_TOOL_NAMES).toContain(tool.name);
    }
  });

  it("returns a job id immediately from a deferred tool", async () => {
    await expect(
      invokeCompanionTool(tools, "think", {
        question: "why is the push test flaky?",
        label: "the flaky test",
      }),
    ).resolves.toEqual({
      ok: true,
      content: JSON.stringify({ status: "started", jobId: "job-1" }),
    });
    expect(deferredJobs.get("job-1")?.question).toBe("why is the push test flaky?");
  });

  it("rejects input that does not match the schema without starting a job", async () => {
    await expect(invokeCompanionTool(tools, "read_timeline", { agentId: "" })).resolves.toEqual({
      ok: false,
      error:
        "agentId: Too small: expected string to have >=1 characters; question: Invalid input: expected string, received undefined; label: Invalid input: expected string, received undefined",
    });
    expect(deferredJobs.listRunning()).toEqual([]);
  });

  it("reports an unknown tool instead of throwing", async () => {
    await expect(invokeCompanionTool(tools, "summon_dragon", {})).resolves.toEqual({
      ok: false,
      error: "Unknown tool summon_dragon",
    });
  });

  it("writes the notebook through the note tool and defaults its status to open", async () => {
    const catalog = [createCompanionNotebookTool(notebook)];

    await expect(
      invokeCompanionTool(catalog, "note", {
        id: "release",
        kind: "topic",
        text: "cutting 0.1.21",
      }),
    ).resolves.toEqual({ ok: true, content: JSON.stringify({ noteCount: 1 }) });

    await expect(notebook.get()).resolves.toEqual({
      notes: [
        {
          id: "release",
          kind: "topic",
          text: "cutting 0.1.21",
          status: "open",
          agentId: null,
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
  });
});
