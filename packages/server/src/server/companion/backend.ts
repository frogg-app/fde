/**
 * The seam between the Companion's turn loop and whatever is actually
 * generating the words. Two things sit under it: the Anthropic Messages API,
 * and a Claude Code CLI session driven through the agent SDK. It is stated in
 * the Companion's own vocabulary — text deltas, tool calls, tool results — so
 * neither backend's wire format leaks upwards.
 */

export type CompanionBackendKind = "api" | "cli";

export interface CompanionTurnMessage {
  role: "user" | "assistant";
  text: string;
}

export interface CompanionBackendToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface CompanionBackendToolResult {
  id: string;
  content: string;
  isError: boolean;
}

/**
 * `tool_started` is only emitted by a backend that runs the tool itself. A
 * backend that hands tool calls back for the loop to run stays silent and lets
 * the orchestrator announce them as it dispatches.
 */
export type CompanionBackendEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; name: string };

export interface CompanionBackendResponse {
  /** Calls the loop must run and feed to the next `respond`. Empty ends the turn. */
  toolCalls: readonly CompanionBackendToolCall[];
}

export interface CompanionBackendTurnInput {
  /** The user text for this turn, notebook preamble already applied. */
  text: string;
  /** Prior turns, oldest first. Backends that hold their own session ignore it. */
  history: readonly CompanionTurnMessage[];
}

export interface CompanionBackendTurn {
  /**
   * Stream the next assistant response. `toolResults` answers the calls the
   * previous `respond` returned; the first call of a turn passes none.
   */
  respond(
    toolResults: readonly CompanionBackendToolResult[],
  ): AsyncGenerator<CompanionBackendEvent, CompanionBackendResponse>;
}

export interface CompanionBackend {
  readonly kind: CompanionBackendKind;
  /**
   * Pay any cold start now, at session open, so no conversational turn ever
   * does. The API backend has nothing to warm; the CLI backend has seconds of it.
   */
  warm(): Promise<void>;
  beginTurn(input: CompanionBackendTurnInput): CompanionBackendTurn;
  close(): Promise<void>;
}

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
