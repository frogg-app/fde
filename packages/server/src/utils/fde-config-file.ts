import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  FdeConfigRawSchema,
  type FdeConfigRaw,
  type FdeConfigRevision,
  type ProjectConfigRpcError,
} from "@fde/protocol/fde-config-schema";
export {
  FdeConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type FdeConfigRevision,
  type ProjectConfigRpcError,
} from "@fde/protocol/fde-config-schema";

export const FDE_CONFIG_FILE_NAME = "fde.json";

export type ReadFdeConfigForEditResult =
  | { ok: true; config: FdeConfigRaw | null; revision: FdeConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteFdeConfigForEditResult =
  | { ok: true; config: FdeConfigRaw; revision: FdeConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteFdeConfigForEditInput {
  repoRoot: string;
  config: FdeConfigRaw;
  expectedRevision: FdeConfigRevision | null;
}

export function resolveFdeConfigPath(repoRoot: string): string {
  return join(repoRoot, FDE_CONFIG_FILE_NAME);
}

export function statFdeConfigPath(repoRoot: string): FdeConfigRevision | null {
  const configPath = resolveFdeConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    contentHash: hashFdeConfigFile(configPath),
  };
}

export function readFdeConfigJson(repoRoot: string): unknown {
  const configPath = resolveFdeConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readFdeConfigForEdit(repoRoot: string): ReadFdeConfigForEditResult {
  try {
    const json = readFdeConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: FdeConfigRawSchema.parse(json),
      revision: statFdeConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeFdeConfigForEdit(
  input: WriteFdeConfigForEditInput,
): WriteFdeConfigForEditResult {
  const parsed = FdeConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveFdeConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${FDE_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statFdeConfigPath(input.repoRoot);
    if (!fdeConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempFdeConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statFdeConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempFdeConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function fdeConfigRevisionsEqual(
  left: FdeConfigRevision | null,
  right: FdeConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  // Coarse-clock filesystems can hand two consecutive writes the same mtime,
  // so trust the content hash whenever both tokens carry one.
  if (left.contentHash !== undefined && right.contentHash !== undefined) {
    return left.contentHash === right.contentHash;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function hashFdeConfigFile(configPath: string): string {
  return createHash("sha256").update(readFileSync(configPath)).digest("hex");
}

function removeTempFdeConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
