import os from "node:os";
import path from "node:path";
import { brand } from "@fde/branding";
import { brandEnv } from "@fde/branding/identity";

export function resolvePaseoHome(env: NodeJS.ProcessEnv): string {
  const configured = brandEnv(brand, env, "HOME") || path.join(os.homedir(), brand.homeDir);
  return path.resolve(
    configured === "~" ? os.homedir() : configured.replace(/^~[/\\]/, `${os.homedir()}${path.sep}`),
  );
}
