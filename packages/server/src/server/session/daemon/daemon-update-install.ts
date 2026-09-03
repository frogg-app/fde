import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonUpdateLastResult } from "@fde/protocol/messages";

/**
 * Where this daemon is installed and whether `fde daemon self-update` can
 * replace it. A versioned install (deploy/install.sh, or the CLI's own
 * self-update) lives under `<installDir>/versions/<v>` with a `current` link;
 * anything else (a dev checkout, the Docker image, the desktop sidecar) is
 * reported as not updatable with the reason a client should show.
 */
export interface DaemonInstallInfo {
  installDir: string;
  updatable: boolean;
  reason: string | null;
  /** `<installDir>/versions/<v>` of the running daemon when it is a versioned install. */
  runningRoot: string | null;
  /** The running version's `bin/fde` launcher, used to run the self-update. */
  cliLauncher: string | null;
}

export interface DescribeDaemonInstallInput {
  env?: NodeJS.ProcessEnv;
  desktopManaged: boolean;
  /** Module URL inside the running daemon; defaults to this file. */
  moduleUrl?: string;
  platform?: NodeJS.Platform;
}

export const DOCKER_UPDATE_HINT =
  "This daemon runs in Docker. Pull the new image and re-run install-docker.sh --update on the host.";

export function resolveInstallDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.FDE_INSTALL_DIR?.trim();
  if (explicit) return explicit;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "fde");
  }
  return path.join(os.homedir(), ".local", "share", "fde");
}

function safeRealpath(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}

/** The `<versionsDir>/<v>` ancestor of `modulePath`, or null when it lives elsewhere. */
export function findVersionRoot(modulePath: string, versionsDir: string): string | null {
  const realVersions = safeRealpath(versionsDir);
  const realModule = safeRealpath(modulePath);
  if (!realVersions || !realModule) return null;
  const relative = path.relative(realVersions, realModule);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const first = relative.split(path.sep)[0];
  return first ? path.join(realVersions, first) : null;
}

export function describeDaemonInstall(input: DescribeDaemonInstallInput): DaemonInstallInfo {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const installDir = resolveInstallDir(env, platform);
  const base = { installDir, runningRoot: null, cliLauncher: null };
  if (env.FDE_DOCKER === "1" || existsSync("/.dockerenv")) {
    return { ...base, updatable: false, reason: DOCKER_UPDATE_HINT };
  }
  if (input.desktopManaged) {
    return {
      ...base,
      updatable: false,
      reason: "This daemon is managed by FDE Desktop; updating the app updates it.",
    };
  }
  const modulePath = fileURLToPath(input.moduleUrl ?? import.meta.url);
  const runningRoot = findVersionRoot(modulePath, path.join(installDir, "versions"));
  if (!runningRoot) {
    return {
      ...base,
      updatable: false,
      reason: `This daemon does not run from a versioned install under ${installDir} (a dev checkout or a manual copy); update it the way it was installed.`,
    };
  }
  const current = path.join(installDir, "current");
  let hasCurrent = false;
  try {
    hasCurrent = lstatSync(current).isSymbolicLink() || lstatSync(current).isDirectory();
  } catch {
    hasCurrent = false;
  }
  if (!hasCurrent) {
    return {
      ...base,
      runningRoot,
      updatable: false,
      reason: `${installDir} has no current link; re-run deploy/install.sh once to repair the layout.`,
    };
  }
  const launcher = path.join(runningRoot, "bin", platform === "win32" ? "fde.cmd" : "fde");
  return {
    installDir,
    updatable: existsSync(launcher),
    reason: existsSync(launcher) ? null : `${launcher} is missing`,
    runningRoot,
    cliLauncher: existsSync(launcher) ? launcher : null,
  };
}

/** `<installDir>/last-update.json`, written by the self-update supervisor. */
export function readLastUpdateResult(installDir: string): DaemonUpdateLastResult | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(installDir, "last-update.json"), "utf8"),
    ) as Partial<DaemonUpdateLastResult>;
    if (
      typeof parsed.to !== "string" ||
      typeof parsed.at !== "string" ||
      (parsed.status !== "applied" && parsed.status !== "rolled_back" && parsed.status !== "failed")
    ) {
      return null;
    }
    return {
      from: typeof parsed.from === "string" ? parsed.from : null,
      to: parsed.to,
      status: parsed.status,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      at: parsed.at,
    };
  } catch {
    return null;
  }
}
