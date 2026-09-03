import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  LAUNCHD_LABEL,
  resolveServicePlan,
  SERVICE_NAME,
  WINDOWS_TASK_NAME,
  type ServicePlanInput,
} from "./plan.js";

const HOME_DIR = path.join("/scratch", "home", "dev");

function planInput(overrides: Partial<ServicePlanInput> = {}): ServicePlanInput {
  return {
    platform: "linux",
    homeDir: HOME_DIR,
    env: { PATH: "/usr/bin:/bin" },
    command: { program: "/opt/fde/bin/fde", args: ["daemon", "start", "--foreground"] },
    listen: "127.0.0.1:9991",
    fdeHome: path.join(HOME_DIR, ".fde"),
    pathPrepend: "/opt/fde/bin",
    ...overrides,
  };
}

describe("systemd user unit", () => {
  test("is written under XDG_CONFIG_HOME and starts the daemon in the foreground", () => {
    const plan = resolveServicePlan(
      planInput({ env: { PATH: "/usr/bin:/bin", XDG_CONFIG_HOME: "/scratch/config" } }),
    );

    expect(plan.file?.path).toBe(`/scratch/config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).toContain(
      "ExecStart=/opt/fde/bin/fde daemon start --foreground",
    );
    expect(plan.file?.contents).toContain("Environment=PASEO_LISTEN=127.0.0.1:9991");
    expect(plan.file?.contents).toContain(`Environment=FDE_HOME=${HOME_DIR}/.fde`);
    expect(plan.file?.contents).toContain("Environment=PATH=/opt/fde/bin:/usr/bin:/bin");
    expect(plan.file?.contents).toContain("WantedBy=default.target");
    expect(plan.install).toContainEqual({
      program: "systemctl",
      args: ["--user", "enable", SERVICE_NAME],
    });
    expect(plan.hints.join(" ")).toContain("loginctl enable-linger");
  });

  test("falls back to ~/.config and omits FDE_HOME when the home is not pinned", () => {
    const plan = resolveServicePlan(planInput({ fdeHome: undefined }));
    expect(plan.file?.path).toBe(`${HOME_DIR}/.config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).not.toContain("FDE_HOME");
  });

  test("uninstall disables the unit", () => {
    expect(resolveServicePlan(planInput()).uninstall).toContainEqual({
      program: "systemctl",
      args: ["--user", "disable", "--now", SERVICE_NAME],
    });
  });
});

describe("launchd agent", () => {
  test("writes a RunAtLoad plist into ~/Library/LaunchAgents", () => {
    const plan = resolveServicePlan(planInput({ platform: "darwin", env: { PATH: "/usr/bin", UID: "501" } }));

    expect(plan.label).toBe(LAUNCHD_LABEL);
    expect(plan.file?.path).toBe(`${HOME_DIR}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    const contents = plan.file?.contents ?? "";
    expect(contents).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
    expect(contents).toContain("<string>/opt/fde/bin/fde</string>");
    expect(contents).toContain("<string>--foreground</string>");
    expect(contents).toContain("<key>PASEO_LISTEN</key><string>127.0.0.1:9991</string>");
    expect(contents).toContain(`<key>FDE_HOME</key><string>${HOME_DIR}/.fde</string>`);
    expect(contents).toContain("<key>RunAtLoad</key><true/>");
    expect(plan.install.at(-1)).toEqual({
      program: "launchctl",
      args: ["bootstrap", "gui/501", plan.file?.path ?? ""],
    });
  });
});

describe("Windows logon task", () => {
  test("registers a schtasks ONLOGON task that runs the CLI", () => {
    const plan = resolveServicePlan(
      planInput({
        platform: "win32",
        env: { PATH: "C:\\Windows" },
        command: {
          program: "C:\\Program Files\\FDE\\fde.exe",
          args: ["daemon", "start", "--foreground", "--listen", "127.0.0.1:9991"],
        },
      }),
    );

    expect(plan.file).toBeNull();
    expect(plan.install[0]).toEqual({
      program: "schtasks",
      args: [
        "/Create",
        "/SC",
        "ONLOGON",
        "/TN",
        WINDOWS_TASK_NAME,
        "/TR",
        '\\"C:\\Program Files\\FDE\\fde.exe\\" daemon start --foreground --listen 127.0.0.1:9991',
        "/RL",
        "LIMITED",
        "/F",
      ],
    });
    expect(plan.uninstall).toEqual([
      { program: "schtasks", args: ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"] },
    ]);
  });
});
