import { app } from "electron";
import { execFileSync } from "node:child_process";
import path from "node:path";
import log from "electron-log/main";

export function configureDesktopProcess(APP_NAME: string, profileName = APP_NAME): string | null {
  app.setName(APP_NAME);

  // In dev mode, detect git worktrees and isolate each instance so multiple
  // Electron windows can run side-by-side (separate userData = separate lock).
  app.setPath("userData", path.join(app.getPath("appData"), profileName));
  let devWorktreeName: string | null = null;
  const forcedUserDataDir =
    process.env.FROGG_ELECTRON_USER_DATA?.trim() ||
    process.env.FROGG_ELECTRON_USER_DATA_DIR?.trim();
  if (forcedUserDataDir) {
    app.setPath("userData", forcedUserDataDir);
    log.info("[dev-user-data] forced userData dir:", forcedUserDataDir);
  } else if (!app.isPackaged) {
    try {
      const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf-8",
        timeout: 3000,
        windowsHide: true,
      }).trim();
      devWorktreeName = path.basename(topLevel);
      // Main checkout (e.g. "frogg") gets default userData — only worktrees diverge.
      const commonDir = path.resolve(
        topLevel,
        execFileSync("git", ["rev-parse", "--git-common-dir"], {
          cwd: topLevel,
          encoding: "utf-8",
          timeout: 3000,
          windowsHide: true,
        }).trim(),
      );
      const isWorktree = path.resolve(topLevel, ".git") !== commonDir;
      if (isWorktree) {
        app.setPath(
          "userData",
          path.join(app.getPath("appData"), `${profileName}-${devWorktreeName}`),
        );
        log.info("[worktree] isolated userData for worktree:", devWorktreeName);
      } else {
        devWorktreeName = null;
      }
    } catch {
      devWorktreeName = null;
    }
  }

  // Allow users to pass Chromium flags via FROGG_ELECTRON_FLAGS for debugging
  // rendering issues (e.g. "--disable-gpu --ozone-platform=x11").
  // Must run before app.whenReady().
  const electronFlags = process.env.FROGG_ELECTRON_FLAGS?.trim();
  if (electronFlags) {
    for (const token of electronFlags.split(/\s+/)) {
      const [key, ...rest] = token.replace(/^--/, "").split("=");
      app.commandLine.appendSwitch(key, rest.join("=") || undefined);
    }
    log.info("[electron-flags]", electronFlags);
  }

  return devWorktreeName;
}
