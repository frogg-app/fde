import { brand } from "@frogg/branding";
import { brandEnv } from "@frogg/branding/identity";
import os from "node:os";
import path from "node:path";
import {
  findLegacyFdeSettings,
  formatLegacyFdeSettings,
  migrateLegacyFdeHome,
  type LegacyFdeHomeMigration,
} from "./legacy-fde-migration.js";
import { ensurePrivateDirectory } from "./private-files.js";

export const FROGG_HOME_DIR_NAME = brand.homeDir;

function expandHomeDir(input: string): string {
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input === "~" ? os.homedir() : input;
}

export function resolveConfiguredHome(env: NodeJS.ProcessEnv): string | undefined {
  return brandEnv(brand, env, "HOME");
}

export function resolveFroggHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = resolveConfiguredHome(env);
  const home = configured ?? path.join(os.homedir(), FROGG_HOME_DIR_NAME);
  const resolved = path.resolve(expandHomeDir(home));
  ensurePrivateDirectory(resolved);
  return resolved;
}

/**
 * Run before anything touches the home: moves an FDE home into place on the default Frogg
 * home and warns about FDE_ settings. A configured home or another brand is left alone.
 */
export function prepareFroggHome(
  env: NodeJS.ProcessEnv = process.env,
  write: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): LegacyFdeHomeMigration {
  const warning = brand.legacyFrogg ? formatLegacyFdeSettings(findLegacyFdeSettings(env)) : null;
  if (warning) write(warning);
  if (!brand.legacyFrogg || resolveConfiguredHome(env) !== undefined) {
    return { status: "not-needed" };
  }
  const result = migrateLegacyFdeHome(path.join(os.homedir(), FROGG_HOME_DIR_NAME), {
    log: write,
  });
  if (result.status === "skipped") write(`Skipped FDE home migration: ${result.reason}`);
  return result;
}
