import { homedir } from "node:os";
import path from "node:path";

/**
 * The FDE home directory as the daemon resolves it, without creating anything:
 * `FDE_HOME`, then the legacy `PASEO_HOME`, then `~/.fde`. Mirrors
 * `resolveFdeHome` in `@fde/server` for the CLI's read-only path lookups.
 */
export const FDE_HOME_DIR_NAME = ".fde";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function expandHomeDir(input: string): string {
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input === "~" ? homedir() : input;
}

export function resolveFdeHomePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = nonEmpty(env.FDE_HOME) ?? nonEmpty(env.PASEO_HOME);
  return path.resolve(expandHomeDir(configured ?? path.join(homedir(), FDE_HOME_DIR_NAME)));
}
