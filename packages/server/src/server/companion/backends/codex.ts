import { spawn } from "node:child_process";
import { z } from "zod";
import type { Logger } from "pino";
import { CodexAppServerClient } from "../../agent/providers/codex/app-server-transport.js";
import { resolveProviderLaunch } from "../../agent/provider-launch-config.js";
import { COMPANION_SYSTEM_PROMPT } from "../system-prompt.js";
import { invokeCompanionTool, type CompanionTool } from "../tools/index.js";
import {
  CompanionTurnError,
  type CompanionBackend,
  type CompanionBackendEvent,
  type CompanionBackendTurnInput,
} from "../backend.js";

export interface CompanionCodexOptions {
  model: string;
  tools: readonly CompanionTool[];
  cwd: string;
  logger: Logger;
  signal?: AbortSignal;
}

const ThreadSchema = z.object({ thread: z.object({ id: z.string() }) });
const EventSchema = z.object({
  threadId: z.string(),
  delta: z.string().optional(),
  turnId: z.string().optional(),
  turn: z.object({ id: z.string(), status: z.string(), error: z.unknown().optional() }).optional(),
});

/** Dedicated app-server process: workers and their permissions stay in AgentManager. */
export async function openCompanionCodex(
  options: CompanionCodexOptions,
): Promise<CodexAppServerClient> {
  const launch = await resolveProviderLaunch({ defaultBinary: "codex" });
  options.signal?.throwIfAborted();
  const child = spawn(launch.command, [...launch.args, "app-server"], {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, OPENAI_API_KEY: undefined },
  });
  const client = new CodexAppServerClient(child, options.logger);
  const cancelStartup = () => {
    void client.dispose();
  };
  options.signal?.addEventListener("abort", cancelStartup, { once: true });
  try {
    await client.request(
      "initialize",
      {
        clientInfo: { name: "fde_companion", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      },
      10000,
    );
    client.notify("initialized");
    const account = z
      .object({ account: z.object({ type: z.string() }).nullable() })
      .parse(await client.request("account/read", {}, 10000));
    if (account.account?.type !== "chatgpt")
      throw new CompanionTurnError(
        "authentication",
        "Sign in to Codex with ChatGPT to use subscription Companion.",
        null,
      );
    options.signal?.throwIfAborted();
    return client;
  } catch (error) {
    await client.dispose();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelStartup);
  }
}

