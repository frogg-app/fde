import { z } from "zod";

export const EXECUTION_PROTOCOL_VERSION = 1;
export const executionDescriptorSchema = z.object({
  protocolVersion: z.literal(EXECUTION_PROTOCOL_VERSION),
  instanceId: z.string().uuid(),
  pid: z.number().int().positive(),
  version: z.string().min(1),
  startedAt: z.string(),
  port: z.number().int().min(1).max(65535),
  controlPort: z.number().int().min(1).max(65535),
  token: z.string().min(32),
});
export type ExecutionServiceDescriptor = z.infer<typeof executionDescriptorSchema>;
export const executionLifecycleSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.enum(["shutdown", "restart"]),
  reason: z.string(),
});
export const executionStatusSchema = executionDescriptorSchema.omit({ token: true }).extend({
  residentAgentCount: z.number().int().nonnegative(),
  lifecycle: executionLifecycleSchema.nullable(),
});
export type ExecutionServiceStatus = z.infer<typeof executionStatusSchema>;
