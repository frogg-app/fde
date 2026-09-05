import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { CompanionTurnError } from "../backend.js";
import { CompanionOrchestrator, type CompanionTurnEvent } from "../orchestrator.js";
import { CompanionNotebookStore, companionNotebookPath } from "../store.js";
import { defineCompanionTool, type CompanionTool } from "../tools/index.js";
import { createCompanionCliBackend, type CompanionCliSession } from "./cli.js";

const logger = pino({ level: "silent" });

function textDelta(text: string): BetaRawMessageStreamEvent {
  return { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
}

function toolStart(name: string): BetaRawMessageStreamEvent {
  return {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
  };
}

function streamEvent(event: BetaRawMessageStreamEvent): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "session-1",
  };
}

function successResult(text: string): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: text,
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0 },
      service_tier: null,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000002",
    session_id: "session-1",
  };
}

function rateLimitedResult(): SDKMessage {
  return { ...successResult("rate limited"), is_error: true, api_error_status: 429 };
}

interface ScriptedCliTurn {
  events: BetaRawMessageStreamEvent[];
  result: SDKMessage;
  /** Held open until the test releases it, to prove deltas do not wait on it. */
  gate?: Promise<void>;
}

interface ScriptedCliSession {
  session: CompanionCliSession;
  prompts: string[];
  /** Mutable so the harness can read the count after the backend interrupts. */
  counts: { interrupts: number };
}

/**
 * Replays scripted turns against the prompts the backend sends, the way the CLI
 * does: stream events first, then exactly one result per turn.
 */
function createScriptedSession(
  turns: ScriptedCliTurn[],
  prompt: AsyncIterable<SDKUserMessage>,
): ScriptedCliSession {
  const prompts: string[] = [];
  const counts = { interrupts: 0 };

  async function* messages(): AsyncGenerator<SDKMessage, void> {
    let index = 0;
    for await (const message of prompt) {
      const content = message.message.content;
      prompts.push(typeof content === "string" ? content : JSON.stringify(content));
      const turn = turns[index];
      index += 1;
      if (!turn) {
        throw new Error("scripted CLI session ran out of turns");
      }
      for (const event of turn.events) {
        yield streamEvent(event);
      }
      await turn.gate;
      yield turn.result;
    }
  }

  const session: CompanionCliSession = {
    [Symbol.asyncIterator]: () => messages()[Symbol.asyncIterator](),
    interrupt: async () => {
      counts.interrupts += 1;
    },
  };
  return { session, prompts, counts };
}

describe("createCompanionCliBackend", () => {
  let home: string;
  let notebook: CompanionNotebookStore;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "companion-cli-backend-"));
    notebook = new CompanionNotebookStore({ filePath: companionNotebookPath(home) });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  function createBackend(turns: ScriptedCliTurn[], tools: readonly CompanionTool[] = []) {
    let scripted: ScriptedCliSession | null = null;
    const backend = createCompanionCliBackend({
      model: "claude-haiku-4-5",
      tools,
      cwd: home,
      logger,
      startSession: (input) => {
        if (typeof input.prompt === "string") {
          throw new Error("the CLI backend must drive the session in streaming-input mode");
        }
        scripted = createScriptedSession(turns, input.prompt);
        return scripted.session;
      },
    });
    return {
      backend,
      prompts: () => scripted?.prompts ?? [],
      interrupts: () => scripted?.counts.interrupts ?? 0,
    };
  }

  async function collect(turn: AsyncGenerator<CompanionTurnEvent, void>) {
    const events: CompanionTurnEvent[] = [];
    for await (const event of turn) {
      events.push(event);
    }
    return events;
  }

  it("keeps partial messages on, so deltas arrive before the turn completes", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { backend } = createBackend([
      { events: [textDelta("ready")], result: successResult("ready") },
      {
        events: [textDelta("Three agents "), textDelta("are running.")],
        result: successResult("Three agents are running."),
        gate,
      },
    ]);
    await backend.warm();

    const turn = backend.beginTurn({ text: "what's running?", history: [] }).respond([]);
    const seen = [await turn.next(), await turn.next()];

    expect(seen.map((step) => step.value)).toEqual([
      { type: "text_delta", text: "Three agents " },
      { type: "text_delta", text: "are running." },
    ]);

    release();
    await expect(turn.next()).resolves.toEqual({ done: true, value: { toolCalls: [] } });
    await backend.close();
  });

  it("pays the cold start on warm and asks the model for nothing the user hears", async () => {
    const { backend, prompts } = createBackend([
      { events: [textDelta("ready")], result: successResult("ready") },
      { events: [textDelta("hello")], result: successResult("hello") },
    ]);

    await backend.warm();
    expect(prompts()).toEqual([
      "This is the session opening, not the user speaking. Reply with the single word: ready.",
    ]);

    const orchestrator = new CompanionOrchestrator({ backend, tools: [], notebook });
    const events = await collect(orchestrator.turn("hi"));

    expect(events).toEqual([
      { type: "text_delta", text: "hello" },
      { type: "completed", reply: "hello", tools: [] },
    ]);
    expect(prompts()[1]).toBe("Your notebook is empty.\n\nThey said: hi");
    await backend.close();
  });

  it("announces the tools the CLI runs itself, under their Companion names", async () => {
    const tool = defineCompanionTool({
      name: "get_agent_status",
      description: "test tool",
      deferred: false,
      schema: z.object({ agentId: z.string().min(1) }),
      handler: async () => ({ status: "running" }),
    });
    const { backend } = createBackend(
      [
        { events: [], result: successResult("ready") },
        {
          events: [
            textDelta("let me look"),
            toolStart("mcp__companion__get_agent_status"),
            textDelta(" — it's still running."),
          ],
          result: successResult("let me look — it's still running."),
        },
      ],
      [tool],
    );
    await backend.warm();

    const orchestrator = new CompanionOrchestrator({ backend, tools: [tool], notebook });
    const events = await collect(orchestrator.turn("how's agent seven?"));

    expect(events).toEqual([
      { type: "text_delta", text: "let me look" },
      { type: "tool_started", name: "get_agent_status", deferred: false },
      { type: "text_delta", text: " — it's still running." },
      {
        type: "completed",
        reply: "let me look — it's still running.",
        tools: ["get_agent_status"],
      },
    ]);
    await backend.close();
  });

  it("maps a rate-limited turn to the same typed error the API path raises", async () => {
    const { backend } = createBackend([
      { events: [], result: successResult("ready") },
      { events: [], result: rateLimitedResult() },
    ]);
    await backend.warm();

    const orchestrator = new CompanionOrchestrator({ backend, tools: [], notebook });
    const failure = await collect(orchestrator.turn("hello")).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompanionTurnError);
    expect(failure).toMatchObject({ reason: "rate_limit", status: 429 });
    await backend.close();
  });

  it("interrupts the CLI when the listener walks away mid-turn", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { backend, interrupts } = createBackend([
      { events: [], result: successResult("ready") },
      { events: [textDelta("well, ")], result: successResult("well, actually"), gate },
    ]);
    await backend.warm();

    const turn = backend.beginTurn({ text: "stop", history: [] }).respond([]);
    await turn.next();
    await turn.return({ toolCalls: [] });

    expect(interrupts()).toBe(1);
    release();
    await backend.close();
  });
});
