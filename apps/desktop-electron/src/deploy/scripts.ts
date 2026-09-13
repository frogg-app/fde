import { installers } from "@frogg/branding/installers";
import type { DeployMethod } from "./args.js";
export function deployScript(method: DeployMethod, uninstall = false): string {
  const name = `/${uninstall ? "uninstall" : "install"}${method === "docker" ? "-docker" : ""}.sh`;
  const script = installers[name];
  if (!script?.startsWith("#!/usr/bin/env bash\n"))
    throw new Error(`Missing branded deployment script: ${name}`);
  return script;
}
