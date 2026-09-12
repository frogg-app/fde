export function resolveCliInstallSourcePath(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  executablePath: string;
  shimPath: string;
  appImagePath?: string | null;
}): string {
  if (input.platform === "win32") {
    return input.shimPath;
  }

  if (!input.isPackaged) {
    return input.shimPath;
  }

  if (input.platform === "darwin") {
    return input.shimPath;
  }

  if (input.platform === "linux") return input.shimPath;

  return input.executablePath;
}
