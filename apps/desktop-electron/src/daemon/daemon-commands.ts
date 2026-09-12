import { bundledDaemon } from "./bundled-daemon.js";
import { listSshConfigHosts } from "../integrations/ssh-config.js";
import { createSshDeployCommandHandlers } from "../deploy/commands.js";
import { localAddresses, reverseLookup, probeIdentity } from "../network-service.js";
import { powerMonitor } from "electron";
import { handleDesktopIpc } from "../ipc-security.js";
import {
  copyAttachmentFileToManagedStorage,
  deleteManagedAttachmentFile,
  garbageCollectManagedAttachmentFiles,
  readManagedFileBase64,
  writeAttachmentBase64,
  writeAttachmentBytes,
} from "../features/attachments.js";
import {
  getAppUpdateStrategy,
  checkForAppUpdate,
  downloadAndInstallUpdate,
} from "../features/auto-updater.js";
import { getCliInstallStatus, installCli } from "../integrations/cli-install/index.js";
import {
  openLocalTransportSession,
  sendLocalTransportMessage,
  closeLocalTransportSession,
} from "./local-transport.js";
import {
  createDesktopSettingsCommandHandlers,
  type DesktopCommandHandler,
} from "../settings/desktop-settings-commands.js";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import { isRunningUnderARM64Translation } from "../system/arm64-translation.js";
import { getDesktopAppLogs } from "../diagnostics/app-logs.js";
import {
  deleteLegacySkillSelection,
  readLegacySkillSelection,
} from "../integrations/legacy-skill-selection.js";

import {
  parseAppUpdateCheckIntent,
  parseDesktopDaemonStopReason,
  resolveDesktopAppVersion,
  startDaemon,
  restartDaemon,
  getDaemonLogs,
  getCliDaemonStatus,
  getLocalDaemonVersion,
  resolveRequestedReleaseChannel,
  resolveDesktopDaemonStatus,
  stopDesktopDaemon,
} from "./daemon-manager.js";

// ---------------------------------------------------------------------------
// IPC registration
// ---------------------------------------------------------------------------

export function createDaemonCommandHandlers(): Record<string, DesktopCommandHandler> {
  return {
    ...createSshDeployCommandHandlers(),
    local_daemon_bundle_status: () => bundledDaemon.status(),
    install_local_daemon_bundle: (args) => bundledDaemon.install(args),
    run_local_daemon_update: () => bundledDaemon.update(),
    list_ssh_config_hosts: () => listSshConfigHosts(),
    network_local_addresses: () => localAddresses(),
    network_reverse_lookup: (args) => reverseLookup(args?.ip),
    network_probe_identity: (args) => probeIdentity(args?.url),
    ...createDesktopSettingsCommandHandlers({
      settingsStore: getDesktopSettingsStore(),
    }),
    desktop_get_runtime_info: () => ({
      appVersion: resolveDesktopAppVersion(),
      updateStrategy: getAppUpdateStrategy(),
      runningUnderARM64Translation: isRunningUnderARM64Translation(),
    }),
    desktop_daemon_status: () => resolveDesktopDaemonStatus(),
    start_desktop_daemon: () => startDaemon(),
    stop_desktop_daemon: (args) => stopDesktopDaemon(parseDesktopDaemonStopReason(args)),
    restart_desktop_daemon: () => restartDaemon(),
    desktop_daemon_logs: () => getDaemonLogs(),
    desktop_app_logs: () => getDesktopAppLogs(),
    desktop_get_system_idle_time: () => powerMonitor.getSystemIdleTime() * 1000,
    cli_daemon_status: () => getCliDaemonStatus(),
    write_attachment_base64: (args) => writeAttachmentBase64(args ?? {}),
    write_attachment_bytes: (args) => writeAttachmentBytes(args ?? {}),
    copy_attachment_file: (args) => copyAttachmentFileToManagedStorage(args ?? {}),
    read_file_base64: (args) => readManagedFileBase64(args ?? {}),
    delete_attachment_file: (args) => deleteManagedAttachmentFile(args ?? {}),
    garbage_collect_attachment_files: (args) => garbageCollectManagedAttachmentFiles(args ?? {}),
    open_local_daemon_transport: async (args) => await openLocalTransportSession(args),
    send_local_daemon_transport_message: async (args) => {
      await sendLocalTransportMessage(
        args as { sessionId: string; text?: string; binaryBase64?: string },
      );
    },
    close_local_daemon_transport: (args) => {
      const sessionId =
        typeof args === "object" && args !== null && "sessionId" in args
          ? (args as { sessionId: string }).sessionId
          : "";
      if (sessionId) closeLocalTransportSession(sessionId);
    },
    get_app_update_strategy: () => getAppUpdateStrategy(),
    check_app_update: async (args) => {
      const currentVersion = resolveDesktopAppVersion();
      return checkForAppUpdate({
        currentVersion,
        releaseChannel: await resolveRequestedReleaseChannel(args),
        intent: parseAppUpdateCheckIntent(args),
      });
    },
    install_app_update: async (args) => {
      const currentVersion = resolveDesktopAppVersion();
      return downloadAndInstallUpdate(
        {
          currentVersion,
          releaseChannel: await resolveRequestedReleaseChannel(args),
        },
        async () => {
          await stopDesktopDaemon("app_update");
        },
      );
    },
    get_local_daemon_version: () => getLocalDaemonVersion(),
    install_cli: () => installCli(),
    get_cli_install_status: () => getCliInstallStatus(),
    read_legacy_skill_selection: () => readLegacySkillSelection(),
    delete_legacy_skill_selection: () => deleteLegacySkillSelection(),
  };
}

export function registerDaemonManager(): void {
  const handlers = createDaemonCommandHandlers();

  handleDesktopIpc(
    "paseo:invoke",
    async (
      _event: Electron.IpcMainInvokeEvent,
      command: string,
      args?: Record<string, unknown>,
    ) => {
      const handler = handlers[command];
      if (!handler) {
        throw new Error(`Unknown desktop command: ${command}`);
      }
      return await handler(args);
    },
  );
}
