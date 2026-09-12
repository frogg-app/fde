import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { NodeEntrypointSpec } from "../node-entrypoint-launcher.js";
import { assertPathExists } from "../package-paths.js";
import { resolveDaemonBundleRoot, resolveRepositoryRoot } from "../runtime-paths.js";

function cliRoot(): string {
  return app.isPackaged
    ? path.join(resolveDaemonBundleRoot(), "daemon", "apps", "cli")
    : path.join(resolveRepositoryRoot(), "apps", "cli");
}

export function resolveExternalCliEntrypoint(): NodeEntrypointSpec {
  const built = path.join(cliRoot(), "dist", "index.js");
  if (app.isPackaged || existsSync(built))
    return {
      entryPath: assertPathExists({ label: "CLI entrypoint", filePath: built }),
      execArgv: [],
    };
  return {
    entryPath: assertPathExists({
      label: "CLI source",
      filePath: path.join(cliRoot(), "src", "index.ts"),
    }),
    execArgv: ["--import", "tsx"],
  };
}

export function resolvePassthroughCliEntrypoint(): string {
  return assertPathExists({
    label: "CLI runner",
    filePath: path.join(cliRoot(), "dist", "run.js"),
  });
}
