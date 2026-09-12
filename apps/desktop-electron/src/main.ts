import { configureDesktopProcess } from "./process-configuration.js";
import log from "electron-log/main";
import { handleDesktopIpc } from "./ipc-security.js";
import { registerNetworkHandlers } from "./network.js";
import { pairingInbox } from "./pairing-inbox.js";

import { inheritLoginShellEnv } from "./login-shell-env.js";

import {
  buildAgentDeepLinkRoute,
  parseAgentDeepLink,
  type AgentDeepLinkTarget,
} from "@fde/protocol/agent-deep-link";
import {
  app,
  BrowserWindow,
  autoUpdater as electronAutoUpdater,
  net,
  protocol,
  shell,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AgentNavigationInbox, parseAgentDeepLinkFromArgv } from "./agent-navigation.js";
import { registerDesktopCommands } from "./desktop-commands.js";
import { closeAllTransportSessions } from "./daemon/local-transport.js";
import { createQuitLifecycle, registerExternalQuitSignals } from "./quit-lifecycle.js";
import { runDesktopStartup } from "./desktop-startup.js";
import { installAppUpdateOnQuit } from "./features/auto-updater.js";
import { registerBrowserAutomationIpc } from "./features/browser-automation/ipc.js";
import { registerDialogHandlers } from "./features/dialogs.js";
import { registerEditorTargetHandlers } from "./features/editor-targets/ipc.js";
import { setupApplicationMenu } from "./features/menu.js";
import {
  ensureNotificationCenterRegistration,
  registerNotificationHandlers,
} from "./features/notifications.js";
import { createExternalUrlOpener } from "./features/opener.js";
import { parseOpenProjectPathFromArgv } from "./open-project-routing.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import { resolveDesktopWindowChromeMode } from "./window/chrome.js";
import {
  createDesktopWindowOwner,
  type DesktopWindowOwner,
  type OwnedDesktopWindow,
} from "./window/desktop-window-owner.js";
import { registerWindowManager } from "./window/window-manager.js";

import { brand } from "@fde/branding";
import { createWindowRuntime } from "./window-runtime.js";

const DEV_SERVER_URL =
  process.env.FDE_DESKTOP_DEV_URL ?? process.env.EXPO_DEV_URL ?? "http://localhost:8081";
const APP_SCHEME = brand.scheme;
const FDE_DEBUG = process.env.FDE_DEBUG === "1";
const DISABLE_SINGLE_INSTANCE_LOCK = process.env.FDE_DISABLE_SINGLE_INSTANCE_LOCK === "1";
const APP_NAME = process.env.FDE_TEST_APP_NAME?.trim() || brand.name;
// Keep the tested Electron profile while presenting the production FDE identity.
const PROFILE_NAME = process.env.FDE_TEST_APP_NAME?.trim() || `${brand.name} Electron`;
const DESKTOP_WINDOW_CHROME_MODE = resolveDesktopWindowChromeMode({
  platform: process.platform,
  override: process.env.FDE_DESKTOP_WINDOW_CONTROLS,
  isPackaged: app.isPackaged,
});
const UPDATE_QUIT_DEADLINE_MS = 5_000;
const agentNavigationInbox = new AgentNavigationInbox();

// A second-instance launch can arrive before the packaged protocol handler,
// IPC handlers, and first window exist. Wait for full bootstrap, not just
// app.whenReady(), before delivering navigation to the renderer.
let resolveBootstrapComplete: () => void;
const bootstrapComplete = new Promise<void>((resolve) => {
  resolveBootstrapComplete = resolve;
});
let bootstrapIsComplete = false;

const devWorktreeName = configureDesktopProcess(APP_NAME, PROFILE_NAME);
log.transports.console.level = "info";
log.initialize({ spyRendererConsole: true });

let pendingOpenProjectPath = parseOpenProjectPathFromArgv({
  argv: process.argv,
  isDefaultApp: process.defaultApp,
});
let pendingAgentNavigation = parseAgentDeepLinkFromArgv(process.argv);
for (const arg of process.argv) pairingInbox.receive(arg);

// Each window pulls its own pending open-project path on mount, keyed by
// webContents id, so deep-linked windows (second-instance launches, the
// in-app "Open in new window" action) land on the right project without
// racing a global.
let desktopWindowOwner: DesktopWindowOwner<AgentDeepLinkTarget>;

if (FDE_DEBUG) {
  log.info("[open-project] argv:", process.argv);
  log.info("[open-project] isDefaultApp:", process.defaultApp);
  log.info("[open-project] pendingOpenProjectPath:", pendingOpenProjectPath);
}

