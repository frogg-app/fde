import { listSshConfigHosts } from "./integrations/ssh-config.js";
import { createSshDeployCommandHandlers } from "./deploy/commands.js";
import { localAddresses, reverseLookup, probeIdentity } from "./network-service.js";
import { app, powerMonitor } from "electron";
import { handleDesktopIpc } from "./ipc-security.js";
import {
  copyAttachmentFileToManagedStorage,
  deleteManagedAttachmentFile,
  garbageCollectManagedAttachmentFiles,
  readManagedFileBase64,
  writeAttachmentBase64,
  writeAttachmentBytes,
} from "./features/attachments.js";
import {
  getAppUpdateStrategy,
  checkForAppUpdate,
  downloadAndInstallUpdate,
} from "./features/auto-updater.js";
import {
  openLocalTransportSession,
  sendLocalTransportMessage,
  closeLocalTransportSession,
} from "./daemon/local-transport.js";
import {
  createDesktopSettingsCommandHandlers,
  type DesktopCommandHandler,
} from "./settings/desktop-settings-commands.js";
import { getDesktopSettingsStore } from "./settings/desktop-settings-electron.js";
import { isRunningUnderARM64Translation } from "./system/arm64-translation.js";
import { getDesktopAppLogs } from "./diagnostics/app-logs.js";
import {
  deleteLegacySkillSelection,
  readLegacySkillSelection,
} from "./integrations/legacy-skill-selection.js";

import type { AppReleaseChannel } from "./features/auto-updater.js";

function unsupportedLocalServerCommand(): never {
  throw new Error(
    "FDE Electron is a client app. Install and manage the FDE server and CLI separately, then add a server connection in the app.",
  );
}

async function resolveRequestedReleaseChannel(
  args: Record<string, unknown> | undefined,
): Promise<AppReleaseChannel> {
  if (args?.releaseChannel === "beta" || args?.releaseChannel === "stable")
    return args.releaseChannel;
  return (await getDesktopSettingsStore().get()).releaseChannel;
}

export function createDesktopCommandHandlers(): Record<string, DesktopCommandHandler> {
  return {
    ...createSshDeployCommandHandlers(),
    local_daemon_bundle_status: unsupportedLocalServerCommand,
    install_local_daemon_bundle: unsupportedLocalServerCommand,
    run_local_daemon_update: unsupportedLocalServerCommand,
    list_ssh_config_hosts: () => listSshConfigHosts(),
    network_local_addresses: () => localAddresses(),
    network_reverse_lookup: (args) => reverseLookup(args?.ip),
    network_probe_identity: (args) => probeIdentity(args?.url),
    ...createDesktopSettingsCommandHandlers({
      settingsStore: getDesktopSettingsStore(),
    }),
    desktop_get_runtime_info: () => ({
      appVersion: app.getVersion(),
      updateStrategy: getAppUpdateStrategy(),
      runningUnderARM64Translation: isRunningUnderARM64Translation(),
    }),
    desktop_daemon_status: unsupportedLocalServerCommand,
    start_desktop_daemon: unsupportedLocalServerCommand,
    stop_desktop_daemon: unsupportedLocalServerCommand,
    restart_desktop_daemon: unsupportedLocalServerCommand,
    desktop_daemon_logs: unsupportedLocalServerCommand,
    desktop_app_logs: () => getDesktopAppLogs(),
    desktop_get_system_idle_time: () => powerMonitor.getSystemIdleTime() * 1000,
    cli_daemon_status: unsupportedLocalServerCommand,
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
      const currentVersion = app.getVersion();
      return checkForAppUpdate({
        currentVersion,
        releaseChannel: await resolveRequestedReleaseChannel(args),
        intent: args?.intent === "manual" ? "manual" : "automatic",
      });
    },
    install_app_update: async (args) => {
      const currentVersion = app.getVersion();
      return downloadAndInstallUpdate({
        currentVersion,
        releaseChannel: await resolveRequestedReleaseChannel(args),
      });
    },
    get_local_daemon_version: unsupportedLocalServerCommand,
    install_cli: unsupportedLocalServerCommand,
    get_cli_install_status: unsupportedLocalServerCommand,
    read_legacy_skill_selection: () => readLegacySkillSelection(),
    delete_legacy_skill_selection: () => deleteLegacySkillSelection(),
  };
}

export function registerDesktopCommands(): void {
  const handlers = createDesktopCommandHandlers();

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
