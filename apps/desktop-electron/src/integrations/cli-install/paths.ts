import { app } from "electron";
import { brand } from "@fde/branding";
import { resolveRepositoryRoot, resolveDaemonBundleRoot } from "../../daemon/runtime-paths.js";
import path from "node:path";
import os from "node:os";

export function getLocalBinDir(): string {
  return path.join(os.homedir(), ".local", "bin");
}

export function getCliTargetPath(): string {
  const filename = process.platform === "win32" ? `${brand.cliName}.cmd` : brand.cliName;
  return path.join(getLocalBinDir(), filename);
}

export function getBundledCliShimPath(): string {
  if (!app.isPackaged) {
    // npm owns the development workspace shim; its name is the CLI package bin key.
    return path.join(
      resolveRepositoryRoot(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "fde.cmd" : "fde",
    );
  }
  const filename = process.platform === "win32" ? `${brand.cliName}.cmd` : brand.cliName;
  return path.join(resolveDaemonBundleRoot(), "bin", filename);
}
