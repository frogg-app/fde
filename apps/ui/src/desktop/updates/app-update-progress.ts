// Pure helpers for the app update install flow: the progress state fed by
// `paseo:event:app-update-progress` and the text the Settings section shows
// for each install kind.

import { listenToDesktopEvent, type DesktopEventUnlisten } from "@/desktop/electron/events";
import type { DesktopUpdateInstallKind } from "@/desktop/updates/desktop-updates";
import { formatBytes } from "@/desktop/daemon/local-daemon-install-progress";
import { i18n } from "@/i18n/i18next";

export type AppUpdateProgressPhase = "download" | "verify" | "install";

export interface AppUpdateProgressEvent {
  phase: AppUpdateProgressPhase | "error";
  received: number | null;
  total: number | null;
  detail: string | null;
}

export type AppUpdateProgress =
  | { status: "idle" }
  | { status: "active"; phase: AppUpdateProgressPhase; received: number; total: number | null }
  | { status: "error"; message: string };

export const IDLE_APP_UPDATE_PROGRESS: AppUpdateProgress = { status: "idle" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toPhase(value: unknown): AppUpdateProgressPhase | "error" {
  return value === "verify" || value === "install" || value === "error" ? value : "download";
}

export function parseAppUpdateProgressEvent(raw: unknown): AppUpdateProgressEvent {
  if (!isRecord(raw)) {
    return { phase: "error", received: null, total: null, detail: "Unexpected update event." };
  }
  return {
    phase: toPhase(raw.phase),
    received: toNumber(raw.received),
    total: toNumber(raw.total),
    detail: typeof raw.detail === "string" ? raw.detail : null,
  };
}

export function reduceAppUpdateProgress(
  current: AppUpdateProgress,
  event: AppUpdateProgressEvent,
): AppUpdateProgress {
  if (event.phase === "error") {
    return { status: "error", message: event.detail ?? "Update failed." };
  }
  const previousTotal = current.status === "active" ? current.total : null;
  return {
    status: "active",
    phase: event.phase,
    received: event.received ?? 0,
    total: event.total ?? previousTotal,
  };
}

/** 0..1 for the bar; `null` when indeterminate. */
export function appUpdateProgressFraction(progress: AppUpdateProgress): number | null {
  if (progress.status !== "active") {
    return null;
  }
  if (progress.phase !== "download") {
    return 1;
  }
  if (progress.total === null || progress.total <= 0) {
    return null;
  }
  return Math.min(1, progress.received / progress.total);
}

/** "12 MB / 80 MB" while downloading, "12 MB" without a known total. */
export function formatAppUpdateProgress(progress: AppUpdateProgress): string | null {
  if (progress.status !== "active" || progress.phase !== "download") {
    return null;
  }
  const received = formatBytes(progress.received);
  return progress.total ? `${received} / ${formatBytes(progress.total)}` : received;
}

export function describeAppUpdateProgress(progress: AppUpdateProgress): string {
  if (progress.status !== "active") {
    return "";
  }
  switch (progress.phase) {
    case "verify":
      return i18n.t("desktop.updates.section.verifying");
    case "install":
      return i18n.t("desktop.updates.section.installing");
    default:
      return i18n.t("desktop.updates.section.downloading", {
        progress: formatAppUpdateProgress(progress) ?? "",
      });
  }
}

/** What pressing "Download & install" will do on this platform. */
export function describeInstallKind(kind: DesktopUpdateInstallKind | null): string {
  switch (kind) {
    case "windows-installer":
    case "windows-portable":
    case "linux-appimage":
    case "linux-deb":
    case "macos-dmg":
      return i18n.t(`desktop.updates.section.installHint.${kind}`);
    default:
      return i18n.t("desktop.updates.section.installHint.unknown");
  }
}

export async function listenToDesktopAppUpdateProgress(
  handler: (event: AppUpdateProgressEvent) => void,
): Promise<DesktopEventUnlisten> {
  return listenToDesktopEvent<unknown>("app-update-progress", (payload) => {
    handler(parseAppUpdateProgressEvent(payload));
  });
}
