import { brand } from "@frogg/branding";
import { brandEnv } from "@frogg/branding/identity";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The Frogg home directory as the daemon resolves it, without creating anything:
 * `FROGG_HOME`, then `~/.frogg`. Mirrors
 * `resolveFroggHome` in `@frogg/server` for the CLI's read-only path lookups.
 */
export const FROGG_HOME_DIR_NAME = brand.homeDir;

export function expandHomeDir(input: string): string {
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input === "~" ? homedir() : input;
}

export function resolveFroggHomePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = brandEnv(brand, env, "HOME");
  return path.resolve(expandHomeDir(configured ?? path.join(homedir(), FROGG_HOME_DIR_NAME)));
}
