import { brand } from "@fde/branding";
import { brandEnv } from "@fde/branding/identity";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDirectory } from "./private-files.js";

export const FDE_HOME_DIR_NAME = brand.homeDir;

function expandHomeDir(input: string): string {
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input === "~" ? os.homedir() : input;
}

export function resolveConfiguredHome(env: NodeJS.ProcessEnv): string | undefined {
  return brandEnv(brand, env, "HOME");
}

export function resolveFdeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = resolveConfiguredHome(env);
  const home = configured ?? path.join(os.homedir(), FDE_HOME_DIR_NAME);
  const resolved = path.resolve(expandHomeDir(home));
  ensurePrivateDirectory(resolved);
  return resolved;
}
