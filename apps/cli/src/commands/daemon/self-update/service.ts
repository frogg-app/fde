import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLocalDaemonState, stopLocalDaemon } from "../local-daemon.js";
import { bundleLauncherPath } from "./bundle.js";
import { currentLinkPath } from "./layout.js";

/**
 * How the daemon gets restarted after `current` is flipped. The installer
 * registers a systemd user unit on Linux or a launchd agent on macOS; a
 * `FDE_NO_SERVICE=1` install, Windows, or a hand-started daemon falls back to
 * the CLI's own stop/start through the pid-lock contract.
 */
export const SYSTEMD_UNIT = "fde-daemon";
export const LAUNCHD_LABEL = "app.frogg.fde-daemon";

export type ServiceKind = "systemd" | "launchd" | "unmanaged";

export interface ServiceManager {
  kind: ServiceKind;
  restart(): Promise<void>;
  isRunning(): Promise<boolean>;
}

export interface UnmanagedServiceOptions {
  installDir: string;
  home: string | undefined;
  listen: string | null;
  platform: NodeJS.Platform;
}

function run(command: string, args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { status: null, stderr: result.error.message };
  return { status: result.status, stderr: result.stderr ?? "" };
}

export function systemdUnitPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(configHome, "systemd", "user", `${SYSTEMD_UNIT}.service`);
}

export function launchdPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

/** True when this process runs inside the daemon's systemd service cgroup. */
export function isInsideSystemdUnit(unit: string = SYSTEMD_UNIT): boolean {
  try {
    return readFileSync("/proc/self/cgroup", "utf8").includes(`${unit}.service`);
  } catch {
    return false;
  }
}

export function createSystemdServiceManager(): ServiceManager {
  return {
    kind: "systemd",
    async restart() {
      const result = run("systemctl", ["--user", "restart", SYSTEMD_UNIT]);
      if (result.status !== 0) {
        throw new Error(`systemctl --user restart ${SYSTEMD_UNIT} failed: ${result.stderr.trim()}`);
      }
    },
    async isRunning() {
      return run("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_UNIT]).status === 0;
    },
  };
}

export function createLaunchdServiceManager(): ServiceManager {
  const target = `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`;
  return {
    kind: "launchd",
    async restart() {
      const result = run("launchctl", ["kickstart", "-k", target]);
      if (result.status !== 0) {
        throw new Error(`launchctl kickstart -k ${target} failed: ${result.stderr.trim()}`);
      }
    },
    async isRunning() {
      return run("launchctl", ["print", target]).status === 0;
    },
  };
}

/**
 * No service manager: stop through the pid lock (graceful RPC, then signal),
 * then start `<installDir>/current/bin/fde daemon start` detached so the
 * freshly linked version comes up with the same home and listen address.
 */
export function createUnmanagedServiceManager(options: UnmanagedServiceOptions): ServiceManager {
  const launcher = bundleLauncherPath(
    currentLinkPath(options.installDir),
    options.platform === "win32" ? "win" : "linux",
  );
  return {
    kind: "unmanaged",
    async restart() {
      await stopLocalDaemon({ home: options.home, force: true });
      const args = ["daemon", "start"];
      if (options.home) args.push("--home", options.home);
      if (options.listen) args.push("--listen", options.listen);
      const child = spawn(launcher, args, {
        detached: true,
        stdio: "ignore",
        shell: options.platform === "win32",
        env: { ...process.env, ...(options.home ? { PASEO_HOME: options.home } : {}) },
      });
      // `daemon start` daemonizes and exits 0 once the child survives its
      // startup grace; a non-zero exit (or a launcher that cannot run at all)
      // is the broken-bundle signal the rollback path relies on.
      type Exit = { code: number | null; error?: Error } | null;
      const exit = await Promise.race<Exit>([
        new Promise<Exit>((resolve) => setTimeout(() => resolve(null), 4000).unref()),
        new Promise<Exit>((resolve) =>
          child.once("error", (error) => resolve({ code: null, error })),
        ),
        new Promise<Exit>((resolve) => child.once("exit", (code) => resolve({ code }))),
      ]);
      child.unref();
      if (exit && exit.code !== 0) {
        throw new Error(
          `${launcher} daemon start exited with ${exit.error?.message ?? exit.code ?? "an error"}`,
        );
      }
    },
    async isRunning() {
      const state = resolveLocalDaemonState({ home: options.home });
      return state.running;
    },
  };
}

export function detectServiceManager(options: UnmanagedServiceOptions): ServiceManager {
  if (options.platform === "linux" && existsSync(systemdUnitPath())) {
    return createSystemdServiceManager();
  }
  if (options.platform === "darwin" && existsSync(launchdPlistPath())) {
    return createLaunchdServiceManager();
  }
  return createUnmanagedServiceManager(options);
}

const SUPERVISOR_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "PASEO_HOME",
  "PASEO_LISTEN",
  "PASEO_WEB_UI_ENABLED",
  "FDE_INSTALL_DIR",
  "FDE_HOME",
  "FDE_RELEASE_BASE",
  "FDE_RELEASES_API",
  "FDE_GITHUB_TOKEN",
];

/**
 * Starts the apply step in a process that outlives the daemon. Inside the
 * systemd unit a plain detached child would still be in the service cgroup
 * and die with the restart, so it becomes a transient `systemd-run --user`
 * unit instead; elsewhere `detached` (setsid) plus the caller exiting is
 * enough for the child to be re-parented away from the daemon's tree.
 */
export function spawnDetachedSupervisor(input: {
  execPath: string;
  cliEntry: string;
  args: string[];
  logPath: string;
  env?: NodeJS.ProcessEnv;
}): { pid: number | null; via: "systemd-run" | "detached" } {
  const env = input.env ?? process.env;
  if (process.platform === "linux" && isInsideSystemdUnit()) {
    const unit = `fde-self-update-${Date.now()}`;
    const setenv = SUPERVISOR_ENV_KEYS.filter((key) => env[key] !== undefined).map(
      (key) => `--setenv=${key}=${env[key]}`,
    );
    const result = spawnSync(
      "systemd-run",
      [
        "--user",
        "--collect",
        "--quiet",
        `--unit=${unit}`,
        `--property=StandardOutput=append:${input.logPath}`,
        `--property=StandardError=append:${input.logPath}`,
        ...setenv,
        "--",
        input.execPath,
        input.cliEntry,
        ...input.args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(
        `systemd-run failed: ${(result.stderr ?? result.error?.message ?? "").trim()}`,
      );
    }
    return { pid: null, via: "systemd-run" };
  }
  const log = openSync(input.logPath, "a");
  const child = spawn(input.execPath, [input.cliEntry, ...input.args], {
    detached: true,
    stdio: ["ignore", log, log],
    env,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid ?? null, via: "detached" };
}
