import log from "electron-log/main";
import { app, BrowserWindow, nativeImage, screen } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { AgentNavigationInbox } from "./agent-navigation.js";
import {
  isFdeBrowserWebviewAttach,
  prepareFdeBrowserWebContents,
  registerBrowserWebviewNavigationGuards,
  unregisterFdeBrowserHost,
} from "./features/browser-webviews/index.js";
import { resolveAppIconPath } from "./features/stamped-icon.js";
import { registerTrustedRenderer } from "./ipc-security.js";
import { pairingInbox } from "./pairing-inbox.js";
import { clampWindowStateToWorkAreas, createWindowStateStore } from "./settings/window-state.js";
import { installWindowSecurity } from "./window-security.js";
import { windowChromeModeArgument } from "./window/chrome.js";
import { setupDarwinCompositorWatchdog } from "./window/compositor-watchdog/index.js";
import {
  applyDesktopWindowChromeMode,
  getMainWindowChromeOptions,
  getWindowBackgroundColor,
  resolveSystemWindowTheme,
  resolveWindowBounds,
  setupDefaultContextMenu,
  setupDragDropPrevention,
  setupWindowResizeEvents,
  setupWindowStatePersistence,
} from "./window/window-manager.js";

import {
  browserKeyboard,
  installBrowserWindowOpenHandler,
  pendingBrowserWindowOpenRequests,
  showBrowserWebviewContextMenu,
} from "./browser-runtime.js";
export function createWindowRuntime({
  APP_NAME,
  APP_SCHEME,
  DEV_SERVER_URL,
  DESKTOP_WINDOW_CHROME_MODE,
  devWorktreeName,
  agentNavigationInbox,
}: {
  APP_NAME: string;
  APP_SCHEME: string;
  DEV_SERVER_URL: string;
  DESKTOP_WINDOW_CHROME_MODE: import("./window/chrome.js").DesktopWindowChromeMode;
  devWorktreeName: string | null;
  agentNavigationInbox: AgentNavigationInbox;
}) {
  function getPreloadPath(): string {
    return path.join(__dirname, "preload.js");
  }

  function getBrowserKeyboardPreloadPath(): string {
    return path.join(__dirname, "features", "browser-keyboard", "guest-preload.js");
  }

  function getAppDistDir(): string {
    if (process.env.FDE_ELECTRON_UI_DIR) return path.resolve(process.env.FDE_ELECTRON_UI_DIR);
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "app-dist");
    }

    return path.resolve(__dirname, "../../ui/dist");
  }

  function getWindowIconCandidates(): string[] {
    if (app.isPackaged) {
      if (process.platform === "win32") {
        return [
          path.join(process.resourcesPath, "icon.ico"),
          path.join(process.resourcesPath, "icon.png"),
        ];
      }
      return [path.join(process.resourcesPath, "icon.png")];
    }
    if (process.platform === "win32") {
      return [
        path.resolve(__dirname, "../assets/icon-dev.png"),
        path.resolve(__dirname, "../assets/icon.ico"),
        path.resolve(__dirname, "../assets/icon.png"),
      ];
    }
    return [
      path.resolve(__dirname, "../assets/icon-dev.png"),
      path.resolve(__dirname, "../assets/icon.png"),
    ];
  }

  function getWindowIconPath(): string | null {
    const candidates = getWindowIconCandidates();
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  function getDevBuildLabel(): string | null {
    if (app.isPackaged) {
      return null;
    }
    return process.env.EXPO_PUBLIC_FDE_DEV_BUILD_LABEL?.trim() || null;
  }

  let cachedEffectiveIconPath: string | null = null;

  async function getEffectiveAppIconPath(): Promise<string | null> {
    if (cachedEffectiveIconPath !== null) {
      return cachedEffectiveIconPath;
    }
    const baseIconPath = getWindowIconPath();
    if (app.isPackaged || !baseIconPath) {
      cachedEffectiveIconPath = baseIconPath;
      return baseIconPath;
    }
    const devLabel = getDevBuildLabel();
    cachedEffectiveIconPath = await resolveAppIconPath({
      isPackaged: false,
      baseIconPath,
      devLabel,
      cacheDir: app.getPath("userData"),
    });
    return cachedEffectiveIconPath;
  }

  async function applyAppIcon(): Promise<void> {
    if (process.platform !== "darwin") {
      return;
    }

    const iconPath = await getEffectiveAppIconPath();
    if (!iconPath) {
      return;
    }

    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      return;
    }

    app.dock?.setIcon(icon);
  }

  // Work areas with the primary display first, so window-state clamping treats
  // it as the fallback. getAllDisplays() order is not guaranteed to lead with it.
  function getWorkAreasPrimaryFirst(): Electron.Rectangle[] {
    const primary = screen.getPrimaryDisplay();
    const others = screen.getAllDisplays().filter((display) => display.id !== primary.id);
    return [primary, ...others].map((display) => display.workArea);
  }

  function configureWindowLifecycle(
    mainWindow: BrowserWindow,
    options: {
      onCreated?: (webContentsId: number) => void;
      onClosed?: (webContentsId: number) => void;
    },
  ): void {
    registerTrustedRenderer(
      mainWindow.webContents,
      app.isPackaged || process.env.FDE_ELECTRON_UI_DIR ? `${APP_SCHEME}://app` : DEV_SERVER_URL,
    );
    installWindowSecurity(
      mainWindow,
      app.isPackaged || process.env.FDE_ELECTRON_UI_DIR ? `${APP_SCHEME}://app` : DEV_SERVER_URL,
    );
    const webContentsId = mainWindow.webContents.id;
    options.onCreated?.(webContentsId);
    mainWindow.webContents.on(
      "did-start-navigation",
      (_event, _url, isSameDocument, isMainFrame) => {
        if (isMainFrame && !isSameDocument) {
          agentNavigationInbox.windowLoading(webContentsId);
          pairingInbox.remove(webContentsId);
        }
      },
    );
    mainWindow.on("closed", () => {
      options.onClosed?.(webContentsId);
      agentNavigationInbox.removeWindow(webContentsId);
      unregisterFdeBrowserHost(webContentsId);
      browserKeyboard.detachHost(webContentsId);
    });
  }

  async function createWindow(
    options: {
      initialRoute?: string | null;
      restoreWindowState?: boolean;
      onCreated?: (webContentsId: number) => void;
      onClosed?: (webContentsId: number) => void;
    } = {},
  ): Promise<BrowserWindow> {
    const iconPath = await getEffectiveAppIconPath();
    const systemTheme = resolveSystemWindowTheme();

    // Only the first window of a session restores and persists saved geometry.
    // Additional windows (⌘N, second-instance, "Open in new window") open at the
    // default size and let the OS cascade them, so they neither stack on top of
    // the restored window nor fight over the single window-state store.
    const restoreWindowState = options.restoreWindowState ?? false;
    const windowStateStore = restoreWindowState
      ? createWindowStateStore({ userDataPath: app.getPath("userData") })
      : null;
    const savedWindowState = windowStateStore ? await windowStateStore.load() : null;
    const restoredWindowState = savedWindowState
      ? clampWindowStateToWorkAreas(savedWindowState, getWorkAreasPrimaryFirst())
      : null;

    const title = devWorktreeName ? `${APP_NAME} (${devWorktreeName})` : APP_NAME;
    const mainWindow = new BrowserWindow({
      title,
      ...resolveWindowBounds(restoredWindowState),
      show: false,
      backgroundColor: getWindowBackgroundColor(systemTheme),
      ...(iconPath ? { icon: iconPath } : {}),
      ...getMainWindowChromeOptions({
        mode: DESKTOP_WINDOW_CHROME_MODE,
      }),
      webPreferences: {
        preload: getPreloadPath(),
        additionalArguments: [windowChromeModeArgument(DESKTOP_WINDOW_CHROME_MODE)],
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
      },
    });
    applyDesktopWindowChromeMode({
      win: mainWindow,
      mode: DESKTOP_WINDOW_CHROME_MODE,
    });

    configureWindowLifecycle(mainWindow, options);

    if (devWorktreeName) {
      app.dock?.setBadge(devWorktreeName);
    }

    if (restoredWindowState?.isMaximized) {
      mainWindow.maximize();
    }

    setupDarwinCompositorWatchdog(mainWindow);
    setupWindowResizeEvents(mainWindow);
    if (windowStateStore) {
      setupWindowStatePersistence(mainWindow, windowStateStore);
    }
    setupDefaultContextMenu(mainWindow);
    setupDragDropPrevention(mainWindow);
    mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
      if (!isFdeBrowserWebviewAttach(params)) {
        event.preventDefault();
        return;
      }
      webPreferences.nodeIntegration = false;
      // The sandboxed keyboard preload must run in every frame so focused iframes keep
      // the same page-first shortcut boundary. Node integration remains disabled.
      webPreferences.nodeIntegrationInSubFrames = true;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.webviewTag = false;
      webPreferences.allowRunningInsecureContent = false;
      delete webPreferences.preload;
      delete params.preload;
      delete (webPreferences as { preloadURL?: string }).preloadURL;
      delete (params as { preloadURL?: string }).preloadURL;
      webPreferences.preload = getBrowserKeyboardPreloadPath();
    });
    mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
      prepareFdeBrowserWebContents(contents);
      contents.once("destroyed", () => {
        pendingBrowserWindowOpenRequests.delete(contents.id);
      });
      installBrowserWindowOpenHandler({
        contents,
        sourceContents: contents,
        mainWindow,
      });
      contents.on("context-menu", (_contextMenuEvent, params) => {
        showBrowserWebviewContextMenu(mainWindow, contents, params);
      });
      registerBrowserWebviewNavigationGuards(contents);
    });

    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });

    if (!app.isPackaged && !process.env.FDE_ELECTRON_UI_DIR) {
      const { loadReactDevTools } = await import("./features/react-devtools.js");
      if (process.env.FDE_ELECTRON_REACT_DEVTOOLS === "1") {
        void loadReactDevTools().catch((error) =>
          log.warn("[DevTools] Failed to initialize", error),
        );
      }
      const initialUrl = options.initialRoute
        ? new URL(options.initialRoute, `${DEV_SERVER_URL}/`).toString()
        : DEV_SERVER_URL;
      await mainWindow.loadURL(initialUrl);
      return mainWindow;
    }

    await mainWindow.loadURL(`${APP_SCHEME}://app${options.initialRoute ?? "/"}`);
    return mainWindow;
  }

  return { createWindow, getAppDistDir, applyAppIcon };
}
