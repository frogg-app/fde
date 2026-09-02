import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import {
  getLocalDaemonBundleStatus,
  listenToLocalDaemonInstallEvents,
  shouldUseDesktopDaemon,
  type LocalDaemonBundleStatus,
} from "@/desktop/daemon/desktop-daemon";
import {
  IDLE_INSTALL_PROGRESS,
  reduceLocalDaemonInstallProgress,
  type LocalDaemonInstallProgress,
} from "@/desktop/daemon/local-daemon-install-progress";
import { setUpLocalDaemon } from "@/desktop/daemon/local-daemon-setup";
import type { DesktopDaemonStatus } from "@/desktop/daemon/desktop-daemon";

export const LOCAL_DAEMON_BUNDLE_QUERY_KEY = ["localDaemonBundleStatus"] as const;

export interface UseLocalDaemonBundleResult {
  bundle: LocalDaemonBundleStatus | null;
  isLoading: boolean;
  error: string | null;
  progress: LocalDaemonInstallProgress;
  isInstalling: boolean;
  /** Installs the bundle (when missing), enables management and starts the daemon. */
  installAndStart: () => Promise<DesktopDaemonStatus | null>;
  refetch: () => void;
}

export function useLocalDaemonBundle(options?: {
  onStarted?: (status: DesktopDaemonStatus) => void;
}): UseLocalDaemonBundleResult {
  const queryClient = useQueryClient();
  const enabled = shouldUseDesktopDaemon();
  const [progress, setProgress] = useState<LocalDaemonInstallProgress>(IDLE_INSTALL_PROGRESS);
  const onStartedRef = useRef(options?.onStarted);
  onStartedRef.current = options?.onStarted;

  const query = useFetchQuery<LocalDaemonBundleStatus, Error>({
    queryKey: LOCAL_DAEMON_BUNDLE_QUERY_KEY,
    enabled,
    dataShape: "value",
    staleTimeMs: 30_000,
    retry: false,
    queryFn: getLocalDaemonBundleStatus,
  });

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LOCAL_DAEMON_BUNDLE_QUERY_KEY });
  }, [queryClient]);

  // Install events only matter while an install runs; the shell emits them
  // on `paseo:event:local-daemon-install-event`.
  const { mutateAsync, isPending: isInstalling } = useMutation<DesktopDaemonStatus, Error>({
    mutationFn: async () => {
      const installed = query.data?.installed === true;
      let unlisten: (() => void) | null = null;
      if (!installed) {
        setProgress({ status: "installing", phase: "checksum", received: 0, total: null });
        try {
          unlisten = await listenToLocalDaemonInstallEvents((event) => {
            setProgress((current) => reduceLocalDaemonInstallProgress(current, event));
          });
        } catch {
          // No event API: the button still completes, only without a progress bar.
        }
      }
      try {
        return await setUpLocalDaemon({ install: !installed });
      } finally {
        unlisten?.();
      }
    },
    onSuccess: (status) => {
      setProgress(IDLE_INSTALL_PROGRESS);
      onStartedRef.current?.(status);
    },
    onError: (error) => {
      setProgress({ status: "error", message: error.message });
    },
    onSettled: () => {
      refetch();
      void queryClient.invalidateQueries({ queryKey: ["desktopDaemonStatus"] });
      void queryClient.invalidateQueries({ queryKey: ["desktop-settings"] });
    },
  });

  const installAndStart = useCallback(async () => {
    try {
      return await mutateAsync();
    } catch {
      // onError already recorded the message in `progress`.
      return null;
    }
  }, [mutateAsync]);

  useEffect(() => {
    if (!enabled) {
      setProgress(IDLE_INSTALL_PROGRESS);
    }
  }, [enabled]);

  return {
    bundle: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    progress,
    isInstalling,
    installAndStart,
    refetch,
  };
}
