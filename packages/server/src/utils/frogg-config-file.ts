import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  FroggConfigRawSchema,
  type FroggConfigRaw,
  type FroggConfigRevision,
  type ProjectConfigRpcError,
} from "@frogg/protocol/frogg-config-schema";
export {
  FroggConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type FroggConfigRevision,
  type ProjectConfigRpcError,
} from "@frogg/protocol/frogg-config-schema";

export const FROGG_CONFIG_FILE_NAME = "frogg.json";

export type ReadFroggConfigForEditResult =
  | { ok: true; config: FroggConfigRaw | null; revision: FroggConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteFroggConfigForEditResult =
  | { ok: true; config: FroggConfigRaw; revision: FroggConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteFroggConfigForEditInput {
  repoRoot: string;
  config: FroggConfigRaw;
  expectedRevision: FroggConfigRevision | null;
}

export function resolveFroggConfigPath(repoRoot: string): string {
  return join(repoRoot, FROGG_CONFIG_FILE_NAME);
}

export function statFroggConfigPath(repoRoot: string): FroggConfigRevision | null {
  const configPath = resolveFroggConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
    contentHash: hashFroggConfigFile(configPath),
  };
}

export function readFroggConfigJson(repoRoot: string): unknown {
  const configPath = resolveFroggConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readFroggConfigForEdit(repoRoot: string): ReadFroggConfigForEditResult {
  try {
    const json = readFroggConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: FroggConfigRawSchema.parse(json),
      revision: statFroggConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeFroggConfigForEdit(
  input: WriteFroggConfigForEditInput,
): WriteFroggConfigForEditResult {
  const parsed = FroggConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveFroggConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${FROGG_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statFroggConfigPath(input.repoRoot);
    if (!froggConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempFroggConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statFroggConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempFroggConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function froggConfigRevisionsEqual(
  left: FroggConfigRevision | null,
  right: FroggConfigRevision | null,
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

function hashFroggConfigFile(configPath: string): string {
  return createHash("sha256").update(readFileSync(configPath)).digest("hex");
}

function removeTempFroggConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
