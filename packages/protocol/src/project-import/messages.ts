import { z } from "zod";

export const PROJECT_IMPORT_LIMITS = {
  files: 2000,
  bytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  chunkBytes: 192 * 1024,
  sessions: 500,
} as const;

export const ProjectImportPrepareRequestSchema = z.object({
  type: z.literal("project.import.prepare.request"),
  requestId: z.string(),
  source: z.enum(["daemon", "client"]),
  cwd: z.string().min(1).max(4096),
  projectId: z.string().optional(),
  conversationDirectory: z.string().max(4096).optional(),
});
export const ProjectImportUploadRequestSchema = z.object({
  type: z.literal("project.import.upload.request"),
  requestId: z.string(),
  importId: z.string(),
  path: z.string().min(1).max(1024),
  kind: z.enum(["code", "conversation"]),
  offset: z.number().int().min(0).max(PROJECT_IMPORT_LIMITS.fileBytes),
  contentBase64: z.string().max((PROJECT_IMPORT_LIMITS.chunkBytes * 4) / 3 + 4),
  complete: z.boolean(),
});
export const ProjectImportPreviewRequestSchema = z.object({
  type: z.literal("project.import.preview.request"),
  requestId: z.string(),
  importId: z.string(),
});
export const ProjectImportCommitRequestSchema = z.object({
  type: z.literal("project.import.commit.request"),
  requestId: z.string(),
  importId: z.string(),
  sessionIds: z.array(z.string()).max(PROJECT_IMPORT_LIMITS.sessions),
});
export const ProjectImportSessionSchema = z.object({
  id: z.string(),
  provider: z.string(),
  title: z.string(),
  sourcePath: z.string(),
  mode: z.enum(["resumable", "transcript"]),
  alreadyImportedAgentId: z.string().nullable(),
  messageCount: z.number().int().nullable(),
});
const ResultSchema = z.object({
  requestId: z.string(),
  error: z.string().nullable(),
  importId: z.string().optional(),
  cwd: z.string().optional(),
  projectId: z.string().nullable().optional(),
  workspaceId: z.string().optional(),
  sessions: z.array(ProjectImportSessionSchema).optional(),
  fileCount: z.number().optional(),
  totalBytes: z.number().optional(),
  importedAgentIds: z.array(z.string()).optional(),
  importedTranscriptIds: z.array(z.string()).optional(),
  skippedTranscriptIds: z.array(z.string()).optional(),
  skippedAgentIds: z.array(z.string()).optional(),
  failures: z.array(z.object({ sessionId: z.string(), error: z.string() })).optional(),
});
export const ProjectImportPrepareResponseSchema = z.object({
  type: z.literal("project.import.prepare.response"),
  payload: ResultSchema,
});
export const ProjectImportUploadResponseSchema = z.object({
  type: z.literal("project.import.upload.response"),
  payload: ResultSchema,
});
export const ProjectImportPreviewResponseSchema = z.object({
  type: z.literal("project.import.preview.response"),
  payload: ResultSchema,
});
export const ProjectImportCommitResponseSchema = z.object({
  type: z.literal("project.import.commit.response"),
  payload: ResultSchema,
});
export type ProjectImportSession = z.infer<typeof ProjectImportSessionSchema>;
export type ProjectImportResult = z.infer<typeof ResultSchema>;
export type ProjectImportPrepareRequest = z.infer<typeof ProjectImportPrepareRequestSchema>;
export type ProjectImportUploadRequest = z.infer<typeof ProjectImportUploadRequestSchema>;
export const ProjectImportCancelRequestSchema = z.object({
  type: z.literal("project.import.cancel.request"),
  requestId: z.string(),
  importId: z.string(),
});
export const ProjectImportCancelResponseSchema = z.object({
  type: z.literal("project.import.cancel.response"),
  payload: ResultSchema,
});
export const ProjectImportListRequestSchema = z.object({
  type: z.literal("project.import.list.request"),
  requestId: z.string(),
  projectId: z.string(),
});
export const ProjectImportReadRequestSchema = z.object({
  type: z.literal("project.import.read.request"),
  requestId: z.string(),
  projectId: z.string(),
  id: z.string(),
  offset: z.number().int().min(0).optional(),
});
export const ProjectImportListResponseSchema = z.object({
  type: z.literal("project.import.list.response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
    conversations: z
      .array(z.object({ id: z.string(), provider: z.string(), title: z.string() }))
      .optional(),
  }),
});
export const ProjectImportReadResponseSchema = z.object({
  type: z.literal("project.import.read.response"),
  payload: z.object({
    requestId: z.string(),
    error: z.string().nullable(),
    title: z.string().optional(),
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() }))
      .optional(),
    nextOffset: z.number().nullable().optional(),
  }),
});
export type ProjectImportCommitRequest = z.infer<typeof ProjectImportCommitRequestSchema>;
