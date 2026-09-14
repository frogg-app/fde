import { shell, type BrowserWindow } from "electron";
import { installDownloadLocation } from "./features/download-location.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import { isTrustedDesktopFrame, isAllowedDesktopPermission } from "./ipc-policy.js";

export function installWindowSecurity(window: BrowserWindow, origin: string): void {
  const contents = window.webContents;
  const trustedUrl = (url: string) =>
    isTrustedDesktopFrame({
      registered: true,
      mainFrame: true,
      url,
      origin,
    });
  contents.on("will-navigate", (event, url) => {
    if (!trustedUrl(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!trustedUrl(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    try {
      if (["https:", "http:"].includes(new URL(url).protocol)) {
        void shell.openExternal(url).catch(() => undefined);
      }
    } catch {
      /* Invalid destinations stay blocked. */
    }
    return { action: "deny" };
  });
  // Permission policy is session-wide; verify each requesting webContents rather
  // than capturing a particular window so multiple app windows remain usable.
  const appSession = contents.session;
  installDownloadLocation(appSession);
  // Loading the store publishes the download preferences the handler reads.
  getDesktopSettingsStore();
  appSession.setPermissionCheckHandler((requester, permission, requestingOrigin) => {
    if (!requester || requester.isDestroyed()) return false;
    return (
      trustedUrl(requester.getURL()) &&
      trustedUrl(requestingOrigin) &&
      isAllowedDesktopPermission(permission)
    );
  });
  appSession.setPermissionRequestHandler((requester, permission, callback, details) => {
    callback(
      Boolean(
        requester &&
        !requester.isDestroyed() &&
        trustedUrl(requester.getURL()) &&
        trustedUrl(details.requestingUrl) &&
        isAllowedDesktopPermission(permission),
      ),
    );
  });
}
