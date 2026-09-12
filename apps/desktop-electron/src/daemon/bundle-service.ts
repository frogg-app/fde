export interface LocalDaemonBundleStatus {
  installed: boolean;
  version: string | null;
  platform: string;
  arch: string;
  path: string | null;
  downloading: null;
}

export interface BundledDaemonRuntime {
  inspect(): Promise<{ version: string; path: string }>;
  currentVersion(): string;
  platform: string;
  arch: string;
  restart(): Promise<{ status: string; version: string | null }>;
}

/** Electron ships its daemon. Installation validates those resources, never downloads another shell's bundle. */
export function createBundledDaemonService(runtime: BundledDaemonRuntime) {
  async function status(): Promise<LocalDaemonBundleStatus> {
    try {
      const bundle = await runtime.inspect();
      return {
        installed: true,
        ...bundle,
        platform: runtime.platform,
        arch: runtime.arch,
        downloading: null,
      };
    } catch {
      return {
        installed: false,
        version: null,
        path: null,
        platform: runtime.platform,
        arch: runtime.arch,
        downloading: null,
      };
    }
  }

  async function install(args?: Record<string, unknown>): Promise<LocalDaemonBundleStatus> {
    if (args?.version !== undefined && typeof args.version !== "string")
      throw new Error("Daemon version must be a string.");
    const requested =
      typeof args?.version === "string" && args.version.trim()
        ? args.version.trim().replace(/^v/, "")
        : runtime.currentVersion();
    const bundle = await runtime.inspect();
    if (bundle.version !== requested || bundle.version !== runtime.currentVersion()) {
      throw new Error(
        `This Electron app includes daemon ${bundle.version}, not ${requested}. Update the Electron app to change its bundled daemon.`,
      );
    }
    return {
      installed: true,
      ...bundle,
      platform: runtime.platform,
      arch: runtime.arch,
      downloading: null,
    };
  }

  async function update(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const bundle = await install();
      const daemon = await runtime.restart();
      if (daemon.status !== "running" || daemon.version !== bundle.version) {
        throw new Error(
          "The local daemon is managed by another app or did not restart on the bundled version. Stop it using its owning app before starting it here.",
        );
      }
      return { exitCode: 0, stdout: `Local daemon ${bundle.version} is running.`, stderr: "" };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { status, install, update };
}
