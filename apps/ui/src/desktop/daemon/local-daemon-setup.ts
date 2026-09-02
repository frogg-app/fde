// "Run agents on this machine": install the bundle, turn built-in daemon
// management on, start the daemon and register the localhost connection.
// Shared by the onboarding card and the daemon settings section.

import {
  installLocalDaemonBundle,
  startDesktopDaemon,
  type DesktopDaemonStatus,
} from "@/desktop/daemon/desktop-daemon";
import { updatePersistedDesktopSettings } from "@/desktop/settings/desktop-settings";
import { upsertDesktopDaemonConnection } from "@/runtime/daemon-start-service";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export interface LocalDaemonSetupDeps {
  installBundle: () => Promise<unknown>;
  enableManagement: () => Promise<unknown>;
  startDaemon: () => Promise<DesktopDaemonStatus>;
  registerConnection: (
    status: DesktopDaemonStatus,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const defaultDeps: LocalDaemonSetupDeps = {
  installBundle: () => installLocalDaemonBundle(),
  enableManagement: () => updatePersistedDesktopSettings({ daemon: { manageBuiltInDaemon: true } }),
  startDaemon: startDesktopDaemon,
  registerConnection: (status) => upsertDesktopDaemonConnection(getHostRuntimeStore(), status),
};

/**
 * Installs (when `install` is true), enables management, starts, registers.
 * Management is persisted before the start so a failed start leaves the
 * toggle on and the status card explains the failure, as Electron's did.
 */
export async function setUpLocalDaemon(
  options: { install: boolean },
  deps: LocalDaemonSetupDeps = defaultDeps,
): Promise<DesktopDaemonStatus> {
  if (options.install) {
    await deps.installBundle();
  }
  await deps.enableManagement();
  const status = await deps.startDaemon();
  const registration = await deps.registerConnection(status);
  if (!registration.ok) {
    throw new Error(registration.error);
  }
  return status;
}
