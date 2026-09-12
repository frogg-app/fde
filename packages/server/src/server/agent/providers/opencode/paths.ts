import path from "node:path";

import { resolveFdeHome } from "../../../fde-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFdeHome(env), OPENCODE_HOME_DIRNAME);
}
