import { getDesktopHost, isElectronRuntime } from "@/desktop/host";
import { listenToDesktopEvent } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import type { AgentSkillSelection } from "@fde/protocol/messages";
import {
  parseLocalDaemonInstallEvent,
  type LocalDaemonInstallEvent,
} from "./local-daemon-install-progress";

export type DesktopDaemonState = "starting" | "running" | "stopped" | "errored";
export type DesktopDaemonStopReason =
  | "manual_ipc"
  | "settings"
  | "host_remove"
  | "quit"
  | "app_update"
  | "version_mismatch"
  | "restart";

export interface DesktopDaemonStatus {
  serverId: string;
  status: DesktopDaemonState;
  listen: string | null;
  hostname: string | null;
  pid: number | null;
  home: string;
  version: string | null;
  desktopManaged: boolean;
  error: string | null;
}

export interface DesktopDaemonLogs {
  logPath: string;
  contents: string;
}

export interface DesktopAppLogs {
  logPath: string;
  contents: string;
}

export interface LocalTransportTarget {
  [key: string]: unknown;
  transportType: "socket" | "pipe";
  transportPath: string;
}

export interface RemoteSshTransportTarget {
  [key: string]: unknown;
  transportType: "ssh";
  host: string;
  sshPort?: number;
  daemonPort?: number;
  /**
   * Answers ssh's own password prompt (askpass in the shell). Never part of
   * the transport URL or the host registry: it lives in memory only.
   */
  sshPassword?: string;
}

export type DesktopDaemonTransportTarget = LocalTransportTarget | RemoteSshTransportTarget;

export interface OpenLocalTransportSessionInput {
  [key: string]: unknown;
  sessionId: string;
  target: DesktopDaemonTransportTarget;
  /** WebSocket subprotocols for the handshake (`paseo.bearer.<daemon password>`). */
  protocols?: string[];
}

/** Structured reading of a transport error the UI can act on. */
export interface LocalTransportErrorDetail {
  kind: string;
  methods?: string[];
  passwordTried?: boolean;
}

export interface LocalTransportEventPayload {
  sessionId: string;
  kind: "open" | "message" | "close" | "error";
  text?: string | null;
  binaryBase64?: string | null;
  code?: number | null;
  reason?: string | null;
  error?: string | null;
  detail?: LocalTransportErrorDetail | null;
}

