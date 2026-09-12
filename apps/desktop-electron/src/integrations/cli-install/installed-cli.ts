import { promises as fs } from "node:fs";

const WINDOWS_MARKER = "rem FDE Electron managed CLI launcher";
export function windowsCliLauncher(shimPath: string): string {
  if (/[\r\n"]/.test(shimPath)) throw new Error("Unsupported CLI launcher path");
  return [
    "@echo off",
    WINDOWS_MARKER,
    "setlocal DisableDelayedExpansion",
    `set "BUNDLED_CLI=${shimPath.replace(/%/g, "%%")}"`,
    'if not exist "%BUNDLED_CLI%" (',
    "  echo Bundled CLI not found. Reinstall the desktop application. 1>&2",
    "  exit /b 1",
    ")",
    'call "%BUNDLED_CLI%" %*',
    "exit /b %errorlevel%",
    "",
  ].join("\r\n");
}

export async function installedCliMatches(input: {
  platform: NodeJS.Platform;
  targetPath: string;
  sourcePath: string;
}): Promise<boolean> {
  try {
    await fs.access(input.sourcePath);
    if (input.platform === "win32") {
      return (await fs.readFile(input.targetPath, "utf8")) === windowsCliLauncher(input.sourcePath);
    }
    return (await fs.realpath(input.targetPath)) === (await fs.realpath(input.sourcePath));
  } catch {
    return false;
  }
}

export async function assertReplaceableCli(targetPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile() && (await fs.readFile(targetPath, "utf8")).includes(WINDOWS_MARKER)) return;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `An unrelated CLI already exists at ${targetPath}. Move it before installing the desktop CLI.`,
  );
}
