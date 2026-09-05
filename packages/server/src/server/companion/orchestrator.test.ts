import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError, AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  COMPANION_MODEL,
  CompanionOrchestrator,
  CompanionTurnError,
  type CompanionModelClient,
  type CompanionModelStream,
  type CompanionTurnEvent,
} from "./orchestrator.js";
import { CompanionNotebookStore, companionNotebookPath } from "./store.js";
import { defineCompanionTool, type CompanionTool } from "./tools/index.js";

function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_end",
    type: "message",
    role: "assistant",
    model: COMPANION_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
  };
}

function toolUseMessage(input: {
  text: string;
  toolName: string;
  toolInput: unknown;
}): Anthropic.Message {
  return {
    id: "msg_tool",
    type: "message",
    role: "assistant",
    model: COMPANION_MODEL,
    content: [
      { type: "text", text: input.text, citations: null },
      { type: "tool_use", id: "toolu_1", name: input.toolName, input: input.toolInput },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 } as Anthropic.Usage,
  };
}

function deltaEvents(chunks: readonly string[]): Anthropic.MessageStreamEvent[] {
  return chunks.map((text) => ({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  }));
}

interface ScriptedTurn {
  events: Anthropic.MessageStreamEvent[];
  message: Anthropic.Message;
  /** Held open until the test releases it, to prove deltas do not wait on completion. */
  gate?: Promise<void>;
  error?: Error;
}

interface RecordedRequest {
  params: Anthropic.MessageCreateParamsStreaming;
}

function createScriptedClient(turns: ScriptedTurn[]): {
  client: CompanionModelClient;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const client: CompanionModelClient = {
    stream: (params) => {
      requests.push({ params: { ...params, messages: [...params.messages] } });
      const turn = turns[index];
      index += 1;
      if (!turn) {
        throw new Error("scripted client ran out of turns");
      }
      const stream: CompanionModelStream = {
        async *[Symbol.asyncIterator]() {
          if (turn.error) {
            throw turn.error;
          }
          for (const event of turn.events) {
            yield event;
          }
        },
        finalMessage: async () => {
          await turn.gate;
          return turn.message;
        },
      };
      return stream;
    },
  };
  return { client, requests };
}

describe("CompanionOrchestrator", () => {
  let home: string;
  let notebook: CompanionNotebookStore;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "companion-orchestrator-"));
    notebook = new CompanionNotebookStore({ filePath: companionNotebookPath(home) });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  function createEchoTool(calls: unknown[]): CompanionTool {
    return defineCompanionTool({
      name: "get_agent_status",
      description: "test tool",
      deferred: false,
      schema: z.object({ agentId: z.string().min(1) }),
      handler: async (input) => {
        calls.push(input);
        return { status: "running" };
      },
    });
  }

  async function collect(
    turn: AsyncGenerator<CompanionTurnEvent, void>,
  ): Promise<CompanionTurnEvent[]> {
    const events: CompanionTurnEvent[] = [];
    for await (const event of turn) {
      events.push(event);
    }
    return events;
  }

  it("emits every text delta before the completion, without waiting for the final message", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = createScriptedClient([
      {
        events: deltaEvents(["Three agents ", "are running."]),
        message: textMessage("Three agents are running."),
        gate,
      },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [], notebook });

    const turn = orchestrator.turn("what's running?");
    const seen: CompanionTurnEvent[] = [];

    const first = await turn.next();
    seen.push(first.value as CompanionTurnEvent);
    const second = await turn.next();
    seen.push(second.value as CompanionTurnEvent);

    expect(seen).toEqual([
      { type: "text_delta", text: "Three agents " },
      { type: "text_delta", text: "are running." },
    ]);

    release();
    const third = await turn.next();
    expect(third.value).toEqual({
      type: "completed",
      reply: "Three agents are running.",
      tools: [],
    });
    await expect(turn.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("runs a tool_use turn, feeds the result back, and loops to the spoken answer", async () => {
    const calls: unknown[] = [];
    const tool = createEchoTool(calls);
    const { client, requests } = createScriptedClient([
      {
        events: deltaEvents(["let me look"]),
        message: toolUseMessage({
          text: "let me look",
          toolName: "get_agent_status",
          toolInput: { agentId: "agent-7" },
        }),
      },
      {
        events: deltaEvents([" — it's still running."]),
        message: textMessage(" — it's still running."),
      },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [tool], notebook });

    const events = await collect(orchestrator.turn("how's agent seven?"));

    expect(calls).toEqual([{ agentId: "agent-7" }]);
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
    expect(requests).toHaveLength(2);
    expect(requests[1].params.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: JSON.stringify({ status: "running" }),
        },
      ],
    });
  });

  it("returns a failing tool's error to the model instead of throwing the turn away", async () => {
    const tool = createEchoTool([]);
    const { client, requests } = createScriptedClient([
      {
        events: [],
        message: toolUseMessage({
          text: "checking",
          toolName: "get_agent_status",
          toolInput: { agentId: "" },
        }),
      },
      { events: deltaEvents(["I couldn't find that one."]), message: textMessage("x") },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [tool], notebook });

    await collect(orchestrator.turn("how's it going?"));

    expect(requests[1].params.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "agentId: Too small: expected string to have >=1 characters",
          is_error: true,
        },
      ],
    });
  });

  it("sends the frozen system prompt as a cached prefix and the notebook in the last user turn", async () => {
    await notebook.note({
      id: "release",
      kind: "topic",
      text: "cutting 0.1.21",
      status: "open",
      agentId: null,
    });
    const { client, requests } = createScriptedClient([
      { events: deltaEvents(["sure"]), message: textMessage("sure") },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [], notebook });

    await collect(orchestrator.turn("where are we?"));

    const params = requests[0].params;
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params.max_tokens).toBe(1024);
    expect(params).not.toHaveProperty("thinking");
    expect(Array.isArray(params.system) && params.system[0].cache_control).toEqual({
      type: "ephemeral",
    });
    expect(params.messages).toEqual([
      {
        role: "user",
        content:
          "Your notebook right now:\n- topic (open): cutting 0.1.21\n\nThey said: where are we?",
      },
    ]);
  });

  it("carries the previous turn into the next request and drops the notebook preamble from history", async () => {
    const { client, requests } = createScriptedClient([
      { events: deltaEvents(["three."]), message: textMessage("three.") },
      { events: deltaEvents(["auth and push."]), message: textMessage("auth and push.") },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [], notebook });

    await collect(orchestrator.turn("how many agents?"));
    await collect(orchestrator.turn("which ones?"));

    expect(requests[1].params.messages).toEqual([
      { role: "user", content: "how many agents?" },
      { role: "assistant", content: "three." },
      { role: "user", content: "Your notebook is empty.\n\nThey said: which ones?" },
    ]);
  });

  it.each([
    ["authentication", new AuthenticationError(401, undefined, "bad key", new Headers()), 401],
    ["rate_limit", new RateLimitError(429, undefined, "slow down", new Headers()), 429],
    ["connection", new APIConnectionError({ message: "socket hang up" }), null],
  ])("maps a %s failure to a typed turn error", async (reason, thrown, status) => {
    const { client } = createScriptedClient([
      { events: [], message: textMessage("x"), error: thrown },
    ]);
    const orchestrator = new CompanionOrchestrator({ client, tools: [], notebook });

    const failure = await collect(orchestrator.turn("hello")).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CompanionTurnError);
    expect(failure).toMatchObject({ reason, status });
  });
});
