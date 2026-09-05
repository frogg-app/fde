import Anthropic from "@anthropic-ai/sdk";

import { COMPANION_SYSTEM_PROMPT } from "./system-prompt.js";
import type { CompanionNotebookStore } from "./store.js";
import {
  invokeCompanionTool,
  toAnthropicTools,
  type CompanionTool,
  type CompanionToolName,
} from "./tools/index.js";

/** The exact model. Never date-suffixed: the suffixed ids are a training artefact. */
export const COMPANION_MODEL = "claude-haiku-4-5";

const MAX_TOKENS = 1024;

/** Conversational turns kept in context. Anything older lives in the notebook. */
const HISTORY_LIMIT = 12;

/** Bound on tool round-trips inside one turn, so a confused model cannot spin. */
const MAX_TOOL_ROUNDS = 4;

/**
 * The `available: true` branch of `CompanionModelConfig` from `anthropic-config.ts`.
 * Structural on purpose: the orchestrator needs a key, a URL and a model, and
 * nothing about how they were resolved.
 */
export interface CompanionModelSettings {
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

export interface CompanionModelStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage: () => Promise<Anthropic.Message>;
}

/** The seam the turn loop talks to. `client.messages` satisfies it directly. */
export interface CompanionModelClient {
  stream: (params: Anthropic.MessageCreateParamsStreaming) => CompanionModelStream;
}

export function createCompanionModelClient(settings: CompanionModelSettings): CompanionModelClient {
  const client = new Anthropic({
    apiKey: settings.apiKey,
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
  });
  return { stream: (params) => client.messages.stream(params) };
}

/**
 * What one conversational turn emits.
 *
 * `text_delta` events arrive while the model is still generating — the speech
 * track cuts them at clause boundaries and starts talking long before
 * `completed` lands. Nothing downstream may wait for `completed` to speak.
 */
export type CompanionTurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; name: CompanionToolName; deferred: boolean }
  | { type: "completed"; reply: string; tools: CompanionToolName[] };

export type CompanionTurnFailureReason = "authentication" | "rate_limit" | "api" | "connection";

export class CompanionTurnError extends Error {
  readonly reason: CompanionTurnFailureReason;
  readonly status: number | null;

  constructor(reason: CompanionTurnFailureReason, message: string, status: number | null) {
    super(message);
    this.name = "CompanionTurnError";
    this.reason = reason;
    this.status = status;
  }
}

function toTurnError(error: unknown): CompanionTurnError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new CompanionTurnError("authentication", error.message, error.status);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new CompanionTurnError("rate_limit", error.message, error.status);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new CompanionTurnError("connection", error.message, null);
  }
  if (error instanceof Anthropic.APIError) {
    return new CompanionTurnError("api", error.message, error.status ?? null);
  }
  throw error;
}

interface CompanionHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CompanionOrchestratorOptions {
  client: CompanionModelClient;
  tools: readonly CompanionTool[];
  notebook: CompanionNotebookStore;
  model?: string;
}

/**
 * The conversational brain. Owns the rolling window, the tool loop, and the
 * cached prompt prefix; owns no audio and no persistence beyond the notebook.
 */
export class CompanionOrchestrator {
  private readonly client: CompanionModelClient;
  private readonly tools: readonly CompanionTool[];
  private readonly notebook: CompanionNotebookStore;
  private readonly model: string;
  private readonly history: CompanionHistoryTurn[] = [];

  constructor(options: CompanionOrchestratorOptions) {
    this.client = options.client;
    this.tools = options.tools;
    this.notebook = options.notebook;
    this.model = options.model ?? COMPANION_MODEL;
  }

  /**
   * Run one turn. `text` is a final transcript, or the synthetic user turn a
   * settled deferred job re-enters with.
   */
  async *turn(text: string): AsyncGenerator<CompanionTurnEvent, void> {
    const notebook = await this.notebook.promptText();
    const messages = this.buildMessages(text, notebook);
    const invoked: CompanionToolName[] = [];
    let reply = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const message = yield* this.streamOnce(messages, (delta) => {
        reply += delta;
      });
      messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason !== "tool_use") {
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") {
          continue;
        }
        const tool = this.tools.find((candidate) => candidate.name === block.name);
        if (tool) {
          invoked.push(tool.name);
          yield { type: "tool_started", name: tool.name, deferred: tool.deferred };
        }
        const result = await invokeCompanionTool(this.tools, block.name, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.ok ? result.content : result.error,
          ...(result.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: "user", content: results });
    }

    this.remember(text, reply);
    yield { type: "completed", reply, tools: invoked };
  }

  private async *streamOnce(
    messages: Anthropic.MessageParam[],
    onDelta: (delta: string) => void,
  ): AsyncGenerator<CompanionTurnEvent, Anthropic.Message> {
    const stream = this.client.stream({
      model: this.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: [
        {
          type: "text",
          text: COMPANION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: toAnthropicTools(this.tools),
      messages,
    });

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          onDelta(event.delta.text);
          yield { type: "text_delta", text: event.delta.text };
        }
      }
      return await stream.finalMessage();
    } catch (error) {
      throw toTurnError(error);
    }
  }

  private buildMessages(text: string, notebook: string): Anthropic.MessageParam[] {
    const preamble = notebook ? `Your notebook right now:\n${notebook}` : "Your notebook is empty.";
    return [
      ...this.history.map((entry) => ({ role: entry.role, content: entry.text })),
      { role: "user" as const, content: `${preamble}\n\nThey said: ${text}` },
    ];
  }

  private remember(userText: string, reply: string): void {
    this.history.push({ role: "user", text: userText });
    if (reply) {
      this.history.push({ role: "assistant", text: reply });
    }
    const excess = this.history.length - HISTORY_LIMIT;
    if (excess > 0) {
      this.history.splice(0, excess);
    }
    if (this.history[0]?.role === "assistant") {
      this.history.shift();
    }
  }
}
