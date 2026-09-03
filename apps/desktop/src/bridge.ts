// Builds `window.paseoDesktop` for the Tauri shell. Injected as an
// initialization script before any page script runs, so the UI in `apps/ui`
// finds it exactly as it found Electron's preload. The contract is
// `DesktopHostBridge` in `apps/ui/src/desktop/host.ts`; `menu`, `editor` and
// `browser` are deliberately absent (milestone 1, see docs/desktop-shell.md).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform as osPlatform } from "@tauri-apps/plugin-os";
import type { DesktopHostBridge, DragDropPayload, WindowChromeUpdate } from "./bridge-types";
import { installDragRegionHandler } from "./drag-region";

interface InjectedHostInfo {
  platform?: string;
  windowChromeMode?: string;
  appVersion?: string;
  windowLabel?: string;
}

declare global {
  interface Window {
    __FROGG_DESKTOP_HOST__?: InjectedHostInfo;
    paseoDesktop?: DesktopHostBridge;
  }
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const injected: InjectedHostInfo = window.__FROGG_DESKTOP_HOST__ ?? {};

function toElectronPlatform(): string {
  if (injected.platform) return injected.platform;
  try {
    const value = osPlatform();
    if (value === "macos") return "darwin";
    if (value === "windows") return "win32";
    return value;
  } catch {
    return "linux";
  }
}

function toWindowChromeMode(platform: string): string {
  if (injected.windowChromeMode) return injected.windowChromeMode;
  if (platform === "darwin") return "native-mac";
  return platform === "linux" ? "custom-linux" : "custom-windows";
}

function parseHexColor(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function baseName(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator === -1 ? path : path.slice(separator + 1);
}

// Paths from the most recent native drop, so `webUtils.getPathForFile` can
// answer for `File` objects the DOM drop handler receives for the same drop.
let lastDroppedPaths: string[] = [];

function trackDroppedPaths(payload: DragDropPayload): void {
  if (payload.type === "drop") {
    lastDroppedPaths = payload.paths;
  }
}

function createWindowBridge(): NonNullable<DesktopHostBridge["window"]> {
  const label = injected.windowLabel ?? "main";
  return {
    getCurrentWindow: () => {
      const win = getCurrentWindow();
      return {
        label,
        minimize: () => win.minimize(),
        close: () => win.close(),
        toggleMaximize: () => win.toggleMaximize(),
        isMaximized: () => win.isMaximized(),
        setFullscreen: (fullscreen: boolean) => win.setFullscreen(fullscreen),
        isFullscreen: () => win.isFullscreen(),
        updateChrome: async (update: WindowChromeUpdate) => {
          const rgb = update?.backgroundColor ? parseHexColor(update.backgroundColor) : null;
          if (rgb) {
            await win.setBackgroundColor(rgb);
          }
        },
        onResized: <TEvent = unknown>(handler: (event: TEvent) => void) =>
          win.onResized((event) => handler(event as unknown as TEvent)),
        setBadgeCount: async (count?: number) => {
          const value = typeof count === "number" && count > 0 ? Math.floor(count) : undefined;
          await win.setBadgeCount(value);
        },
        onDragDropEvent: <TEvent = unknown>(handler: (event: TEvent) => void) =>
          win.onDragDropEvent((event) => {
            trackDroppedPaths(event.payload as DragDropPayload);
            handler(event as unknown as TEvent);
          }),
      };
    },
  };
}

function createDialogBridge(): NonNullable<DesktopHostBridge["dialog"]> {
  return {
    ask: async (message, options) =>
      ask(message, {
        title: options?.title ?? "Confirm",
        kind: options?.kind ?? "info",
        okLabel: options?.okLabel ?? "OK",
        cancelLabel: options?.cancelLabel ?? "Cancel",
      }),
    // No native checkbox in Tauri dialogs: ask the question, then ask whether to
    // remember the answer. The caller persists the choice.
    askWithCheckbox: async (message, options) => {
      const confirmed = await ask(message, {
        title: options.title ?? "Confirm",
        kind: options.kind ?? "info",
        okLabel: options.okLabel ?? "OK",
        cancelLabel: options.cancelLabel ?? "Cancel",
      });
      const dontAskAgain = await ask(options.checkboxLabel, {
        title: options.title ?? "Confirm",
        kind: "info",
        okLabel: "Yes",
        cancelLabel: "No",
      });
      return { confirmed, dontAskAgain };
    },
    open: async (options) => {
      const result = await open({
        title: options?.title,
        defaultPath: options?.defaultPath,
        directory: options?.directory ?? false,
        canCreateDirectories: options?.createDirectory ?? false,
        multiple: options?.multiple ?? false,
        filters: options?.filters,
      });
      return result ?? null;
    },
  };
}

function createNotificationBridge(): NonNullable<DesktopHostBridge["notification"]> {
  async function ensurePermission(): Promise<boolean> {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  }
  return {
    isSupported: () => ensurePermission().catch(() => false),
    sendNotification: async (payload) => {
      const input = typeof payload === "string" ? { title: payload } : payload;
      const title = input?.title?.trim();
      if (!title || !(await ensurePermission())) return false;
      const body = input.body?.trim();
      sendNotification(body ? { title, body } : { title });
      return true;
    },
  };
}

interface LocalAddressEntry {
  ip?: string;
  prefixLength?: number;
}

function createNetworkBridge(): NonNullable<DesktopHostBridge["network"]> {
  return {
    localAddresses: async () => {
      const entries = (await invoke("desktop_invoke", {
        command: "network_local_addresses",
        args: {},
      })) as LocalAddressEntry[];
      return (Array.isArray(entries) ? entries : [])
        .filter((entry) => typeof entry?.ip === "string" && typeof entry.prefixLength === "number")
        .map((entry) => `${entry.ip}/${entry.prefixLength}`);
    },
    reverseLookup: async (ip: string) => {
      const name = await invoke("desktop_invoke", {
        command: "network_reverse_lookup",
        args: { ip },
      });
      return typeof name === "string" && name.length > 0 ? name : null;
    },
    probeIdentity: async (url: string) => {
      const result = (await invoke("desktop_invoke", {
        command: "network_probe_identity",
        args: { url },
      })) as { status?: unknown; body?: unknown } | null;
      if (!result || typeof result.status !== "number") {
        throw new Error("network_probe_identity returned no status");
      }
      return { status: result.status, body: result.body ?? null };
    },
  };
}

function createBridge(): DesktopHostBridge {
  const platform = toElectronPlatform();
  return {
    platform,
    windowChromeMode: toWindowChromeMode(platform),
    invoke: (command, args) => invoke("desktop_invoke", { command, args: args ?? {} }),
    getPendingOpenProject: () => invoke<string | null>("get_pending_open_project"),
    agentNavigation: {
      ready: () => invoke<{ serverId: string; agentId: string } | null>("agent_navigation_ready"),
    },
    events: {
      // Electron's preload handed listeners the payload alone. Tauri's `listen`
      // wraps it in `{event, id, payload}`; unwrap here so consumers that read
      // fields straight off the payload (the local-daemon transport shim keys
      // every event on `sessionId`) see the same shape on both shells.
      on: (event, handler) =>
        listen(`paseo:event:${event}`, (tauriEvent) => handler(tauriEvent.payload)),
    },
    window: createWindowBridge(),
    dialog: createDialogBridge(),
    notification: createNotificationBridge(),
    opener: {
      openUrl: async (url) => {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("Only HTTP(S) URLs can open externally.");
        }
        if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
          throw new Error("Only HTTP(S) URLs can open externally.");
        }
        await openUrl(parsed.href);
      },
    },
    webUtils: {
      getPathForFile: (file) => {
        const match = lastDroppedPaths.find((path) => baseName(path) === file.name);
        if (!match) {
          throw new Error("No filesystem path is known for this file.");
        }
        return match;
      },
    },
    network: createNetworkBridge(),
  };
}

window.paseoDesktop = createBridge();

// Custom chrome only: macOS keeps native decorations and its own drag.
if (window.paseoDesktop.windowChromeMode !== "native-mac") {
  installDragRegionHandler(window);
}
