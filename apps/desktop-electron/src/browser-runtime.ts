import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  Menu,
  nativeImage,
  session,
  webContents,
} from "electron";
import log from "electron-log/main";
import { createBrowserCaptureService } from "./features/browser-capture.js";
import { BrowserKeyboard } from "./features/browser-keyboard/index.js";
import {
  clearPaseoBrowserProfile,
  getLegacyPaseoBrowserProfileSession,
  getPaseoBrowserProfileSession,
  getPaseoBrowserProfileSessions,
  listPaseoBrowserProfileGuests,
  PASEO_BROWSER_PROFILE_PARTITION,
  readLegacyPaseoBrowserIds,
} from "./features/browser-profile.js";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  decideBrowserWindowOpenRequest,
  getPaseoBrowserIdForWebContents,
  getPaseoBrowserWebContentsForHostWindow,
  getPaseoBrowserWebviewRegistry,
  listRegisteredPaseoBrowserIds,
  PendingBrowserWindowOpenRequests,
  registerAttachedPaseoBrowser,
  registerBrowserWebviewNavigationGuards,
  setWorkspaceActivePaseoBrowserId,
  unregisterPaseoBrowserFromHost,
} from "./features/browser-webviews/index.js";
import { handleDesktopIpc } from "./ipc-security.js";
import { buildStandardContextMenuItems } from "./window/window-manager.js";

export const pendingBrowserWindowOpenRequests = new PendingBrowserWindowOpenRequests();
interface AttachedBrowserInput {
  browserId: string;
  workspaceId: string;
  webContentsId: number;
}

function readAttachedBrowserInput(input: unknown): AttachedBrowserInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.browserId !== "string" || record.browserId.trim().length === 0) {
    return null;
  }
  if (typeof record.workspaceId !== "string" || record.workspaceId.trim().length === 0) {
    return null;
  }
  if (
    typeof record.webContentsId !== "number" ||
    !Number.isInteger(record.webContentsId) ||
    record.webContentsId <= 0
  ) {
    return null;
  }
  return {
    browserId: record.browserId.trim(),
    workspaceId: record.workspaceId.trim(),
    webContentsId: record.webContentsId,
  };
}

function readActiveBrowserInput(
  input: unknown,
): { workspaceId: string; browserId: string | null } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  if (typeof record.workspaceId !== "string" || record.workspaceId.trim().length === 0) {
    return null;
  }
  const browserId = typeof record.browserId === "string" ? record.browserId.trim() : null;
  return {
    workspaceId: record.workspaceId.trim(),
    browserId: browserId || null,
  };
}

export const browserKeyboard = new BrowserKeyboard(getPaseoBrowserWebviewRegistry());
browserKeyboard.registerIpc();

export function showBrowserWebviewContextMenu(
  win: BrowserWindow,
  contents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): void {
  const menu = Menu.buildFromTemplate([
    ...buildStandardContextMenuItems(contents, params),
    ...(app.isPackaged
      ? []
      : [
          { type: "separator" as const },
          {
            label: "Inspect Element",
            click: () => {
              log.info("[browser-devtools] inspect-element.request", {
                webContentsId: contents.id,
                browserId: getPaseoBrowserIdForWebContents(contents),
                x: params.x,
                y: params.y,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
              contents.openDevTools({ mode: "detach" });
              contents.inspectElement(params.x, params.y);
              log.info("[browser-devtools] inspect-element.done", {
                webContentsId: contents.id,
                isDevToolsOpened: contents.isDevToolsOpened(),
              });
            },
          },
        ]),
  ]);
  menu.popup({ window: win });
}

function getBrowserPopupWindowOptions(
  mainWindow: BrowserWindow,
): Electron.BrowserWindowConstructorOptions {
  return {
    parent: mainWindow,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: PASEO_BROWSER_PROFILE_PARTITION,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  };
}

export function installBrowserWindowOpenHandler(input: {
  contents: Electron.WebContents;
  sourceContents: Electron.WebContents;
  mainWindow: BrowserWindow;
}): void {
  const { contents, sourceContents, mainWindow } = input;

  contents.setWindowOpenHandler(({ url, disposition, frameName, features, postBody }) => {
    const decision = decideBrowserWindowOpenRequest({
      url,
      disposition,
      frameName,
      features,
      hasPostBody: postBody !== undefined && postBody !== null,
    });

    if (decision.kind === "deny") {
      return { action: "deny" };
    }
    if (decision.kind === "popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: getBrowserPopupWindowOptions(mainWindow),
      };
    }

    const sourceBrowserId = getPaseoBrowserIdForWebContents(sourceContents);
    if (sourceBrowserId) {
      mainWindow.webContents.send(BROWSER_NEW_TAB_REQUEST_EVENT, {
        sourceBrowserId,
        url: decision.url,
      });
    } else {
      pendingBrowserWindowOpenRequests.add(sourceContents.id, decision.url);
    }
    return { action: "deny" };
  });

  contents.on("did-create-window", (popupWindow) => {
    const popupContents = popupWindow.webContents;
    registerBrowserWebviewNavigationGuards(popupContents);
    popupContents.on("context-menu", (_event, params) => {
      showBrowserWebviewContextMenu(popupWindow, popupContents, params);
    });
    installBrowserWindowOpenHandler({
      contents: popupContents,
      sourceContents,
      mainWindow,
    });
  });
}

handleDesktopIpc("paseo:browser:register-attached", (event, rawInput: unknown) => {
  const input = readAttachedBrowserInput(rawInput);
  if (!input) {
    throw new Error("Invalid attached browser registration");
  }
  const registered = registerAttachedPaseoBrowser({
    ...input,
    sender: event.sender,
    profileSession: getPaseoBrowserProfileSession(session),
    findWebContents: (webContentsId) => webContents.fromId(webContentsId) ?? null,
  });
  if (!registered) {
    throw new Error("Attached browser registration was rejected");
  }
  const guest = webContents.fromId(input.webContentsId);
  if (!guest) {
    throw new Error("Attached browser guest disappeared after registration");
  }
  browserKeyboard.attach({ contents: guest, hostContents: event.sender });
  log.info("[browser-webview] registered", {
    browserId: input.browserId,
    webContentsId: input.webContentsId,
    registeredBrowserIds: listRegisteredPaseoBrowserIds(),
  });
  for (const url of pendingBrowserWindowOpenRequests.take(input.webContentsId)) {
    event.sender.send(BROWSER_NEW_TAB_REQUEST_EVENT, {
      sourceBrowserId: input.browserId,
      url,
    });
  }
});

handleDesktopIpc(
  "paseo:browser:unregister-workspace-browser",
  async (event, browserId: unknown) => {
    if (typeof browserId === "string" && browserId.trim().length > 0) {
      const normalizedBrowserId = browserId.trim();
      const hasOtherHost = getPaseoBrowserWebviewRegistry().hasBrowserInOtherHostWindow(
        event.sender.id,
        normalizedBrowserId,
      );
      unregisterPaseoBrowserFromHost(event.sender.id, normalizedBrowserId);
      // COMPAT(browserProfile): added in v0.1.108; remove after 2027-01-15.
      const legacyProfile = hasOtherHost
        ? null
        : getLegacyPaseoBrowserProfileSession(session, normalizedBrowserId);
      if (legacyProfile) {
        try {
          await clearPaseoBrowserProfile({
            profileSessions: [legacyProfile],
            listGuests: () => [],
            logReloadError: () => {},
          });
        } catch (error) {
          log.warn("[browser-profile] failed to clear legacy tab profile", {
            browserId: normalizedBrowserId,
            error,
          });
        }
      }
    }
  },
);

handleDesktopIpc("paseo:browser:set-workspace-active-browser", (event, rawInput: unknown) => {
  const input = readActiveBrowserInput(rawInput);
  if (input) {
    setWorkspaceActivePaseoBrowserId({
      ...input,
      hostWebContentsId: event.sender.id,
    });
  }
});

handleDesktopIpc("paseo:browser:focus", (event, browserId: unknown): boolean => {
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    return false;
  }
  const contents = getPaseoBrowserWebContentsForHostWindow(browserId, event.sender.id);
  if (!contents) {
    return false;
  }
  contents.focus();
  return true;
});

