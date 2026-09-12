import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { brandIdentity } from "@fde/branding";
import { createBundledDaemonService } from "./bundle-service.js";
import {
  resolveDaemonBundleRoot,
  resolveDaemonRunnerEntrypoint,
  resolveNodeExecPath,
  resolveRepositoryRoot,
} from "./runtime-paths.js";
import { resolveExternalCliEntrypoint } from "./cli/entrypoints.js";
import { resolveDesktopAppVersion, restartDaemon } from "./daemon-manager.js";

const platform = process.platform === "win32" ? "win" : process.platform;

async function inspect(): Promise<{ version: string; path: string }> {
  const root = app.isPackaged ? resolveDaemonBundleRoot() : resolveRepositoryRoot();
  const version = resolveDesktopAppVersion();
  if (app.isPackaged) {
    const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const identity = manifest.brand as Record<string, unknown> | undefined;
    if (
      !identity ||
      identity.id !== brandIdentity.id ||
      identity.applicationId !== brandIdentity.applicationId
    )
      throw new Error("Bundled daemon belongs to another product.");
    if (manifest.platform !== platform || manifest.arch !== process.arch)
      throw new Error("Bundled daemon does not match this platform and architecture.");
    if (manifest.version !== version)
      throw new Error(
        "Bundled daemon version does not match this Electron app. Reinstall the app.",
      );
    if (!(await stat(resolveNodeExecPath())).isFile())
      throw new Error("Bundled Node runtime is missing.");
  }
  for (const entry of [resolveDaemonRunnerEntrypoint(), resolveExternalCliEntrypoint()]) {
    if (!(await stat(entry.entryPath)).isFile())
      throw new Error(`Bundled daemon entrypoint is missing: ${entry.entryPath}`);
  }
  return { version, path: root };
}

export const bundledDaemon = createBundledDaemonService({
  inspect,
  currentVersion: resolveDesktopAppVersion,
  platform,
  arch: process.arch,
  restart: restartDaemon,
});
