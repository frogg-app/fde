import { isElectronRuntime } from "@/desktop/host";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { listenToDesktopEvent, type DesktopEventUnlisten } from "@/desktop/electron/events";
import { isWeb } from "@/constants/platform";
import { i18n } from "@/i18n/i18next";

export type DesktopUpdateStrategy = "tauri-signed" | "github-release";

/**
 * How the shell applies the update once downloaded (`src/updates/assets.rs`):
 * the Windows installer and portable exe replace themselves and relaunch, the
 * AppImage is swapped in place, the deb opens in the package installer and the
 * DMG is opened for a manual drag.
 */
export type DesktopUpdateInstallKind =
  | "windows-installer"
  | "windows-portable"
  | "linux-appimage"
  | "linux-deb"
  | "macos-dmg";

export interface DesktopAppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
  /** Release body markdown (same text as `body`; the Settings page renders it). */
  notes: string | null;
  /** Name of the asset the install step downloads, when one exists for this platform. */
  assetName: string | null;
  assetSize: number | null;
  installKind: DesktopUpdateInstallKind | null;
  releaseUrl: string | null;
  strategy: DesktopUpdateStrategy | null;
  /** Unix ms of the check that produced this result (may be a cached answer). */
  checkedAt: number | null;
}

export interface DesktopAppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
  restartRequired: boolean;
}

export interface DesktopRuntimeInfo {
  appVersion: string | null;
  runningUnderARM64Translation: boolean;
  updateStrategy: DesktopUpdateStrategy | null;
}

export type DesktopReleaseChannel = "stable" | "beta";
export type DesktopAppUpdateCheckIntent = "automatic" | "manual";

export interface LocalDaemonUpdateResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface LocalDaemonVersionResult {
  version: string | null;
  error: string | null;
}

const RELEASE_DOWNLOAD_BASE_URL = "https://github.com/frogg-app/frogg-de/releases/download";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumberOr(defaultValue: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : defaultValue;
}

export function shouldShowDesktopUpdateSection(): boolean {
  return isWeb && isElectronRuntime();
}

export function parseDesktopUpdateStrategy(value: unknown): DesktopUpdateStrategy | null {
  return value === "tauri-signed" || value === "github-release" ? value : null;
}

const INSTALL_KINDS: readonly DesktopUpdateInstallKind[] = [
  "windows-installer",
  "windows-portable",
  "linux-appimage",
  "linux-deb",
  "macos-dmg",
];

export function parseDesktopUpdateInstallKind(value: unknown): DesktopUpdateInstallKind | null {
  return typeof value === "string" && (INSTALL_KINDS as readonly string[]).includes(value)
    ? (value as DesktopUpdateInstallKind)
    : null;
}

function toPositiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function parseLocalDaemonVersionResult(raw: unknown): LocalDaemonVersionResult {
  if (!isRecord(raw)) {
    return { version: null, error: "Unexpected response from version check." };
  }

  return {
    version: toStringOrNull(raw.version),
    error: toStringOrNull(raw.error),
  };
}

export async function getLocalDaemonVersion(): Promise<LocalDaemonVersionResult> {
  const result = await invokeDesktopCommand<unknown>("get_local_daemon_version");
  return parseLocalDaemonVersionResult(result);
}

export function parseDesktopRuntimeInfo(raw: unknown): DesktopRuntimeInfo {
  if (!isRecord(raw)) {
    return {
      appVersion: null,
      runningUnderARM64Translation: false,
      updateStrategy: null,
    };
  }

  return {
    appVersion: toStringOrNull(raw.appVersion),
    runningUnderARM64Translation: raw.runningUnderARM64Translation === true,
    updateStrategy: parseDesktopUpdateStrategy(raw.updateStrategy),
  };
}

export async function getDesktopRuntimeInfo(): Promise<DesktopRuntimeInfo> {
  const result = await invokeDesktopCommand<unknown>("desktop_get_runtime_info");
  return parseDesktopRuntimeInfo(result);
}

