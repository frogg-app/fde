import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const FroggServicePortAllocationSchema = z
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

export const FroggLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const FroggScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const FroggWorktreeConfigRawSchema = z
  .object({
    setup: FroggLifecycleCommandRawSchema.optional(),
    teardown: FroggLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: FroggServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const FroggMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const FroggMetadataGenerationSchema = z
  .object({
    title: FroggMetadataGenerationEntrySchema.optional(),
    branchName: FroggMetadataGenerationEntrySchema.optional(),
    commitMessage: FroggMetadataGenerationEntrySchema.optional(),
    pullRequest: FroggMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy frogg.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const FroggConfigRawSchema = z
  .object({
    worktree: FroggWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), FroggScriptEntryRawSchema).optional(),
    metadataGeneration: FroggMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = FroggWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = FroggScriptEntryRawSchema.catch({});

export const FroggConfigSchema = FroggConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: FroggMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

// Filesystem timestamps are too coarse on their own: tmpfs and other
// coarse-clock filesystems can stamp two consecutive writes with the same
// mtime, so a same-size edit would slip past the stale-write guard. The
// content hash is the authoritative part of the token; mtime and size remain
// for display and for tokens minted by older clients.
export const FroggConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  contentHash: z.string().optional(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: FroggConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type FroggScriptEntryRaw = z.infer<typeof FroggScriptEntryRawSchema>;
export type FroggMetadataGenerationEntry = z.infer<typeof FroggMetadataGenerationEntrySchema>;
export type FroggMetadataGeneration = z.infer<typeof FroggMetadataGenerationSchema>;
export type FroggServicePortAllocation = z.infer<typeof FroggServicePortAllocationSchema>;
export type FroggConfigRaw = z.infer<typeof FroggConfigRawSchema>;
export type FroggConfig = z.infer<typeof FroggConfigSchema>;
export type FroggConfigRevision = z.infer<typeof FroggConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
