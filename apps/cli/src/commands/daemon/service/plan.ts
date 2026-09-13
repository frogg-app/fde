import { brand } from "@fde/branding";
import path from "node:path";

/**
 * What "start FDE when I log in" means on each platform, as data: a file to
 * write and commands to run. Pure — the caller supplies the home directory,
 * environment, and the command that starts the daemon — so the generated unit,
 * plist, and Windows command line are all testable against a scratch home.
 *
 * The Linux unit is the one `deploy/install.sh` writes, ported here so a host
 * that was set up by hand gets the same service as one set up by the installer.
 */
export const SERVICE_NAME = brand.serviceName;
export const LAUNCHD_LABEL = brand.launchdLabel;
export const WINDOWS_TASK_NAME = `${brand.name} Daemon`;
export const DEFAULT_SERVICE_LISTEN = `127.0.0.1:${brand.daemonPort}`;

export type ServicePlatform = "linux" | "darwin" | "win32";

export interface ServiceCommand {
  program: string;
  args: string[];
}

export interface ServicePlanInput {
  platform: ServicePlatform;
  /** The user's home directory (`os.homedir()` in production). */
  homeDir: string;
  env: NodeJS.ProcessEnv;
  /** How to start the daemon in the foreground. */
  command: ServiceCommand;
  listen: string;
  /** Written into the unit as `FDE_HOME` when the caller pinned one. */
  fdeHome?: string;
  /** Prepended to the service's PATH so agent CLIs stay visible to the daemon. */
  pathPrepend?: string;
}

export interface ServiceFile {
  path: string;
  contents: string;
}

export interface ServicePlan {
  platform: ServicePlatform;
  label: string;
  /** The unit/plist to write; absent on Windows, where the task is the record. */
  file: ServiceFile | null;
  /** Commands that register and start the service, in order. */
  install: ServiceCommand[];
  /** Commands that stop and deregister it, in order. Failures are tolerated. */
  uninstall: ServiceCommand[];
  /** Shown after a successful install; empty when there is nothing to add. */
  hints: string[];
}

function quoteWindowsCommand(command: ServiceCommand): string {
  return [command.program, ...command.args]
    .map((part) => (part.includes(" ") ? `\\"${part}\\"` : part))
    .join(" ");
}

function systemdUnitPath(input: ServicePlanInput): string {
  const configHome = input.env.XDG_CONFIG_HOME?.trim() || path.join(input.homeDir, ".config");
  return path.join(configHome, "systemd", "user", `${SERVICE_NAME}.service`);
}

function servicePath(input: ServicePlanInput): string {
  const prepend = input.pathPrepend?.trim();
  const inherited = input.env.PATH ?? "";
  return prepend ? `${prepend}:${inherited}` : inherited;
}

function unitQuote(value: string): string {
  return (
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r") +
    '"'
  );
}
function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function systemdUnit(input: ServicePlanInput): string {
  const exec = [input.command.program, ...input.command.args].map(unitQuote).join(" ");
  const home = input.fdeHome
    ? `Environment=${unitQuote(`${brand.envPrefix}_HOME=${input.fdeHome}`)}\n`
    : "";
  const execution = input.env.FDE_EXECUTION_SERVICE === "1";
  const executionEnv = execution ? "Environment=FDE_EXECUTION_SERVICE=1\n" : "";
  const killMode = execution ? "process" : "mixed";
  let stop = "";
  if (execution) {
    const startIndex = input.command.args.lastIndexOf("start");
    if (startIndex < 0)
      throw new Error("Independent execution service requires a daemon start command");
    const stopArgs = [...input.command.args.slice(0, startIndex), "stop", "--force"];
    const stopExec = [input.command.program, ...stopArgs].map(unitQuote).join(" ");
    stop = `ExecStop=${stopExec}\n`;
  }
  return `[Unit]
Description=${brand.name} daemon (${brand.fullName})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
${stop}Environment=FDE_LISTEN=${input.listen}
Environment=FDE_WEB_UI_ENABLED=true
Environment=${unitQuote(`PATH=${servicePath(input)}`)}
${home}${executionEnv}Restart=on-failure
RestartSec=5
KillMode=${killMode}
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

function plistEntry(key: string, value: string): string {
  return `    <key>${xml(key)}</key><string>${xml(value)}</string>\n`;
}

function launchdPlist(input: ServicePlanInput): string {
  const programArguments = [input.command.program, ...input.command.args]
    .map((part) => `    <string>${xml(part)}</string>`)
    .join("\n");
  const logPath = path.join(input.homeDir, "Library", "Logs", `${LAUNCHD_LABEL}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${plistEntry("FDE_LISTEN", input.listen)}${plistEntry(
    "FDE_WEB_UI_ENABLED",
    "true",
  )}${plistEntry("PATH", servicePath(input))}${
    input.fdeHome ? plistEntry(`${brand.envPrefix}_HOME`, input.fdeHome) : ""
  }  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export function resolveServicePlan(input: ServicePlanInput): ServicePlan {
  if (input.platform === "linux") {
    const unitPath = systemdUnitPath(input);
    return {
      platform: "linux",
      label: SERVICE_NAME,
      file: { path: unitPath, contents: systemdUnit(input) },
      install: [
        { program: "systemctl", args: ["--user", "daemon-reload"] },
        { program: "systemctl", args: ["--user", "enable", SERVICE_NAME] },
        { program: "systemctl", args: ["--user", "restart", SERVICE_NAME] },
      ],
      uninstall: [
        {
          program: "systemctl",
          args: ["--user", "disable", "--now", SERVICE_NAME],
        },
        { program: "systemctl", args: ["--user", "daemon-reload"] },
      ],
      hints: [
        "To keep the daemon running after you log out: sudo loginctl enable-linger $(id -un)",
      ],
    };
  }

  if (input.platform === "darwin") {
    const plistPath = path.join(input.homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const domain = `gui/${input.env.UID ?? process.getuid?.() ?? ""}`;
    return {
      platform: "darwin",
      label: LAUNCHD_LABEL,
      file: { path: plistPath, contents: launchdPlist(input) },
      install: [
        { program: "launchctl", args: ["bootout", domain, plistPath] },
        { program: "launchctl", args: ["bootstrap", domain, plistPath] },
      ],
      uninstall: [{ program: "launchctl", args: ["bootout", domain, plistPath] }],
      hints: [],
    };
  }

  return {
    platform: "win32",
    label: WINDOWS_TASK_NAME,
    file: null,
    install: [
      {
        program: "schtasks",
        args: [
          "/Create",
          "/SC",
          "ONLOGON",
          "/TN",
          WINDOWS_TASK_NAME,
          "/TR",
          quoteWindowsCommand(input.command),
          "/RL",
          "LIMITED",
          "/F",
        ],
      },
      { program: "schtasks", args: ["/Run", "/TN", WINDOWS_TASK_NAME] },
    ],
    uninstall: [
      {
        program: "schtasks",
        args: ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"],
      },
    ],
    hints: [],
  };
}