export function parseDesktopAppUpdateCheckResult(result: unknown): DesktopAppUpdateCheckResult {
  if (!isRecord(result)) {
    throw new Error("Unexpected response while checking desktop updates.");
  }
  const asset = isRecord(result.asset) ? result.asset : null;
  const body = toStringOrNull(result.body);

  return {
    hasUpdate: result.hasUpdate === true,
    readyToInstall: result.readyToInstall === true,
    currentVersion: toStringOrNull(result.currentVersion),
    latestVersion: toStringOrNull(result.latestVersion),
    body,
    date: toStringOrNull(result.date),
    errorMessage: toStringOrNull(result.errorMessage),
    notes: toStringOrNull(result.notes) ?? body,
    assetName: asset ? toStringOrNull(asset.name) : null,
    assetSize: asset ? toPositiveNumberOrNull(asset.size) : null,
    installKind: parseDesktopUpdateInstallKind(result.installKind),
    releaseUrl: toStringOrNull(result.releaseUrl),
    strategy: parseDesktopUpdateStrategy(result.strategy),
    checkedAt: toPositiveNumberOrNull(result.checkedAt),
  };
}

export async function checkDesktopAppUpdate({
  releaseChannel,
  intent,
}: {
  releaseChannel: DesktopReleaseChannel;
  intent: DesktopAppUpdateCheckIntent;
}): Promise<DesktopAppUpdateCheckResult> {
  const result = await invokeDesktopCommand<unknown>("check_app_update", {
    releaseChannel,
    intent,
  });
  return parseDesktopAppUpdateCheckResult(result);
}

export async function installDesktopAppUpdate({
  releaseChannel,
}: {
  releaseChannel: DesktopReleaseChannel;
}): Promise<DesktopAppUpdateInstallResult> {
  const result = await invokeDesktopCommand<unknown>("install_app_update", { releaseChannel });
  if (!isRecord(result)) {
    throw new Error("Unexpected response while installing desktop update.");
  }

  return {
    installed: result.installed === true,
    version: toStringOrNull(result.version),
    message: toStringOrNull(result.message) ?? i18n.t("desktop.updates.status.installed"),
    restartRequired: result.restartRequired === true,
  };
}

/**
 * The shell emits this whenever a check (manual, automatic, or the 6-hourly
 * background one) finds a newer version; the payload is a check result.
 */
export async function listenToDesktopAppUpdateAvailable(
  handler: (result: DesktopAppUpdateCheckResult) => void,
): Promise<DesktopEventUnlisten> {
  return listenToDesktopEvent<unknown>("app-update-available", (payload) => {
    try {
      handler(parseDesktopAppUpdateCheckResult(payload));
    } catch (error) {
      console.warn("[DesktopUpdater] Ignoring malformed app-update-available event", error);
    }
  });
}

export async function runLocalDaemonUpdate(): Promise<LocalDaemonUpdateResult> {
  const result = await invokeDesktopCommand<unknown>("run_local_daemon_update");
  if (!isRecord(result)) {
    throw new Error("Unexpected response while updating local daemon.");
  }

  return {
    exitCode: toNumberOr(1, result.exitCode),
    stdout: toStringOrEmpty(result.stdout),
    stderr: toStringOrEmpty(result.stderr),
  };
}

export function normalizeVersionForComparison(version: string | null | undefined): string | null {
  const value = version?.trim();
  if (!value) {
    return null;
  }

  return value.replace(/^v/i, "");
}

export function isVersionMismatch(
  appVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const app = normalizeVersionForComparison(appVersion);
  const daemon = normalizeVersionForComparison(daemonVersion);

  if (!app || !daemon) {
    return false;
  }

  return app !== daemon;
}

export function formatVersionWithPrefix(version: string | null | undefined): string {
  const value = version?.trim();
  if (!value) {
    return "\u2014";
  }

  return value.startsWith("v") ? value : `v${value}`;
}

export function buildMacAppleSiliconDownloadUrl(version: string | null | undefined): string | null {
  const normalizedVersion = normalizeVersionForComparison(version);
  if (!normalizedVersion) {
    return null;
  }

  return `${RELEASE_DOWNLOAD_BASE_URL}/v${normalizedVersion}/FDE_${normalizedVersion}_aarch64.dmg`;
}

export function buildDaemonUpdateDiagnostics(result: LocalDaemonUpdateResult): string {
  const stdout = result.stdout.length > 0 ? result.stdout : "(empty)";
  const stderr = result.stderr.length > 0 ? result.stderr : "(empty)";

  return [`Exit code: ${result.exitCode}`, "", "STDOUT:", stdout, "", "STDERR:", stderr].join("\n");
}
