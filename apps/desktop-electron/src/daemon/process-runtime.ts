import { spawn, type SpawnOptions } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { brand } from "@fde/branding";
import { brandEnv } from "@fde/branding/identity";

// Keep the shell independent of the daemon's ESM entrypoint and native addons.
// The CLI owns legacy home migration and directory creation.
export function resolvePaseoHome(env: NodeJS.ProcessEnv): string {
  const configured = brandEnv(brand, env, "HOME") || path.join(os.homedir(), brand.homeDir);
  return path.resolve(
    configured === "~" ? os.homedir() : configured.replace(/^~[/\\]/, `${os.homedir()}${path.sep}`),
  );
}

export function spawnProcess(
  command: string,
  args: string[],
  options: SpawnOptions & {
    envMode?: "internal";
    envOverlay?: NodeJS.ProcessEnv;
  },
) {
  const { envMode: _mode, envOverlay, ...rest } = options;
  return spawn(command, args, {
    ...rest,
    windowsHide: true,
    env: { ...options.env, ...envOverlay },
  });
}
