import {
  createSdkMcpServer,
  tool,
  type Options,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import { claudeQuery, type ClaudeQueryFactory } from "../../agent/providers/claude/query.js";
import {
  CompanionTurnError,
  type CompanionBackend,
  type CompanionBackendEvent,
  type CompanionBackendResponse,
  type CompanionBackendToolResult,
  type CompanionBackendTurn,
  type CompanionBackendTurnInput,
} from "../backend.js";
import { COMPANION_SYSTEM_PROMPT } from "../system-prompt.js";
import { invokeCompanionTool, type CompanionTool } from "../tools/index.js";

const MCP_SERVER_NAME = "companion";
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Matches the API path's tool-round bound so a confused model cannot spin. */
const MAX_TURNS = 4;

/**
 * The turn paid at session open. Its only job is to walk the whole path once —
 * process spawn, harness init, MCP connect, first model request — so the first
 * thing the user says is answered by a session that has already done all of it.
 */
const WARM_PROMPT =
  "This is the session opening, not the user speaking. Reply with the single word: ready.";

interface CompanionCliTurnChannel {
  emit(event: CompanionBackendEvent): void;
  settle(error: CompanionTurnError | null): void;
  drain(): AsyncGenerator<CompanionBackendEvent, void>;
  /** The consumer walked away (barge-in). Events keep arriving and are dropped. */
  abandon(): void;
}

function createTurnChannel(): CompanionCliTurnChannel {
  const buffer: CompanionBackendEvent[] = [];
  let settled = false;
  let failure: CompanionTurnError | null = null;
  let abandoned = false;
  let wake: (() => void) | null = null;

  function signal(): void {
    const pending = wake;
    wake = null;
    pending?.();
  }

  return {
    emit(event) {
      if (abandoned) {
        return;
      }
      buffer.push(event);
      signal();
    },
    settle(error) {
      settled = true;
      failure = error;
      signal();
    },
    abandon() {
      abandoned = true;
      buffer.length = 0;
      signal();
    },
    async *drain() {
      for (;;) {
        const next = buffer.shift();
        if (next) {
          yield next;
          continue;
        }
        if (settled) {
          if (failure) {
            throw failure;
          }
          return;
        }
        if (abandoned) {
          return;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

interface CompanionCliInput {
  send(text: string): void;
  stream: AsyncIterable<SDKUserMessage>;
  end(): void;
}

function createInputStream(): CompanionCliInput {
  const queue: SDKUserMessage[] = [];
  let closed = false;
  let wake: (() => void) | null = null;

  function signal(): void {
    const pending = wake;
    wake = null;
    pending?.();
  }

  async function* stream(): AsyncGenerator<SDKUserMessage, void> {
    for (;;) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  return {
    send(text) {
      queue.push({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: text },
      });
      signal();
    },
    stream: stream(),
    end() {
      closed = true;
      signal();
    },
  };
}

/**
 * The CLI reports an API failure inside a successful transcript rather than by
 * throwing, so the status on the result is the only signal for why a turn died.
 */
function toCliTurnError(message: SDKResultMessage): CompanionTurnError | null {
  if (message.subtype === "success" && !message.is_error) {
    return null;
  }
  const status = message.subtype === "success" ? (message.api_error_status ?? null) : null;
  const detail = message.subtype === "success" ? message.result : message.subtype;
  if (status === 401 || status === 403) {
    return new CompanionTurnError("authentication", detail, status);
  }
  if (status === 429) {
    return new CompanionTurnError("rate_limit", detail, status);
  }
  return new CompanionTurnError("api", detail, status);
}

function toSdkTools(tools: readonly CompanionTool[]) {
  return tools.map((companionTool) =>
    tool(
      companionTool.name,
      companionTool.description,
      companionTool.inputShape,
      async (input: unknown) => {
        const result = await invokeCompanionTool(tools, companionTool.name, input);
        return {
          content: [{ type: "text" as const, text: result.ok ? result.content : result.error }],
          ...(result.ok ? {} : { isError: true }),
        };
      },
    ),
  );
}

export interface CompanionCliBackendOptions {
  model: string;
  tools: readonly CompanionTool[];
  cwd: string;
  logger: Logger;
  /** Injected in tests so no CLI process is spawned. */
  queryFactory?: ClaudeQueryFactory;
}

/**
 * The no-key path: one persistent Claude Code session per Companion session,
 * driven through the agent SDK in streaming-input mode.
 *
 * The CLI runs its own tool loop, so the Companion's catalog is mounted as an
 * in-process MCP server whose handlers call `invokeCompanionTool` — the same
 * function the API path's loop calls, so tool behaviour cannot diverge between
 * backends; only declaration and dispatch do. Feeding results back through the
 * loop instead would mean fabricating `tool_result` user messages the harness
 * does not accept from an SDK client.
 */
export function createCompanionCliBackend(options: CompanionCliBackendOptions): CompanionBackend {
  const logger = options.logger.child({ component: "companion-cli-backend" });
  const promptInput = createInputStream();
  const queryOptions: Options = {
    model: options.model,
    systemPrompt: COMPANION_SYSTEM_PROMPT,
    includePartialMessages: true,
    tools: [],
    skills: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    maxTurns: MAX_TURNS,
    cwd: options.cwd,
    mcpServers: {
      [MCP_SERVER_NAME]: createSdkMcpServer({
        name: MCP_SERVER_NAME,
        version: "1.0.0",
        tools: toSdkTools(options.tools),
      }),
    },
  };

  const session: Query = claudeQuery(
    { prompt: promptInput.stream, options: queryOptions },
    options.queryFactory ? { queryFactory: options.queryFactory } : {},
  );

  let active: CompanionCliTurnChannel | null = null;
  let pumpFailure: CompanionTurnError | null = null;

  function settleActive(error: CompanionTurnError | null): void {
    const settling = active;
    active = null;
    settling?.settle(error);
  }

  function route(message: SDKMessage): void {
    if (message.type === "stream_event") {
      if (message.parent_tool_use_id !== null) {
        return;
      }
      const event = message.event;
      if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
        active?.emit({
          type: "tool_started",
          name: event.content_block.name.replace(MCP_TOOL_PREFIX, ""),
        });
      }
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        active?.emit({ type: "text_delta", text: event.delta.text });
      }
      return;
    }
    if (message.type === "result") {
      settleActive(toCliTurnError(message));
    }
  }

  const pump = (async () => {
    try {
      for await (const message of session) {
        route(message);
      }
    } catch (error) {
      const failure = new CompanionTurnError(
        "connection",
        error instanceof Error ? error.message : String(error),
        null,
      );
      pumpFailure = failure;
      logger.warn({ err: error }, "Companion CLI session ended");
      settleActive(failure);
    }
  })();

  function speak(text: string): CompanionCliTurnChannel {
    if (pumpFailure) {
      throw pumpFailure;
    }
    const channel = createTurnChannel();
    active = channel;
    promptInput.send(text);
    return channel;
  }

  async function warm(): Promise<void> {
    const started = Date.now();
    const drain = speak(WARM_PROMPT).drain();
    for (;;) {
      const next = await drain.next();
      if (next.done) {
        break;
      }
    }
    logger.info({ elapsedMs: Date.now() - started }, "Companion CLI session warmed");
  }

  function beginTurn(input: CompanionBackendTurnInput): CompanionBackendTurn {
    async function* respond(
      toolResults: readonly CompanionBackendToolResult[],
    ): AsyncGenerator<CompanionBackendEvent, CompanionBackendResponse> {
      if (toolResults.length > 0) {
        throw new Error("The CLI backend runs its own tool loop and never asks for tool results");
      }
      const channel = speak(input.text);
      try {
        yield* channel.drain();
      } finally {
        channel.abandon();
        if (active === channel) {
          await session.interrupt();
        }
      }
      return { toolCalls: [] };
    }

    return { respond };
  }

  async function close(): Promise<void> {
    active?.abandon();
    active = null;
    promptInput.end();
    await pump;
  }

  return { kind: "cli", warm, beginTurn, close };
}
