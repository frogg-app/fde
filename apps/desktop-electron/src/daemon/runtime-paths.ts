import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { brandIdentity } from "@fde/branding";
import { stageDaemonBundle } from "./bundle-staging.js";
import { assertPathExists } from "./package-paths.js";
import type {
  NodeEntrypointArgvMode,
  NodeEntrypointInvocation,
  NodeEntrypointSpec,
} from "./node-entrypoint-launcher.js";

export function resolveDaemonBundleRoot(): string {
  if (app.isPackaged && process.env.APPIMAGE) {
    return path.join(app.getPath("userData"), "daemon-bundles", app.getVersion());
  }
  return path.join(process.resourcesPath, "daemon-bundle");
}

export async function prepareDaemonBundle(): Promise<void> {
  if (!app.isPackaged || !process.env.APPIMAGE) return;
  await stageDaemonBundle({
    source: path.join(process.resourcesPath, "daemon-bundle"),
    destination: resolveDaemonBundleRoot(),
    identity: {
      version: app.getVersion(),
      platform: process.platform === "win32" ? "win" : process.platform,
      arch: process.arch,
      brand: brandIdentity,
    },
  });
}

export function resolveRepositoryRoot(): string {
  // app.getAppPath is stable whether modules are emitted separately or bundled.
  return path.resolve(app.getAppPath(), "..", "..");
}

export function resolveDaemonRunnerEntrypoint(): NodeEntrypointSpec {
  const root = app.isPackaged
    ? path.join(resolveDaemonBundleRoot(), "daemon", "packages", "server")
    : path.join(resolveRepositoryRoot(), "packages", "server");
  const built = path.join(root, "dist", "scripts", "supervisor-entrypoint.js");
  if (app.isPackaged || existsSync(built)) {
    return {
      entryPath: assertPathExists({
        label: "Daemon supervisor",
        filePath: built,
      }),
      execArgv: [],
    };
  }
  return {
    entryPath: assertPathExists({
      label: "Daemon supervisor source",
      filePath: path.join(root, "scripts", "supervisor-entrypoint.ts"),
    }),
    execArgv: ["--import", "tsx"],
  };
}

export function resolveNodeExecPath(): string {
  return app.isPackaged
    ? assertPathExists({
        label: "Bundled Node runtime",
        filePath: path.join(
          resolveDaemonBundleRoot(),
          "node",
          process.platform === "win32" ? "node.exe" : "bin/node",
        ),
      })
    : process.env.FDE_NODE_EXECUTABLE || "node";
}

export function createNodeEntrypointInvocation(input: {
  entrypoint: NodeEntrypointSpec;
  argvMode: NodeEntrypointArgvMode;
  args: string[];
  baseEnv: NodeJS.ProcessEnv;
}): NodeEntrypointInvocation {
  const env: NodeJS.ProcessEnv = {
    ...input.baseEnv,
    FDE_NODE_ENV: app.isPackaged ? "production" : "development",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return {
    command: resolveNodeExecPath(),
    args: [...input.entrypoint.execArgv, input.entrypoint.entryPath, ...input.args],
    env,
  };
}