function parseErrorDetail(value: unknown): LocalTransportErrorDetail | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = toStringOrNull(value.kind);
  if (!kind) {
    return null;
  }
  const methods = Array.isArray(value.methods)
    ? value.methods.filter((method): method is string => typeof method === "string")
    : undefined;
  return {
    kind,
    ...(methods ? { methods } : {}),
    ...(typeof value.passwordTried === "boolean" ? { passwordTried: value.passwordTried } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDesktopDaemonState(value: unknown): DesktopDaemonState {
  const normalized = toStringOrNull(value)?.toLowerCase();
  switch (normalized) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "errored":
    case "error":
      return "errored";
    case "stopped":
    case "stopping":
    case "unknown":
    default:
      return "stopped";
  }
}

function parseDesktopDaemonStatus(raw: unknown): DesktopDaemonStatus {
  if (!isRecord(raw)) {
    throw new Error("Unexpected desktop daemon status response.");
  }
  return {
    serverId: toStringOrNull(raw.serverId) ?? "",
    status: parseDesktopDaemonState(raw.status),
    listen: toStringOrNull(raw.listen),
    hostname: toStringOrNull(raw.hostname),
    pid: toNumberOrNull(raw.pid),
    home: toStringOrNull(raw.home) ?? "",
    version: toStringOrNull(raw.version),
    desktopManaged: raw.desktopManaged === true,
    error: toStringOrNull(raw.error),
  };
}

function parseDesktopDaemonLogs(raw: unknown): DesktopDaemonLogs {
  if (!isRecord(raw)) {
    throw new Error("Unexpected desktop daemon logs response.");
  }
  return {
    logPath: toStringOrNull(raw.logPath) ?? "",
    contents: typeof raw.contents === "string" ? raw.contents : "",
  };
}

export function shouldUseDesktopDaemon(): boolean {
  return isElectronRuntime();
}

export async function getDesktopDaemonStatus(): Promise<DesktopDaemonStatus> {
  return parseDesktopDaemonStatus(await invokeDesktopCommand("desktop_daemon_status"));
}

export async function startDesktopDaemon(): Promise<DesktopDaemonStatus> {
  return parseDesktopDaemonStatus(await invokeDesktopCommand("start_desktop_daemon"));
}

export async function stopDesktopDaemon(
  reason: DesktopDaemonStopReason = "manual_ipc",
): Promise<DesktopDaemonStatus> {
  return parseDesktopDaemonStatus(await invokeDesktopCommand("stop_desktop_daemon", { reason }));
}

export async function restartDesktopDaemon(): Promise<DesktopDaemonStatus> {
  return parseDesktopDaemonStatus(await invokeDesktopCommand("restart_desktop_daemon"));
}

export async function getDesktopDaemonLogs(): Promise<DesktopDaemonLogs> {
  return parseDesktopDaemonLogs(await invokeDesktopCommand("desktop_daemon_logs"));
}

export async function getDesktopAppLogs(): Promise<DesktopAppLogs> {
  const raw = await invokeDesktopCommand("desktop_app_logs");
  if (!isRecord(raw)) {
    throw new Error("Unexpected desktop app logs response.");
  }
  return {
    logPath: toStringOrNull(raw.logPath) ?? "",
    contents: typeof raw.contents === "string" ? raw.contents : "",
  };
}

export async function getCliDaemonStatus(): Promise<string> {
  const raw = await invokeDesktopCommand<unknown>("cli_daemon_status");
  if (typeof raw !== "string") {
    throw new Error("Unexpected CLI daemon status response.");
  }
  return raw;
}

export type LocalTransportEventUnlisten = () => void;
export type LocalTransportEventHandler = (payload: LocalTransportEventPayload) => void;

export async function listenToLocalTransportEvents(
  handler: LocalTransportEventHandler,
): Promise<LocalTransportEventUnlisten> {
  if (typeof getDesktopHost()?.events?.on !== "function") {
    throw new Error("Desktop events API is unavailable.");
  }
  // `listenToDesktopEvent` strips a `{payload}` envelope, so a shell that
  // forwards its native event object still delivers the bare payload here.
  return listenToDesktopEvent<unknown>("local-daemon-transport-event", (payload) => {
    if (!isRecord(payload)) {
      return;
    }
    handler({
      sessionId: toStringOrNull(payload.sessionId) ?? "",
      kind: (toStringOrNull(payload.kind) ?? "error") as LocalTransportEventPayload["kind"],
      text: toStringOrNull(payload.text),
      binaryBase64: toStringOrNull(payload.binaryBase64),
      code: toNumberOrNull(payload.code),
      reason: toStringOrNull(payload.reason),
      error: toStringOrNull(payload.error),
      detail: parseErrorDetail(payload.detail),
    });
  });
}

export async function openLocalTransportSession(
  input: OpenLocalTransportSessionInput,
): Promise<void> {
  await invokeDesktopCommand("open_local_daemon_transport", input);
}

export async function sendLocalTransportMessage(input: {
  sessionId: string;
  text?: string;
  binaryBase64?: string;
}): Promise<void> {
  await invokeDesktopCommand("send_local_daemon_transport_message", {
    sessionId: input.sessionId,
    ...(input.text ? { text: input.text } : {}),
    ...(input.binaryBase64 ? { binaryBase64: input.binaryBase64 } : {}),
  });
}

export async function closeLocalTransportSession(sessionId: string): Promise<void> {
  await invokeDesktopCommand("close_local_daemon_transport", { sessionId });
}

// ---------------------------------------------------------------------------
// Local daemon bundle (sidecar)
// ---------------------------------------------------------------------------

export interface LocalDaemonBundleStatus {
  installed: boolean;
  version: string | null;
  platform: string;
  arch: string;
  path: string | null;
  downloading: { received: number; total: number | null } | null;
}

function parseLocalDaemonBundleStatus(raw: unknown): LocalDaemonBundleStatus {
  if (!isRecord(raw)) {
    throw new Error("Unexpected local daemon bundle status response.");
  }
  const downloading = isRecord(raw.downloading) ? raw.downloading : null;
  return {
    installed: raw.installed === true,
    version: toStringOrNull(raw.version),
    platform: toStringOrNull(raw.platform) ?? "",
    arch: toStringOrNull(raw.arch) ?? "",
    path: toStringOrNull(raw.path),
    downloading: downloading
      ? {
          received: toNumberOrNull(downloading.received) ?? 0,
          total: toNumberOrNull(downloading.total),
        }
      : null,
  };
}

export async function getLocalDaemonBundleStatus(): Promise<LocalDaemonBundleStatus> {
  return parseLocalDaemonBundleStatus(await invokeDesktopCommand("local_daemon_bundle_status"));
}

/** Whether a bundle is installed; `false` on a shell without the command. */
export async function isLocalDaemonBundleInstalled(): Promise<boolean> {
  try {
    return (await getLocalDaemonBundleStatus()).installed;
  } catch {
    return false;
  }
}

export async function installLocalDaemonBundle(version?: string): Promise<LocalDaemonBundleStatus> {
  return parseLocalDaemonBundleStatus(
    await invokeDesktopCommand("install_local_daemon_bundle", version ? { version } : {}),
  );
}

export async function listenToLocalDaemonInstallEvents(
  handler: (event: LocalDaemonInstallEvent) => void,
): Promise<LocalTransportEventUnlisten> {
  if (typeof getDesktopHost()?.events?.on !== "function") {
    throw new Error("Desktop events API is unavailable.");
  }
  return listenToDesktopEvent<unknown>("local-daemon-install-event", (payload) => {
    handler(parseLocalDaemonInstallEvent(payload));
  });
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

export interface InstallStatus {
  installed: boolean;
}

function parseInstallStatus(raw: unknown): InstallStatus {
  if (!isRecord(raw)) {
    throw new Error("Unexpected install status response.");
  }
  return { installed: raw.installed === true };
}

export async function getCliInstallStatus(): Promise<InstallStatus> {
  return parseInstallStatus(await invokeDesktopCommand("get_cli_install_status"));
}

export async function installCli(): Promise<InstallStatus> {
  return parseInstallStatus(await invokeDesktopCommand("install_cli"));
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
export function readLegacySkillSelection(): Promise<AgentSkillSelection | null> {
  return invokeDesktopCommand("read_legacy_skill_selection") as Promise<AgentSkillSelection | null>;
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
export async function deleteLegacySkillSelection(): Promise<void> {
  await invokeDesktopCommand("delete_legacy_skill_selection");
}
