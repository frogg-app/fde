// Local copy of the bridge contract from `apps/ui/src/desktop/host.ts`. That
// file imports react-native, so the shell keeps a dependency-free mirror of the
// members it implements. Keep the two in sync.

export interface DialogAskOptions {
  title?: string;
  okLabel?: string;
  cancelLabel?: string;
  kind?: "info" | "warning" | "error";
}

export interface DialogOpenOptions {
  title?: string;
  defaultPath?: string;
  directory?: boolean;
  createDirectory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface DialogAskWithCheckboxOptions extends DialogAskOptions {
  checkboxLabel: string;
  checkboxChecked?: boolean;
}

export interface WindowChromeUpdate {
  backgroundColor?: string;
  trafficLightOffsetY?: number;
}

export type DragDropPayload =
  | { type: "enter"; paths: string[] }
  | { type: "over" }
  | { type: "drop"; paths: string[] }
  | { type: "leave" };

export type Unlisten = () => void;

export interface DesktopWindowBridge {
  label?: string;
  minimize?: () => Promise<void>;
  close?: () => Promise<void>;
  toggleMaximize?: () => Promise<void>;
  isMaximized?: () => Promise<boolean>;
  setFullscreen?: (fullscreen: boolean) => Promise<void>;
  isFullscreen?: () => Promise<boolean>;
  updateChrome?: (update: WindowChromeUpdate) => Promise<void>;
  onResized?: <TEvent = unknown>(handler: (event: TEvent) => void) => Promise<Unlisten> | Unlisten;
  setBadgeCount?: (count?: number) => Promise<void>;
  onDragDropEvent?: <TEvent = unknown>(
    handler: (event: TEvent) => void,
  ) => Promise<Unlisten> | Unlisten;
}

export interface DesktopHostBridge {
  platform?: string;
  windowChromeMode?: string;
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  getPendingOpenProject?: () => Promise<string | null>;
  agentNavigation?: { ready?: () => Promise<{ serverId: string; agentId: string } | null> };
  events?: {
    on?: (event: string, handler: (payload: unknown) => void) => Promise<Unlisten> | Unlisten;
  };
  window?: {
    openNew?: (options?: { pendingOpenProjectPath?: string | null }) => Promise<void>;
    getCurrentWindow?: () => DesktopWindowBridge;
  };
  dialog?: {
    ask?: (message: string, options?: DialogAskOptions) => Promise<boolean>;
    askWithCheckbox?: (
      message: string,
      options: DialogAskWithCheckboxOptions,
    ) => Promise<{ confirmed: boolean; dontAskAgain: boolean }>;
    open?: (options?: DialogOpenOptions) => Promise<string | string[] | null>;
  };
  notification?: {
    isSupported?: () => Promise<boolean>;
    sendNotification?: (
      payload: string | { title: string; body?: string; data?: Record<string, unknown> },
    ) => Promise<boolean>;
  };
  opener?: { openUrl?: (url: string) => Promise<void> };
  webUtils?: { getPathForFile?: (file: File) => string };
  /**
   * For the UI's LAN scanner. `localAddresses` yields this machine's IPv4
   * addresses in CIDR form (`192.168.1.20/24`): interfaces that are up,
   * minus loopback and link-local. `reverseLookup` is the PTR name of an
   * address or `null` (1 s budget). `probeIdentity` fetches a daemon's
   * `/api/identity` (or `/api/health`) from Rust, outside the webview's
   * networking rules; it resolves with the status and parsed body, and
   * rejects when nothing answered within 700 ms.
   */
  network?: {
    localAddresses: () => Promise<string[]>;
    reverseLookup?: (ip: string) => Promise<string | null>;
    probeIdentity?: (url: string) => Promise<{ status: number; body: unknown }>;
  };
  // Not implemented in milestone 1; the UI hides those features when absent.
  editor?: undefined;
  menu?: undefined;
  browser?: undefined;
}