handleDesktopIpc("paseo:browser:open-devtools", (event, browserId: unknown) => {
  if (typeof browserId !== "string" || browserId.trim().length === 0) {
    const result = {
      ok: false,
      reason: "invalid-browser-id",
      browserId,
      registeredBrowserIds: listRegisteredPaseoBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.invalid", result);
    return result;
  }
  const contents = getPaseoBrowserWebContentsForHostWindow(browserId, event.sender.id);
  if (!contents) {
    const result = {
      ok: false,
      reason: "browser-webcontents-not-found",
      browserId,
      registeredBrowserIds: listRegisteredPaseoBrowserIds(),
    };
    log.warn("[browser-devtools] open-devtools.not-found", result);
    return result;
  }
  log.info("[browser-devtools] open-devtools.request", {
    browserId,
    webContentsId: contents.id,
    isDestroyed: contents.isDestroyed(),
    isDevToolsOpened: contents.isDevToolsOpened(),
    registeredBrowserIds: listRegisteredPaseoBrowserIds(),
  });
  contents.openDevTools({ mode: "detach" });
  const result = {
    ok: true,
    reason: "opened",
    browserId,
    webContentsId: contents.id,
    isDevToolsOpened: contents.isDevToolsOpened(),
  };
  log.info("[browser-devtools] open-devtools.done", result);
  return result;
});

handleDesktopIpc("paseo:browser:clear-profile", async (_event, rawLegacyBrowserIds: unknown) => {
  const profileSessions = getPaseoBrowserProfileSessions(
    session,
    readLegacyPaseoBrowserIds(rawLegacyBrowserIds),
  );
  const profileSession = profileSessions[0];
  await clearPaseoBrowserProfile({
    profileSessions,
    listGuests: () =>
      listPaseoBrowserProfileGuests({
        profileSession,
        webContents: webContents.getAllWebContents(),
      }),
    logReloadError: (webContentsId, error) => {
      log.warn("[browser-profile] failed to reload guest", {
        webContentsId,
        error,
      });
    },
  });
});

const browserCapture = createBrowserCaptureService<Electron.NativeImage>({
  findGuest: getPaseoBrowserWebContentsForHostWindow,
  decodeImage: (dataUrl) => nativeImage.createFromDataURL(dataUrl),
  clipboard: {
    write: ({ text, image }) =>
      clipboard.write([
        new ClipboardItem({
          "text/plain": text,
          "image/png": new Blob([new Uint8Array(image.toPNG())], {
            type: "image/png",
          }),
        }),
      ]),
    writeImage: (image) =>
      clipboard.write([
        new ClipboardItem({
          "image/png": new Blob([new Uint8Array(image.toPNG())], {
            type: "image/png",
          }),
        }),
      ]),
    writeText: (text) => clipboard.writeText(text),
  },
  warn: (event, details) => log.warn(`[browser-capture] ${event}`, details),
});

handleDesktopIpc("paseo:browser:capture-element", (event, browserId: unknown, rect: unknown) =>
  browserCapture.capture({
    browserId,
    hostWebContentsId: event.sender.id,
    rect,
  }),
);

handleDesktopIpc("paseo:browser:copy-element", (_event, payload: unknown) =>
  browserCapture.copy(payload),
);
