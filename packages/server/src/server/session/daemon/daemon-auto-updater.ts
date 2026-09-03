import type pino from "pino";
import type { DaemonAutoUpdateConfig } from "@fde/protocol/messages";
import type { DaemonUpdateService } from "./daemon-update-service.js";

/**
 * Opt-in scheduled self-update (`daemon.autoUpdate` / `PASEO_AUTO_UPDATE=1`).
 * Checks the release channel on the configured interval and, when a newer
 * version exists, runs the same self-update path a client would; while
 * agents are running the attempt is deferred instead of interrupting them.
 * Rollback protects against a daemon that fails to come up, not against a UI
 * regression: the web UI ships inside the desktop app, not the daemon.
 */
export const DEFAULT_AUTO_UPDATE_CONFIG: DaemonAutoUpdateConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  quietHours: null,
};

const INITIAL_DELAY_MS = 5 * 60_000;
const DEFER_WHILE_BUSY_MS = 15 * 60_000;

export interface DaemonAutoUpdaterOptions {
  service: Pick<DaemonUpdateService, "check" | "start" | "currentRun" | "installInfo">;
  getConfig: () => DaemonAutoUpdateConfig | undefined;
  hasRunningAgents: () => boolean;
  logger: pino.Logger;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function isInQuietHours(now: Date, quietHours: [number, number] | null | undefined): boolean {
  if (!quietHours) return false;
  const [start, end] = quietHours;
  if (start === end) return false;
  const hour = now.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type AutoUpdateTickOutcome =
  | "disabled"
  | "not_updatable"
  | "quiet_hours"
  | "up_to_date"
  | "busy"
  | "already_running"
  | "started"
  | "check_failed";

export class DaemonAutoUpdater {
  private readonly options: DaemonAutoUpdaterOptions;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: DaemonAutoUpdaterOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.schedule(INITIAL_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      (this.options.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
    const setTimer = this.options.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      this.timer = null;
      void this.tick().then((outcome) => {
        const config = this.options.getConfig() ?? DEFAULT_AUTO_UPDATE_CONFIG;
        const next =
          outcome === "busy" || outcome === "quiet_hours"
            ? DEFER_WHILE_BUSY_MS
            : Math.max(1, config.checkIntervalHours) * 3_600_000;
        this.schedule(next);
      });
    }, ms);
    this.timer.unref?.();
  }

  async tick(): Promise<AutoUpdateTickOutcome> {
    const config = this.options.getConfig() ?? DEFAULT_AUTO_UPDATE_CONFIG;
    const log = this.options.logger;
    if (!config.enabled) return "disabled";
    if (!this.options.service.installInfo.updatable) return "not_updatable";
    if (isInQuietHours((this.options.now ?? (() => new Date()))(), config.quietHours)) {
      return "quiet_hours";
    }
    if (this.options.service.currentRun()) return "already_running";
    const check = await this.options.service.check({ channel: config.channel });
    if (check.error) {
      log.warn({ error: check.error }, "auto-update check failed");
      return "check_failed";
    }
    if (!check.updateAvailable || !check.latestVersion) return "up_to_date";
    if (this.options.hasRunningAgents()) {
      log.info({ version: check.latestVersion }, "auto-update deferred: agents are running");
      return "busy";
    }
    log.info({ from: check.currentVersion, to: check.latestVersion }, "auto-update starting");
    const started = await this.options.service.start({
      version: check.latestVersion,
      channel: config.channel,
    });
    if (!started.accepted) {
      log.warn({ error: started.error }, "auto-update could not start");
      return "already_running";
    }
    return "started";
  }
}
