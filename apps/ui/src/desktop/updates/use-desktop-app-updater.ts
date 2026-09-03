import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  checkDesktopAppUpdate,
  formatVersionWithPrefix,
  installDesktopAppUpdate,
  listenToDesktopAppUpdateAvailable,
  shouldShowDesktopUpdateSection,
  type DesktopAppUpdateCheckResult,
  type DesktopAppUpdateCheckIntent,
  type DesktopAppUpdateInstallResult,
} from "@/desktop/updates/desktop-updates";
import {
  IDLE_APP_UPDATE_PROGRESS,
  listenToDesktopAppUpdateProgress,
  reduceAppUpdateProgress,
  type AppUpdateProgress,
} from "@/desktop/updates/app-update-progress";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import {
  PENDING_RECHECK_MS,
  createDesktopAppUpdater,
  formatStatusText,
  type DesktopAppUpdateStatus,
} from "@/desktop/updates/desktop-app-updater";
import { formatMessageTimestamp } from "@/utils/time";

export type { DesktopAppUpdateStatus };

export interface UseDesktopAppUpdaterReturn {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  statusText: string;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  isChecking: boolean;
  isInstalling: boolean;
  /** Download / verify / install progress reported by the shell while installing. */
  progress: AppUpdateProgress;
  checkForUpdates: (options?: {
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }) => Promise<DesktopAppUpdateCheckResult | null>;
  installUpdate: () => Promise<DesktopAppUpdateInstallResult | null>;
}

export function useDesktopAppUpdater(): UseDesktopAppUpdaterReturn {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const { settings: desktopSettings } = useDesktopSettings();
  const releaseChannel = desktopSettings.releaseChannel;
  const reportError = useDesktopIpcErrorReporter();
  const [progress, setProgress] = useState<AppUpdateProgress>(IDLE_APP_UPDATE_PROGRESS);

  const updater = useMemo(
    () =>
      createDesktopAppUpdater({
        port: {
          checkDesktopAppUpdate,
          installDesktopAppUpdate,
        },
        now: () => Date.now(),
        reportInstallError: reportError,
      }),
    [reportError],
  );

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: { intent?: DesktopAppUpdateCheckIntent; silent?: boolean } = {}) => {
      if (!isDesktopApp) {
        return null;
      }
      return updater.checkForUpdates({
        releaseChannel,
        intent: options.intent ?? "manual",
        silent: options.silent,
      });
    },
    [isDesktopApp, releaseChannel, updater],
  );

  // Progress events only matter while an install runs; the shell emits them
  // on `paseo:event:app-update-progress`.
  const installUpdate = useCallback(async () => {
    if (!isDesktopApp) {
      return null;
    }
    setProgress({ status: "active", phase: "download", received: 0, total: null });
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listenToDesktopAppUpdateProgress((event) => {
        setProgress((current) => reduceAppUpdateProgress(current, event));
      });
    } catch {
      // No event API: the install still runs, only without a progress bar.
    }
    try {
      const result = await updater.installUpdate({ releaseChannel });
      setProgress((current) => (current.status === "error" ? current : IDLE_APP_UPDATE_PROGRESS));
      return result;
    } finally {
      unlisten?.();
    }
  }, [isDesktopApp, releaseChannel, updater]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates({ intent: "automatic", silent: true });
  }, [checkForUpdates, isDesktopApp]);

  // The shell's own checks (every 6 h, and the cached answer to any check)
  // announce a newer version here; an automatic re-check is served from that
  // cache, so this only refreshes local state.
  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenToDesktopAppUpdateAvailable(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
        return;
      })
      .catch(() => {
        // No event API on this host: polling still covers it.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [checkForUpdates, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp || snapshot.status !== "pending") {
      return undefined;
    }

    const intervalId = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, PENDING_RECHECK_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [checkForUpdates, isDesktopApp, snapshot.status]);

  return {
    isDesktopApp,
    status: snapshot.status,
    statusText: formatStatusText({
      status: snapshot.status,
      availableUpdate: snapshot.availableUpdate,
      installMessage: snapshot.installMessage,
      lastCheckedAt: snapshot.lastCheckedAt,
      formatVersion: formatVersionWithPrefix,
      formatLastCheckedAt: (timestamp) => formatMessageTimestamp(new Date(timestamp)),
    }),
    availableUpdate: snapshot.availableUpdate,
    errorMessage: snapshot.errorMessage,
    lastCheckedAt: snapshot.lastCheckedAt,
    isChecking: snapshot.isChecking,
    isInstalling: snapshot.isInstalling,
    progress,
    checkForUpdates,
    installUpdate,
  };
}
