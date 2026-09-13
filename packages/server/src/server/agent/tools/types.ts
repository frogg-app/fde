import type { z } from "zod";

export interface FroggToolExecutionContext {
  signal?: AbortSignal;
  sendUpdate?: (update: FroggToolResult) => void;
}

export interface FroggToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface FroggToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape;
}

export interface FroggToolDefinition extends FroggToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: FroggToolExecutionContext) => Promise<FroggToolResult>;
}

export interface FroggToolCatalog {
  tools: ReadonlyMap<string, FroggToolDefinition>;
  getTool(name: string): FroggToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: FroggToolExecutionContext,
  ): Promise<FroggToolResult>;
}

export interface FroggToolRuntimeContext {
  callerAgentId?: string;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type FroggToolCatalogFactory = (
  context: FroggToolRuntimeContext,
) => FroggToolCatalog | Promise<FroggToolCatalog>;
