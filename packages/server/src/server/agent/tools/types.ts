import type { z } from "zod";

export interface FdeToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: FdeToolResult) => void;
}

export interface FdeToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface FdeToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface FdeToolDefinition extends FdeToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: FdeToolExecutionContext) => Promise<FdeToolResult>;
}

export interface FdeToolCatalog {
  tools: ReadonlyMap<string, FdeToolDefinition>;
  getTool(name: string): FdeToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: FdeToolExecutionContext,
  ): Promise<FdeToolResult>;
}

export interface FdeToolRuntimeContext {
  callerAgentId?: string;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type FdeToolCatalogFactory = (
  context: FdeToolRuntimeContext,
) => FdeToolCatalog | Promise<FdeToolCatalog>;
