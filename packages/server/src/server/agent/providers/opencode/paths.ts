import path from "node:path";

import { resolveFroggHome } from "../../../frogg-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveFroggHome(env), OPENCODE_HOME_DIRNAME);
}