// The renderer pulls the pending path on mount via IPC — this avoids
// a race where the push event arrives before React registers its listener.
handleDesktopIpc("fde:get-pending-open-project", (event) => {
  const webContentsId = event.sender.id;
  const result = desktopWindowOwner.takePendingProject(webContentsId);
  log.info("[open-project] renderer requested pending path:", {
    webContentsId,
    pendingPath: result,
  });
  return result;
});

handleDesktopIpc("fde:agent-navigation:ready", (event) => {
  return agentNavigationInbox.windowReady(event.sender.id);
});

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

const { createWindow, getAppDistDir, applyAppIcon } = createWindowRuntime({
  APP_NAME,
  APP_SCHEME,
  DEV_SERVER_URL,
  DESKTOP_WINDOW_CHROME_MODE,
  devWorktreeName,
  agentNavigationInbox,
});

function ownedDesktopWindow(win: BrowserWindow): OwnedDesktopWindow<AgentDeepLinkTarget> {
  return {
    webContentsId: win.webContents.id,
    isDestroyed: () => win.isDestroyed(),
    isVisible: () => win.isVisible(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    show: () => win.show(),
    focus: () => win.focus(),
    sendAgent: (target) => win.webContents.send("fde:event:open-agent", target),
  };
}

desktopWindowOwner = createDesktopWindowOwner<AgentDeepLinkTarget>({
  async create(input) {
    const win = await createWindow({
      initialRoute: input.initialRoute,
      restoreWindowState: input.restoreWindowState,
      onCreated: input.onCreated,
      onClosed: input.onClosed,
    });
    return ownedDesktopWindow(win);
  },
  windows: () => BrowserWindow.getAllWindows().map(ownedDesktopWindow),
  focusedWindow: () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    return ownedDesktopWindow(win);
  },
  agentRoute: buildAgentDeepLinkRoute,
  deliverAgent: (webContentsId, target) =>
    agentNavigationInbox.deliverOrQueue(webContentsId, target),
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

function receiveAgentDeepLink(input: string): void {
  const target = parseAgentDeepLink(input);
  if (!target) {
    return;
  }

  if (bootstrapIsComplete) {
    void desktopWindowOwner
      .openOrFocusAgent(target)
      .catch((error) => log.error("[window] failed to route agent link", error));
    return;
  }

  pendingAgentNavigation = target;
  void bootstrapComplete.then(() => {
    if (pendingAgentNavigation !== target) {
      return undefined;
    }
    pendingAgentNavigation = null;
    void desktopWindowOwner
      .openOrFocusAgent(target)
      .catch((error) => log.error("[window] failed to route queued agent link", error));
    return undefined;
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!pairingInbox.receive(url)) receiveAgentDeepLink(url);
});

function setupSingleInstanceLock(): boolean {
  if (DISABLE_SINGLE_INSTANCE_LOCK) {
    log.info("[single-instance] disabled by FDE_DISABLE_SINGLE_INSTANCE_LOCK");
    return true;
  }

  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  app.on("second-instance", (_event, commandLine) => {
    const pairingLink = commandLine.find((arg) => pairingInbox.receive(arg));
    if (pairingLink) {
      void bootstrapComplete.then(() => desktopWindowOwner.restoreWhenActivated());
      return;
    }
    const agentTarget = parseAgentDeepLinkFromArgv(commandLine);
    if (agentTarget) {
      void bootstrapComplete
        .then(() => desktopWindowOwner.openOrFocusAgent(agentTarget))
        .catch((error) => log.error("[window] failed to route second-instance agent link", error));
      return;
    }

    log.info("[open-project] second-instance commandLine:", commandLine);
    const openProjectPath = parseOpenProjectPathFromArgv({
      argv: commandLine,
      isDefaultApp: false,
    });
    log.info("[open-project] second-instance openProjectPath:", openProjectPath);
    // Relaunching the app (CLI `fde [path]`, double-click, etc.) opens a new
    // window rather than focusing the existing one. Wait for bootstrap (not just
    // app.whenReady) so the protocol + IPC handlers exist before the window loads.
    void bootstrapComplete
      .then(() =>
        desktopWindowOwner.openAdditional({
          pendingProjectPath: openProjectPath,
        }),
      )
      .catch((error) => {
        log.error("[window] failed to create window from second-instance", error);
      });
  });

  return true;
}

async function bootstrap(): Promise<void> {
  if (!setupSingleInstanceLock()) {
    return;
  }

  await app.whenReady();

  const appDistDir = getAppDistDir();
  protocol.handle(APP_SCHEME, (request) => {
    const { pathname, search, hash } = new URL(request.url);
    const decodedPath = decodeURIComponent(pathname);

    // Chromium can occasionally request the exported entrypoint directly.
    // Canonicalize it back to the route URL so Expo Router sees `/`, not `/index.html`.
    if (decodedPath.endsWith("/index.html")) {
      const normalizedPath = decodedPath.slice(0, -"/index.html".length) || "/";
      return Response.redirect(`${APP_SCHEME}://app${normalizedPath}${search}${hash}`, 307);
    }

    const filePath = path.join(appDistDir, decodedPath);
    const relativePath = path.relative(appDistDir, filePath);

    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return new Response("Not found", { status: 404 });
    }

    // SPA fallback: serve index.html for routes without a file extension
    if (!relativePath || !path.extname(relativePath)) {
      return net.fetch(pathToFileURL(path.join(appDistDir, "index.html")).toString());
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });

  await applyAppIcon();
  setupApplicationMenu({
    onNewWindow: () => {
      void desktopWindowOwner.openAdditional().catch((error) => {
        log.error("[window] failed to create window from menu", error);
      });
    },
  });
  ensureNotificationCenterRegistration();
  registerNetworkHandlers();
  registerDesktopCommands();
  registerWindowManager({ mode: DESKTOP_WINDOW_CHROME_MODE });
  registerDialogHandlers();
  registerNotificationHandlers();
  const openExternalUrl = createExternalUrlOpener({ open: shell.openExternal });
  handleDesktopIpc("fde:opener:openUrl", (_event, value: unknown) => openExternalUrl(value));
  registerEditorTargetHandlers();
  registerBrowserAutomationIpc();

  // In-app "Open in new window": opens a window that lands on the given project
  // via the same open-project flow as a CLI launch (no move, no ownership).
  handleDesktopIpc("fde:window:openNew", async (_event, options?: unknown) => {
    const pendingPath =
      options && typeof options === "object" && "pendingOpenProjectPath" in options
        ? (options as { pendingOpenProjectPath?: unknown }).pendingOpenProjectPath
        : null;
    await desktopWindowOwner.openAdditional({
      pendingProjectPath: typeof pendingPath === "string" ? pendingPath : null,
    });
  });

  // The first window of the session restores and persists saved geometry.
  const initialAgentNavigation = pendingAgentNavigation;
  pendingAgentNavigation = null;
  await desktopWindowOwner.openPrimary({
    initialRoute: initialAgentNavigation ? buildAgentDeepLinkRoute(initialAgentNavigation) : null,
    pendingProjectPath: pendingOpenProjectPath,
  });
  pendingOpenProjectPath = null;

  // Protocol + IPC handlers and the first window now exist: release any
  // second-instance launches that arrived during cold start.
  bootstrapIsComplete = true;
  resolveBootstrapComplete();

  if (pendingAgentNavigation) {
    const target = pendingAgentNavigation;
    pendingAgentNavigation = null;
    await desktopWindowOwner.openOrFocusAgent(target);
  }

  app.on("activate", () => {
    void desktopWindowOwner.restoreWhenActivated().catch((error) => {
      console.error("Failed to restore a desktop window after activation", error);
    });
  });
}

void runDesktopStartup({
  inheritLoginShellEnv,
  bootstrapGui: bootstrap,
}).catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

const quitLifecycle = createQuitLifecycle({
  app,
  closeTransportSessions: closeAllTransportSessions,
  installAppUpdateOnQuit: async (signal) => {
    const settings = await getDesktopSettingsStore().get();
    return installAppUpdateOnQuit({
      currentVersion: app.getVersion(),
      releaseChannel: settings.releaseChannel,
      signal,
    });
  },
  createUpdateDeadlineSignal: () => AbortSignal.timeout(UPDATE_QUIT_DEADLINE_MS),
  onUpdateError: (error) => {
    log.error("[auto-updater] failed to validate downloaded update on quit", error);
  },
});

// electron-updater forwards this event through Electron's built-in autoUpdater.
electronAutoUpdater.on("before-quit-for-update", quitLifecycle.handleBeforeQuitForUpdate);
app.on("before-quit", quitLifecycle.handleBeforeQuit);
registerExternalQuitSignals({ signals: process, quit: () => app.quit() });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
