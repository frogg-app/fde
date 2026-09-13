import {
  type CompanionBackend,
  type CompanionBackendToolCall,
  type CompanionBackendToolResult,
  type CompanionBackendTurn,
  type CompanionTurnMessage,
} from "./backend.js";
import { createCompanionApiBackend, type CompanionModelClient } from "./backends/api.js";
import type { CompanionNotebookStore } from "./store.js";
import { invokeCompanionTool, type CompanionTool, type CompanionToolName } from "./tools/index.js";

export {
  CompanionTurnError,
  type CompanionBackend,
  type CompanionBackendKind,
  type CompanionTurnFailureReason,
} from "./backend.js";
export {
  createCompanionModelClient,
  type CompanionModelClient,
  type CompanionModelSettings,
  type CompanionModelStream,
} from "./backends/api.js";

/** The exact model. Never date-suffixed: the suffixed ids are a training artefact. */
export const COMPANION_MODEL = "claude-haiku-4-5";

/** Conversational turns kept in context. Anything older lives in the notebook. */
const HISTORY_LIMIT = 12;
const HISTORY_CHARACTER_LIMIT = 12000;
const MESSAGE_CHARACTER_LIMIT = 4000;

/** Bound on tool round-trips inside one turn, so a confused model cannot spin. */
const MAX_TOOL_ROUNDS = 4;

/**
 * What one conversational turn emits.
 *
 * `text_delta` events arrive while the model is still generating — the speech
 * track can speak at clause boundaries. Quiet conversations instead wait for
 * the final tool round, so dispatch narration never reaches the speaker.
 */
export type CompanionTurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; name: CompanionToolName; deferred: boolean }
  | { type: "completed"; reply: string; tools: CompanionToolName[] };

interface CompanionOrchestratorBase {
  instructions?: string;
  tools: readonly CompanionTool[];
  notebook: CompanionNotebookStore;
}

/**
 * Either a backend, or an Anthropic client as shorthand for the API one.
 */
export type CompanionOrchestratorOptions =
  | (CompanionOrchestratorBase & { backend: CompanionBackend })
  | (CompanionOrchestratorBase & { client: CompanionModelClient; model?: string });

/**
 * The conversational brain. Owns the rolling window and the tool loop; owns no
 * audio, no wire format, and no persistence beyond the notebook.
 */
export class CompanionOrchestrator {
  private readonly backend: CompanionBackend;
  private readonly tools: readonly CompanionTool[];
  private readonly notebook: CompanionNotebookStore;
  private readonly history: CompanionTurnMessage[] = [];
  private readonly instructions: string;

  constructor(options: CompanionOrchestratorOptions) {
    this.instructions = options.instructions ?? "";
    this.tools = options.tools;
    this.notebook = options.notebook;
    this.backend =
      "backend" in options
        ? options.backend
        : createCompanionApiBackend({
            client: options.client,
            tools: options.tools,
            model: options.model ?? COMPANION_MODEL,
          });
  }

  /**
   * Run one turn. `text` is a final transcript, or the synthetic user turn a
   * settled deferred job re-enters with.
   */
  async *turn(
    text: string,
    /**
     * What the user has actually heard so far, if the caller can tell us.
     *
     * A barge-in abandons this generator part-way, and the exchange still has
     * to reach the history or the Companion has no record it ever spoke -- it
     * would repeat itself, and answer "what was that last thing?" with nothing.
     * Recording the generated reply instead would overshoot the other way,
     * leaving it certain it said sentences that never reached a speaker. This
     * is the same reconciliation OpenAI's `conversation.item.truncate`
     * performs, arriving from the opposite direction; see
     * docs/companion-voice-design.md.
     */
    heardSoFar?: () => string,
    signal?: AbortSignal,
  ): AsyncGenerator<CompanionTurnEvent, void> {
    const notebook = await this.notebook.promptText();
    const preamble = notebook ? `Your notebook right now:\n${notebook}` : "Your notebook is empty.";
    const backendTurn = this.backend.beginTurn({
      text: `${preamble}${this.instructions ? `\n${this.instructions}` : ""}\n\nThey said: ${text}`,
      history: this.history,
      signal,
    });

    const invoked: CompanionToolName[] = [];
    let reply = "";
    let toolResults: CompanionBackendToolResult[] = [];
    let remembered = false;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        if (signal?.aborted) return;
        const response = yield* this.streamRound(backendTurn, toolResults, invoked, (delta) => {
          reply += delta;
        });
        if (response.length === 0) {
          break;
        }
        toolResults = [];
        for (const call of response) {
          if (signal?.aborted) return;
          const tool = this.tools.find((candidate) => candidate.name === call.name);
          if (tool) {
            invoked.push(tool.name);
            yield { type: "tool_started", name: tool.name, deferred: tool.deferred };
          }
          const result = await invokeCompanionTool(this.tools, call.name, call.input);
          toolResults.push({
            id: call.id,
            content: result.ok ? result.content : result.error,
            isError: !result.ok,
          });
        }
      }

      remembered = true;
      this.remember(text, reply);
      yield { type: "completed", reply, tools: invoked };
    } finally {
      // Reached on an abandoned generator too: `.return()` unwinds through here.
      if (!remembered) {
        this.remember(text, heardSoFar ? heardSoFar() : reply);
      }
    }
  }

  /**
   * One assistant response. A backend that runs its own tool loop announces
   * tools here instead of handing them back, so both paths emit the same
   * `tool_started` events in the same order.
   */
  private async *streamRound(
    backendTurn: CompanionBackendTurn,
    toolResults: readonly CompanionBackendToolResult[],
    invoked: CompanionToolName[],
    onDelta: (delta: string) => void,
  ): AsyncGenerator<CompanionTurnEvent, readonly CompanionBackendToolCall[]> {
    const responses = backendTurn.respond(toolResults);
    try {
      for (;;) {
        const next = await responses.next();
        if (next.done) {
          return next.value.toolCalls;
        }
        const event = next.value;
        if (event.type === "text_delta") {
          onDelta(event.text);
          yield { type: "text_delta", text: event.text };
          continue;
        }
        const tool = this.tools.find((candidate) => candidate.name === event.name);
        if (tool) {
          invoked.push(tool.name);
          yield { type: "tool_started", name: tool.name, deferred: tool.deferred };
        }
      }
    } finally {
      await responses.return({ toolCalls: [] });
    }
  }

  reconcileLastReply(text: string): void {
    if (this.history.at(-1)?.role === "assistant") this.history.pop();
    if (text)
      this.history.push({ role: "assistant", text: text.slice(0, MESSAGE_CHARACTER_LIMIT) });
  }

  private remember(userText: string, reply: string): void {
    this.history.push({ role: "user", text: userText.slice(0, MESSAGE_CHARACTER_LIMIT) });
    if (reply) {
      this.history.push({ role: "assistant", text: reply.slice(0, MESSAGE_CHARACTER_LIMIT) });
    }
    const excess = this.history.length - HISTORY_LIMIT;
    if (excess > 0) {
      this.history.splice(0, excess);
    }
    let characters = this.history.reduce((total, entry) => total + entry.text.length, 0);
    while (characters > HISTORY_CHARACTER_LIMIT) {
      characters -= this.history.shift()!.text.length;
    }
    if (this.history[0]?.role === "assistant") {
      this.history.shift();
    }
  }
}
