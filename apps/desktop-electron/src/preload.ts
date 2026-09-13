import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { BrowserKeyboardPolicy } from "./features/browser-keyboard/index.js";
import type { DesktopWindowChromeMode } from "./window/chrome.js";

// This preload runs in Electron's sandbox and is tsc-compiled (not bundled), so it MUST
// NOT emit any runtime module load other than "electron" — a require() of a local or
// third-party module throws and aborts the preload before exposeInMainWorld runs, leaving
// window.froggDesktop undefined (the 0.1.108 regression, #2103). Keep this literal in sync
// with FROGG_BROWSER_PROFILE_PARTITION in features/browser-profile.ts; preload-sandbox.test.ts
// guards both the no-local-import rule and this drift. Type-only imports are fine (erased at emit).
const FROGG_BROWSER_PROFILE_PARTITION = "persist:frogg-browser";

type EventHandler = (payload: unknown) => void;

function readWindowChromeMode(): DesktopWindowChromeMode {
  const prefix = "--frogg-window-chrome-mode=";
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (value === "native-mac" || value === "custom-windows" || value === "custom-linux") {
    return value;
  }
  // COMPAT(windowChromeMode): added in v0.5.3; remove after 2026-11-25.
  if (process.platform === "darwin") return "native-mac";
  return process.platform === "linux" ? "custom-linux" : "custom-windows";
}

interface AttachedBrowserRegistration {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

contextBridge.exposeInMainWorld("froggDesktop", {
  network: {
    localAddresses: () => ipcRenderer.invoke("frogg:network:localAddresses"),
    reverseLookup: (ip: string) => ipcRenderer.invoke("frogg:network:reverseLookup", ip),
    probeIdentity: (url: string, requestId?: string) =>
      ipcRenderer.invoke("frogg:network:probeIdentity", url, requestId),
    cancelProbe: (requestId: string) => ipcRenderer.invoke("frogg:network:cancelProbe", requestId),
  },
  platform: process.platform,
  supportsLocalDaemon: false,
  windowChromeMode: readWindowChromeMode(),
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("frogg:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("frogg:get-pending-open-project") as Promise<string | null>,
  agentNavigation: {
    ready: () =>
      ipcRenderer.invoke("frogg:agent-navigation:ready") as Promise<{
        serverId: string;
        agentId: string;
      } | null>,
  },
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`frogg:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`frogg:event:${event}`, listener);
      });
    },
  },
  window: {
    openNew: (options?: { pendingOpenProjectPath?: string | null }) =>
      ipcRenderer.invoke("frogg:window:openNew", options),
    getCurrentWindow: () => ({
      minimize: () => ipcRenderer.invoke("frogg:window:minimize"),
      close: () => ipcRenderer.invoke("frogg:window:close"),
      toggleMaximize: () => ipcRenderer.invoke("frogg:window:toggleMaximize"),
      isMaximized: () => ipcRenderer.invoke("frogg:window:isMaximized"),
      setFullscreen: (fullscreen: boolean) =>
        ipcRenderer.invoke("frogg:window:setFullscreen", fullscreen),
      isFullscreen: () => ipcRenderer.invoke("frogg:window:isFullscreen"),
      updateChrome: (update: { backgroundColor?: string; trafficLightOffsetY?: number }) =>
        ipcRenderer.invoke("frogg:window:updateChrome", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("frogg:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("frogg:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("frogg:window:setBadgeCount", count),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("frogg:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("frogg:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("frogg:dialog:open", options),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("frogg:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("frogg:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("frogg:opener:openUrl", url),
  },
  editor: {
    listTargets: () => ipcRenderer.invoke("frogg:editor:listTargets"),
    openTarget: (input: {
      editorId: string;
      workspacePath: string;
      filePath?: string;
      line?: number;
      column?: number;
    }) => ipcRenderer.invoke("frogg:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("frogg:menu:showContextMenu", input),
    setCapturingShortcut: (capturing: boolean) =>
      ipcRenderer.invoke("frogg:menu:set-capturing-shortcut", capturing),
  },
  browser: {
    setShortcutPolicy: (input: BrowserKeyboardPolicy) =>
      ipcRenderer.invoke("frogg:browser:set-shortcut-policy", input),
    profilePartition: FROGG_BROWSER_PROFILE_PARTITION,
    registerAttachedBrowser: (input: AttachedBrowserRegistration) =>
      ipcRenderer.invoke("frogg:browser:register-attached", input),
    unregisterWorkspaceBrowser: (browserId: string) =>
      ipcRenderer.invoke("frogg:browser:unregister-workspace-browser", browserId),
    setWorkspaceActiveBrowser: (input: { workspaceId: string; browserId: string | null }) =>
      ipcRenderer.invoke("frogg:browser:set-workspace-active-browser", input),
    focus: (browserId: string) => ipcRenderer.invoke("frogg:browser:focus", browserId),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("frogg:browser:open-devtools", browserId),
    clearProfile: (legacyBrowserIds: string[]) =>
      ipcRenderer.invoke("frogg:browser:clear-profile", legacyBrowserIds),
    executeAutomationCommand: (request: Record<string, unknown>) =>
      ipcRenderer.invoke("frogg:browser:execute-automation-command", request),
    captureElement: (
      browserId: string,
      rect: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke("frogg:browser:capture-element", browserId, rect),
    copyElement: (payload: { text?: string; imageDataUrl?: string }) =>
      ipcRenderer.invoke("frogg:browser:copy-element", payload),
  },
});
