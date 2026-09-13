import type { DaemonUpdateService } from "./daemon-update-service.js";
import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  daemonSelfUpdater,
  DaemonSelfUpdateInProgressError,
  type DaemonSelfUpdatePhase,
  type DaemonSelfUpdater,
} from "./daemon-self-updater.js";
import { getErrorMessage } from "@fde/protocol/error-utils";

type DaemonUpdateRequest = Extract<SessionInboundMessage, { type: "daemon.update.request" }>;

const DAEMON_SELF_UPDATE_MESSAGE_TYPES: ReadonlySet<SessionInboundMessage["type"]> = new Set([
  "daemon.update.request",
]);

interface DaemonSelfUpdateRestartIntent {
  type: "restart";
  clientId: string;
  requestId: string;
  reason: string;
}

export interface DaemonSelfUpdateSessionControllerOptions {
  clientId: string;
  daemonVersion: string | null;
  desktopManaged?: boolean;
  emit: (msg: SessionOutboundMessage) => void;
  emitLifecycleIntent: (intent: DaemonSelfUpdateRestartIntent) => void;
  sessionLogger: pino.Logger;
  updater?: Pick<DaemonSelfUpdater, "update">;
  versionedUpdate?: Pick<DaemonUpdateService, "startLegacy">;
}

function isDaemonSelfUpdateMessage(msg: SessionInboundMessage): msg is DaemonUpdateRequest {
  return DAEMON_SELF_UPDATE_MESSAGE_TYPES.has(msg.type);
}

export class DaemonSelfUpdateSessionController {
  private readonly clientId: string;
  private readonly daemonVersion: string | null;
  private readonly desktopManaged: boolean;
  private readonly emit: (msg: SessionOutboundMessage) => void;
  private readonly emitLifecycleIntent: (intent: DaemonSelfUpdateRestartIntent) => void;
  private readonly sessionLogger: pino.Logger;
  private readonly updater: Pick<DaemonSelfUpdater, "update">;
  private readonly versionedUpdate: Pick<DaemonUpdateService, "startLegacy"> | undefined;

  constructor(options: DaemonSelfUpdateSessionControllerOptions) {
    this.clientId = options.clientId;
    this.daemonVersion = options.daemonVersion;
    this.desktopManaged = options.desktopManaged === true;
    this.emit = options.emit;
    this.emitLifecycleIntent = options.emitLifecycleIntent;
    this.sessionLogger = options.sessionLogger;
    this.updater = options.updater ?? daemonSelfUpdater;
    this.versionedUpdate = options.versionedUpdate;
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    if (!isDaemonSelfUpdateMessage(msg)) {
      return undefined;
    }
    return this.handleDaemonUpdateRequest(msg);
  }

  private async handleDaemonUpdateRequest(msg: DaemonUpdateRequest): Promise<void> {
    const previousVersion = this.daemonVersion;

    try {
      const result = this.versionedUpdate
        ? await this.versionedUpdate.startLegacy()
        : await this.updater.update({
            daemonVersion: previousVersion,
            desktopManaged: this.desktopManaged,
            onProgress: (phase) => this.emitProgress(msg.requestId, phase),
            logger: this.sessionLogger,
          });

      this.emitResponse({
        requestId: msg.requestId,
        success: result.success,
        error: result.error,
        previousVersion,
        newVersion: result.newVersion,
      });
      if (!result.success || this.versionedUpdate) {
        return;
      }

      this.emitLifecycleIntent({
        type: "restart",
        clientId: this.clientId,
        requestId: msg.requestId,
        reason: "daemon_update",
      });
    } catch (error) {
      if (error instanceof DaemonSelfUpdateInProgressError) {
        this.emit({
          type: "rpc_error",
          payload: {
            requestId: msg.requestId,
            requestType: "daemon.update.request",
            error: error.message,
            code: "already_updating",
          },
        });
        return;
      }
      this.sessionLogger.error({ err: error }, "Daemon update failed with exception");
      this.emitResponse({
        requestId: msg.requestId,
        success: false,
        error: getErrorMessage(error),
        previousVersion,
        newVersion: null,
      });
    }
  }

  private emitProgress(requestId: string, phase: DaemonSelfUpdatePhase): void {
    this.emit({
      type: "daemon.update.progress",
      payload: {
        requestId,
        phase,
      },
    });
  }

  private emitResponse(payload: {
    requestId: string;
    success: boolean;
    error: string | null;
    previousVersion: string | null;
    newVersion: string | null;
  }): void {
    this.emit({
      type: "daemon.update.response",
      payload,
    });
  }
}
