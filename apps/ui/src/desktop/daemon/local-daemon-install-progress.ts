// Pure helpers for the local daemon bundle install flow: the progress state
// machine fed by `paseo:event:local-daemon-install-event` and the byte
// formatting the install button and progress bar show.

export type LocalDaemonInstallPhase = "checksum" | "download" | "extract";

export interface LocalDaemonInstallEvent {
  kind: "progress" | "done" | "error";
  received?: number | null;
  total?: number | null;
  detail?: string | null;
  version?: string | null;
}

export type LocalDaemonInstallProgress =
  | { status: "idle" }
  | {
      status: "installing";
      phase: LocalDaemonInstallPhase;
      received: number;
      total: number | null;
    }
  | { status: "done"; version: string | null }
  | { status: "error"; message: string };

export const IDLE_INSTALL_PROGRESS: LocalDaemonInstallProgress = { status: "idle" };

/** Rough size of a bundle archive, shown before the download reports a total. */
export const APPROXIMATE_BUNDLE_SIZE_BYTES = 180 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toPhase(value: unknown): LocalDaemonInstallPhase {
  return value === "checksum" || value === "extract" ? value : "download";
}

/** Parses a raw event payload; anything unrecognised becomes an error event. */
export function parseLocalDaemonInstallEvent(raw: unknown): LocalDaemonInstallEvent {
  if (!isRecord(raw)) {
    return { kind: "error", detail: "Unexpected install event." };
  }
  const kind = raw.kind === "progress" || raw.kind === "done" ? raw.kind : "error";
  return {
    kind,
    received: toNumber(raw.received),
    total: toNumber(raw.total),
    detail: typeof raw.detail === "string" ? raw.detail : null,
    version: typeof raw.version === "string" ? raw.version : null,
  };
}

export function reduceLocalDaemonInstallProgress(
  _current: LocalDaemonInstallProgress,
  event: LocalDaemonInstallEvent,
): LocalDaemonInstallProgress {
  switch (event.kind) {
    case "progress":
      return {
        status: "installing",
        phase: toPhase(event.detail),
        received: event.received ?? 0,
        total: event.total ?? null,
      };
    case "done":
      return { status: "done", version: event.version ?? null };
    default:
      return { status: "error", message: event.detail ?? "Install failed." };
  }
}

/** 0..1 for the progress bar; `null` when the total is unknown (indeterminate). */
export function installProgressFraction(progress: LocalDaemonInstallProgress): number | null {
  if (progress.status === "done") {
    return 1;
  }
  if (progress.status !== "installing") {
    return null;
  }
  if (progress.phase === "extract") {
    return 1;
  }
  if (progress.total === null || progress.total <= 0) {
    return null;
  }
  return Math.min(1, progress.received / progress.total);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

/** "42 MB / 180 MB" while downloading; "42 MB" when the total is unknown. */
export function formatInstallProgress(progress: LocalDaemonInstallProgress): string | null {
  if (progress.status !== "installing" || progress.phase !== "download") {
    return null;
  }
  const received = formatBytes(progress.received);
  return progress.total ? `${received} / ${formatBytes(progress.total)}` : received;
}