export function companionCodexThreadParams(options: CompanionCodexOptions) {
  return {
    model: options.model,
    cwd: options.cwd,
    ephemeral: true,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: {
      model_reasoning_effort: "low",
      web_search: "disabled",
      mcp_servers: {},
      "features.shell_tool": false,
      "features.unified_exec": false,
      "features.apps": false,
      "features.plugins": false,
      "features.browser_use": false,
      "features.computer_use": false,
      "features.multi_agent": false,
      "features.image_generation": false,
      "features.view_image": false,
      "features.skip_host_skill_discovery": true,
    },
    baseInstructions: `${COMPANION_SYSTEM_PROMPT}\nUse only the supplied Companion tools. Delegate all project work. Do not run shell commands or edit files yourself.`,
    dynamicTools: options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}

export function installCompanionCodexTools(
  client: CodexAppServerClient,
  tools: readonly CompanionTool[],
  onTool?: (name: string) => void,
): void {
  const calls = new Map<
    string,
    Promise<{ success: boolean; contentItems: { type: "inputText"; text: string }[] }>
  >();
  client.setRequestHandler("item/tool/call", async (params) => {
    const call = z
      .object({ tool: z.string(), arguments: z.unknown(), callId: z.string() })
      .parse(params);
    const previous = calls.get(call.callId);
    if (previous) return previous;
    const task = (async () => {
      onTool?.(call.tool);
      const result = await invokeCompanionTool(tools, call.tool, call.arguments);
      return {
        success: result.ok,
        contentItems: [
          { type: "inputText" as const, text: result.ok ? result.content : result.error },
        ],
      };
    })();
    calls.set(call.callId, task);
    return task;
  });
}

export function createCompanionCodexBackend(options: CompanionCodexOptions): CompanionBackend {
  const startup = new AbortController();
  let client: CodexAppServerClient | null = null;
  let closed = false;
  let activeThread: string | null = null;
  let exchanges = 0;
  let previousReply: string | null = null;
  let wasInterrupted = false;
  let ready: Promise<void> | null = null;
  let abandon: (() => void) | null = null;
  async function warm(): Promise<void> {
    ready ??= (async () => {
      const opened = await openCompanionCodex({ ...options, signal: startup.signal });
      if (closed) {
        await opened.dispose();
        throw new Error("Companion closed");
      }
      client = opened;
      activeThread = ThreadSchema.parse(
        await opened.request("thread/start", companionCodexThreadParams(options), 20000),
      ).thread.id;
    })();
    await ready;
  }
  async function ensureThread(
    rpc: CodexAppServerClient,
    input: CompanionBackendTurnInput,
  ): Promise<void> {
    const heard = input.history.at(-1);
    const repair =
      previousReply !== null && (heard?.role !== "assistant" || heard.text !== previousReply);
    if (activeThread && (exchanges >= 6 || wasInterrupted || repair)) {
      await rpc
        .request("thread/unsubscribe", { threadId: activeThread }, 2000)
        .catch(() => undefined);
      activeThread = null;
      exchanges = 0;
    }
    activeThread ??= ThreadSchema.parse(
      await rpc.request("thread/start", companionCodexThreadParams(options), 20000),
    ).thread.id;
  }
  return {
    kind: "codex",
    warm,
    beginTurn(input) {
      return {
        async *respond() {
          await warm();
          const rpc = client;
          if (!rpc || input.signal?.aborted) return { toolCalls: [] };
          await ensureThread(rpc, input);
          const thread = { id: z.string().parse(activeThread) };
          let reply = "";
          const events: CompanionBackendEvent[] = [];
          let done = false;
          let failure: Error | null = null;
          let turnId: string | undefined;
          let wake: (() => void) | null = null;
          const isDone = () => done;
          const push = (event: CompanionBackendEvent) => {
            if (!done) {
              events.push(event);
              wake?.();
            }
          };
          const cancel = () => {
            done = true;
            events.length = 0;
            wake?.();
            if (turnId)
              void rpc
                .request("turn/interrupt", { threadId: thread.id, turnId }, 2000)
                .catch(() => undefined);
          };
          abandon = cancel;
          input.signal?.addEventListener("abort", cancel, { once: true });
          rpc.setUnexpectedTerminationHandler((error) => {
            failure = error;
            done = true;
            wake?.();
          });
          rpc.setNotificationHandler((method, params) => {
            const parsed = EventSchema.safeParse(params);
            if (!parsed.success || parsed.data.threadId !== thread.id) return;
            const event = parsed.data;
            if (method === "turn/started") {
              turnId = event.turn?.id;
              if (input.signal?.aborted) cancel();
            }
            if (method === "item/agentMessage/delta" && event.delta) {
              reply += event.delta;
              push({ type: "text_delta", text: event.delta });
            }
            if (method === "turn/completed") {
              if (event.turn?.status === "failed")
                failure = new CompanionTurnError("api", "Codex turn failed", null);
              done = true;
              wake?.();
            }
          });
          installCompanionCodexTools(rpc, options.tools, (name) =>
            push({ type: "tool_started", name }),
          );
          const timer = setTimeout(() => {
            failure = new CompanionTurnError("connection", "Codex turn timed out", null);
            cancel();
          }, 60000);
          try {
            if (input.signal?.aborted) return { toolCalls: [] };
            const context =
              exchanges === 0
                ? input.history.map((item) => `${item.role}: ${item.text}`).join("\n")
                : "";
            await rpc.request(
              "turn/start",
              {
                threadId: thread.id,
                input: [{ type: "text", text: `${context}\n${input.text}` }],
              },
              20000,
            );
            while (events.length || !isDone()) {
              const event = events.shift();
              if (event) yield event;
              else
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
            }
            if (failure && !input.signal?.aborted) throw failure;
          } finally {
            clearTimeout(timer);
            input.signal?.removeEventListener("abort", cancel);
            cancel();
            abandon = null;
            exchanges += 1;
            previousReply = reply;
            wasInterrupted = input.signal?.aborted === true;
          }
          return { toolCalls: [] };
        },
      };
    },
    async close() {
      closed = true;
      startup.abort();
      abandon?.();
      const rpc = client;
      client = null;
      await rpc?.dispose();
    },
  };
}
