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
    command: {
      program: "/opt/frogg/bin/frogg",
      args: ["daemon", "start", "--foreground"],
    },
    listen: "127.0.0.1:9991",
    froggHome: path.join(HOME_DIR, ".frogg"),
    pathPrepend: "/opt/frogg/bin",
    ...overrides,
  };
}

describe("systemd user unit", () => {
  test("preserves execution descendants only when explicitly opted in", () => {
    const legacy = resolveServicePlan(planInput());
    expect(legacy.file?.contents).toContain("KillMode=mixed");
    expect(legacy.file?.contents).not.toContain("FROGG_EXECUTION_SERVICE");
    const independent = resolveServicePlan(planInput({ env: { FROGG_EXECUTION_SERVICE: "1" } }));
    expect(independent.file?.contents).toContain("KillMode=process");
    expect(independent.file?.contents).toContain(
      'ExecStop="/opt/frogg/bin/frogg" "daemon" "stop" "--force"',
    );
    expect(independent.file?.contents).toContain("Environment=FROGG_EXECUTION_SERVICE=1");
  });

  test("is written under XDG_CONFIG_HOME and starts the daemon in the foreground", () => {
    const plan = resolveServicePlan(
      planInput({
        env: { PATH: "/usr/bin:/bin", XDG_CONFIG_HOME: "/scratch/config" },
      }),
    );

    expect(plan.file?.path).toBe(`/scratch/config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).toContain(
      'ExecStart="/opt/frogg/bin/frogg" "daemon" "start" "--foreground"',
    );
    expect(plan.file?.contents).toContain("Environment=FROGG_LISTEN=127.0.0.1:9991");
    expect(plan.file?.contents).toContain(`Environment="FROGG_HOME=${HOME_DIR}/.frogg"`);
    expect(plan.file?.contents).toContain('Environment="PATH=/opt/frogg/bin:/usr/bin:/bin"');
    expect(plan.file?.contents).toContain("WantedBy=default.target");
    expect(plan.install).toContainEqual({
      program: "systemctl",
      args: ["--user", "enable", SERVICE_NAME],
    });
    expect(plan.hints.join(" ")).toContain("loginctl enable-linger");
  });

  test("falls back to ~/.config and omits FROGG_HOME when the home is not pinned", () => {
    const plan = resolveServicePlan(planInput({ froggHome: undefined }));
    expect(plan.file?.path).toBe(`${HOME_DIR}/.config/systemd/user/${SERVICE_NAME}.service`);
    expect(plan.file?.contents).not.toContain("FROGG_HOME");
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
    const plan = resolveServicePlan(
      planInput({ platform: "darwin", env: { PATH: "/usr/bin", UID: "501" } }),
    );

    expect(plan.label).toBe(LAUNCHD_LABEL);
    expect(plan.file?.path).toBe(`${HOME_DIR}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`);
    const contents = plan.file?.contents ?? "";
    expect(contents).toContain(`<key>Label</key><string>${LAUNCHD_LABEL}</string>`);
    expect(contents).toContain("<string>/opt/frogg/bin/frogg</string>");
    expect(contents).toContain("<string>--foreground</string>");
    expect(contents).toContain("<key>FROGG_LISTEN</key><string>127.0.0.1:9991</string>");
    expect(contents).toContain(`<key>FROGG_HOME</key><string>${HOME_DIR}/.frogg</string>`);
    expect(contents).toContain("<key>RunAtLoad</key><true/>");
    expect(contents).toContain(
      "<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>",
    );
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
          program: "C:\\Program Files\\Frogg\\frogg.exe",
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
        '\\"C:\\Program Files\\Frogg\\frogg.exe\\" daemon start --foreground --listen 127.0.0.1:9991',
        "/RL",
        "LIMITED",
        "/F",
      ],
    });
    expect(plan.uninstall).toEqual([
      {
        program: "schtasks",
        args: ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"],
      },
    ]);
  });
});
