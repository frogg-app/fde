import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";

import {
  CompanionTurnError,
  type CompanionBackend,
  type CompanionBackendEvent,
  type CompanionBackendResponse,
  type CompanionBackendToolCall,
  type CompanionBackendToolResult,
  type CompanionBackendTurn,
  type CompanionBackendTurnInput,
} from "../backend.js";
import { COMPANION_SYSTEM_PROMPT } from "../system-prompt.js";
import type { CompanionTool } from "../tools/index.js";

const MAX_TOKENS = 1024;

/** Key, URL and model, and nothing about how they were resolved. */
export interface CompanionModelSettings {
  apiKey: string;
  baseUrl: string | null;
  model: string;
}

export interface CompanionModelStream extends AsyncIterable<Anthropic.MessageStreamEvent> {
  finalMessage: () => Promise<Anthropic.Message>;
}

/** The Anthropic half of the seam. `client.messages` satisfies it directly. */
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

function toTurnError(error: unknown): CompanionTurnError {
  if (error instanceof AuthenticationError) {
    return new CompanionTurnError("authentication", error.message, error.status);
  }
  if (error instanceof RateLimitError) {
    return new CompanionTurnError("rate_limit", error.message, error.status);
  }
  if (error instanceof APIConnectionError) {
    return new CompanionTurnError("connection", error.message, null);
  }
  if (error instanceof APIError) {
    return new CompanionTurnError("api", error.message, error.status ?? null);
  }
  throw error;
}

export function toAnthropicTools(tools: readonly CompanionTool[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

function toResultBlock(result: CompanionBackendToolResult): Anthropic.ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: result.id,
    content: result.content,
    ...(result.isError ? { is_error: true } : {}),
  };
}

function toToolCalls(message: Anthropic.Message): CompanionBackendToolCall[] {
  if (message.stop_reason !== "tool_use") {
    return [];
  }
  const calls: CompanionBackendToolCall[] = [];
  for (const block of message.content) {
    if (block.type === "tool_use") {
      calls.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return calls;
}

export interface CompanionApiBackendOptions {
  client: CompanionModelClient;
  tools: readonly CompanionTool[];
  model: string;
}

/**
 * The fast path. The system prompt is sent as a cached prefix and the volatile
 * notebook rides the last user turn, so the cached prefix keeps hitting.
 */
export function createCompanionApiBackend(options: CompanionApiBackendOptions): CompanionBackend {
  const tools = toAnthropicTools(options.tools);

  function beginTurn(input: CompanionBackendTurnInput): CompanionBackendTurn {
    const messages: Anthropic.MessageParam[] = [
      ...input.history.map((entry) => ({ role: entry.role, content: entry.text })),
      { role: "user" as const, content: input.text },
    ];

    async function* respond(
      toolResults: readonly CompanionBackendToolResult[],
    ): AsyncGenerator<CompanionBackendEvent, CompanionBackendResponse> {
      if (toolResults.length > 0) {
        messages.push({ role: "user", content: toolResults.map(toResultBlock) });
      }
      const stream = options.client.stream({
        model: options.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        system: [
          {
            type: "text",
            text: COMPANION_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        tools,
        messages,
      });

      let message: Anthropic.Message;
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text_delta", text: event.delta.text };
          }
        }
        message = await stream.finalMessage();
      } catch (error) {
        throw toTurnError(error);
      }
      messages.push({ role: "assistant", content: message.content });
      return { toolCalls: toToolCalls(message) };
    }

    return { respond };
  }

  return {
    kind: "api",
    warm: async () => {},
    beginTurn,
    close: async () => {},
  };
}
