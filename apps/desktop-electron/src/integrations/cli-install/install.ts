import { promises as fs } from "node:fs";
import { app } from "electron";
import log from "electron-log/main";
import { resolveCliInstallSourcePath } from "./path.js";
import { getBundledCliShimPath, getCliTargetPath, getLocalBinDir } from "./paths.js";
import { ensurePathInShellRc } from "./shell-rc.js";
import { assertReplaceableCli, installedCliMatches, windowsCliLauncher } from "./installed-cli.js";
import { ensureWindowsUserPath, windowsUserPathContains } from "./windows-path.js";

interface InstallStatus {
  installed: boolean;
}

function installSource(): string {
  return resolveCliInstallSourcePath({
    platform: process.platform,
    isPackaged: app.isPackaged,
    executablePath: app.getPath("exe"),
    shimPath: getBundledCliShimPath(),
    appImagePath: process.env.APPIMAGE,
  });
}

export async function installCli(): Promise<InstallStatus> {
  if (!app.isPackaged)
    throw new Error(
      "CLI installation is available in packaged desktop builds. Use the repository CLI during development.",
    );
  const targetPath = getCliTargetPath();
  const sourcePath = installSource();
  // Never remove a working CLI before verifying its replacement exists.
  await fs.access(sourcePath);
  await assertReplaceableCli(targetPath);
  await fs.mkdir(getLocalBinDir(), { recursive: true });
  await fs.rm(targetPath, { force: true });
  if (process.platform === "win32") {
    await fs.writeFile(targetPath, windowsCliLauncher(sourcePath), "utf8");
    ensureWindowsUserPath({ directory: getLocalBinDir() });
  } else {
    await fs.symlink(sourcePath, targetPath);
    const { shellUpdated } = await ensurePathInShellRc();
    if (shellUpdated) log.info("[integrations] Updated shell rc with ~/.local/bin PATH");
  }
  return getCliInstallStatus();
}

export async function getCliInstallStatus(): Promise<InstallStatus> {
  if (!app.isPackaged) return { installed: false };
  if (process.platform === "win32" && !windowsUserPathContains(getLocalBinDir()))
    return { installed: false };
  return {
    installed: await installedCliMatches({
      platform: process.platform,
      targetPath: getCliTargetPath(),
      sourcePath: installSource(),
    }),
  };
}
