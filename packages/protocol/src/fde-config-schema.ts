import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const FdeServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const FdeLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const FdeScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const FdeWorktreeConfigRawSchema = z
  .object({
    setup: FdeLifecycleCommandRawSchema.optional(),
    teardown: FdeLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: FdeServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const FdeMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const FdeMetadataGenerationSchema = z
  .object({
    title: FdeMetadataGenerationEntrySchema.optional(),
    branchName: FdeMetadataGenerationEntrySchema.optional(),
    commitMessage: FdeMetadataGenerationEntrySchema.optional(),
    pullRequest: FdeMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy fde.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const FdeConfigRawSchema = z
  .object({
    worktree: FdeWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), FdeScriptEntryRawSchema).optional(),
    metadataGeneration: FdeMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = FdeWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = FdeScriptEntryRawSchema.catch({});

export const FdeConfigSchema = FdeConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: FdeMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

// Filesystem timestamps are too coarse on their own: tmpfs and other
// coarse-clock filesystems can stamp two consecutive writes with the same
// mtime, so a same-size edit would slip past the stale-write guard. The
// content hash is the authoritative part of the token; mtime and size remain
// for display and for tokens minted by older clients.
export const FdeConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  contentHash: z.string().optional(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: FdeConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type FdeScriptEntryRaw = z.infer<typeof FdeScriptEntryRawSchema>;
export type FdeMetadataGenerationEntry = z.infer<typeof FdeMetadataGenerationEntrySchema>;
export type FdeMetadataGeneration = z.infer<typeof FdeMetadataGenerationSchema>;
export type FdeServicePortAllocation = z.infer<typeof FdeServicePortAllocationSchema>;
export type FdeConfigRaw = z.infer<typeof FdeConfigRawSchema>;
export type FdeConfig = z.infer<typeof FdeConfigSchema>;
export type FdeConfigRevision = z.infer<typeof FdeConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
