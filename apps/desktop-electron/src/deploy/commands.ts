import { app, BrowserWindow } from "electron";
import { brand } from "@fde/branding";
import { createSshPasswordEnvironment } from "../daemon/ssh-password.js";
import type { DesktopCommandHandler } from "../settings/desktop-settings-commands.js";
import { createScriptExecutor } from "./executor.js";
import { DeployManager } from "./manager.js";
import { buildProbeScript } from "./probe.js";
import { deployScript } from "./scripts.js";

export const DEPLOY_EVENT = "paseo:event:ssh-deploy-event";
let manager: DeployManager | undefined;
export function createSshDeployCommandHandlers(): Record<string, DesktopCommandHandler> {
  if (!manager) {
    manager = new DeployManager({
      execute: createScriptExecutor({
        passwordEnvironment: createSshPasswordEnvironment,
      }),
      brand: {
        envPrefix: brand.envPrefix,
        daemonPort: brand.daemonPort,
        releaseBase: brand.distribution.releaseBase,
      },
      defaultVersion: app.getVersion(),
      probeScript: buildProbeScript(brand),
      script: deployScript,
      emit(event) {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed())
            window.webContents.send(DEPLOY_EVENT, event);
        }
      },
    });
    app.on("before-quit", () => manager?.cancelAll());
  }
  const current = manager;
  return {
    ssh_deploy_probe: (args) => current.probe(args),
    ssh_deploy_start: (args) => current.start(args),
    ssh_deploy_uninstall: (args) => current.uninstall(args),
    ssh_deploy_cancel: (args) => current.cancel(args),
  };
}
