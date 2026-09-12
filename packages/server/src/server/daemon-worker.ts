import { brand } from "@fde/branding";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createFdeDaemon } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { applyCliFlagOverrides } from "./daemon-cli-overrides.js";
import { getExecutionServiceStatus } from "./execution-service/client.js";
import { createGatewayDaemon } from "./execution-service/gateway-daemon.js";
import { resolveFdeHome } from "./fde-home.js";
import { createRootLogger } from "./logger.js";
import type { DaemonLifecycleIntent } from "./bootstrap.js";
import { getProcessDiagnostics } from "./process-diagnostics.js";

process.title = `${brand.name} Daemon`;

type SupervisorLifecycleMessage =
  | {
      type: "fde:shutdown";
      reason: string;
    }
  | {
      type: "fde:ready";
      listen: string;
    }
  | {
      type: "fde:restart";
      reason?: string;
    };

interface BootstrapResult {
  fdeHome: string;
  logger: ReturnType<typeof createRootLogger>;
  config: ReturnType<typeof loadConfig>;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function writeWorkerLifecycleLog(
  fdeHome: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const logPath = path.join(fdeHome, "daemon.log");
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${JSON.stringify({
        level: "warn",
        time: new Date().toISOString(),
        pid: process.pid,
        name: "DaemonWorker",
        msg: message,
        ...fields,
      })}\n`,
      "utf8",
    );
  } catch {
    // Exit-reason logging must never prevent the worker from exiting.
  }
}

function bootstrapFromEnvironment(): BootstrapResult {
  try {
    const fdeHome = resolveFdeHome();
    const config = loadConfig(fdeHome);
    const logger = createRootLogger({ log: config.log }, { fdeHome, file: false });
    return { fdeHome, logger, config };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

async function main() {
  const { fdeHome, logger, config } = bootstrapFromEnvironment();
  let daemon: Pick<
    Awaited<ReturnType<typeof createFdeDaemon>>,
    "start" | "stop" | "getListenTarget"
  > | null = null;
  let shutdownPromise: Promise<number> | null = null;
  let exitHookInstalled = false;

  applyCliFlagOverrides(config);

  const installExitHook = () => {
    if (exitHookInstalled || !shutdownPromise) {
      return;
    }
    exitHookInstalled = true;
    void shutdownPromise.then((exitCode) => {
      process.exit(exitCode);
    });
  };

  const beginShutdown = (
    signal: string,
    options?: {
      reason?: string;
      successExitCode?: number;
    },
  ) => {
    const reason = options?.reason ?? `worker_received_${signal}`;
    if (!shutdownPromise) {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received, shutting down gracefully...`,
      );

      shutdownPromise = (async () => {
        const forceExit = setTimeout(() => {
          logger.warn(
            { signal, reason, ...getProcessDiagnostics() },
            "Forcing shutdown - HTTP server didn't close in time",
          );
          process.exit(1);
        }, 10000);

        try {
          if (!daemon) {
            logger.error("Shutdown requested before daemon initialization completed");
            clearTimeout(forceExit);
            return 1;
          }
          await daemon.stop();
          clearTimeout(forceExit);
          logger.info("Server closed");
          return options?.successExitCode ?? 0;
        } catch (err) {
          clearTimeout(forceExit);
          logger.error({ err }, "Shutdown failed");
          return 1;
        }
      })();
    } else {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received while shutdown is already in progress`,
      );
    }

    installExitHook();
  };

  const sendSupervisorLifecycleMessage = (message: SupervisorLifecycleMessage): boolean => {
    if (typeof process.send !== "function") {
      return false;
    }
    try {
      process.send(message);
      return true;
    } catch (err) {
      logger.error({ err, message }, "Failed to send lifecycle IPC message to supervisor");
      return false;
    }
  };

  const handleLifecycleIntent = (intent: DaemonLifecycleIntent) => {
    if (intent.type === "shutdown") {
      logger.warn(
        { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
        "Shutdown requested via websocket",
      );
      if (sendSupervisorLifecycleMessage({ type: "fde:shutdown", reason: intent.reason })) {
        return;
      }
      beginShutdown("shutdown lifecycle intent", { reason: intent.reason });
      return;
    }

    logger.warn(
      { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
      "Restart requested via websocket",
    );
    if (
      sendSupervisorLifecycleMessage({
        type: "fde:restart",
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    ) {
      return;
    }
    beginShutdown("restart lifecycle intent", {
      reason: intent.reason,
      successExitCode: 0,
    });
  };

  const installSupervisorLivenessGuard = () => {
    if (typeof process.send !== "function") {
      return;
    }

    const supervisorPid = process.ppid;
    let lastSupervisorHeartbeatAt = Date.now();
    let supervisorExitRequested = false;
    const exitAfterSupervisorLoss = (reason: string) => {
      if (supervisorExitRequested) {
        return;
      }
      supervisorExitRequested = true;

      writeWorkerLifecycleLog(fdeHome, "Supervisor liveness lost; worker exiting", {
        reason,
        ...getProcessDiagnostics(),
        supervisorPid,
        currentParentPid: process.ppid,
        ipcConnected: typeof process.connected === "boolean" ? process.connected : null,
        heartbeatAgeMs: Date.now() - lastSupervisorHeartbeatAt,
      });

      // The supervisor owns the worker's stdout/stderr pipes. Once it is gone,
      // logging during graceful shutdown can block on the broken pipe and leave
      // the daemon orphaned, so supervisor loss is a hard process boundary.
      process.exit(0);
    };

    process.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) {
        return;
      }
      const type = (message as { type?: unknown }).type;
      if (type === "fde:supervisor-heartbeat") {
        lastSupervisorHeartbeatAt = Date.now();
        return;
      }
      if (type === "fde:graceful-shutdown") {
        const reason = (message as { reason?: unknown }).reason;
        beginShutdown("Supervisor shutdown request", {
          reason: typeof reason === "string" ? reason : "supervisor_requested_shutdown",
        });
      }
    });
    process.on("disconnect", () => exitAfterSupervisorLoss("ipc_disconnect_event"));

    const timer = setInterval(() => {
      const ipcConnected = typeof process.connected === "boolean" ? process.connected : true;
      const heartbeatExpired = Date.now() - lastSupervisorHeartbeatAt > 3500;
      const supervisorChanged = process.ppid !== supervisorPid;

      if (ipcConnected === false) {
        exitAfterSupervisorLoss("ipc_disconnected");
        return;
      }
      if (supervisorChanged) {
        exitAfterSupervisorLoss("supervisor_parent_pid_changed");
        return;
      }
      if (heartbeatExpired && !isPidAlive(supervisorPid)) {
        exitAfterSupervisorLoss("supervisor_pid_dead");
      }
    }, 1000);
    timer.unref();
  };

  installSupervisorLivenessGuard();

  try {
    // Retained execution remains authoritative even if a subsequent launcher omits the opt-in.
    const independent =
      process.env.FDE_EXECUTION_SERVICE === "1" ||
      (await getExecutionServiceStatus(fdeHome)) !== null;
    daemon = independent
      ? await createGatewayDaemon(config, logger, handleLifecycleIntent)
      : await createFdeDaemon(
          {
            ...config,
            onLifecycleIntent: handleLifecycleIntent,
          },
          logger,
        );
  } catch (err) {
    logger.fatal({ err }, "Daemon bootstrap failed");
    throw err;
  }

  try {
    await daemon.start();
    const listenTarget = daemon.getListenTarget();
    const listen =
      listenTarget?.type === "tcp"
        ? `${listenTarget.host}:${listenTarget.port}`
        : listenTarget?.path;
    if (!listen) {
      throw new Error("Daemon did not expose a listen target after startup");
    }
    sendSupervisorLifecycleMessage({ type: "fde:ready", listen });
  } catch (err) {
    logger.fatal({ err }, "Daemon failed to start listening");
    throw err;
  }

  process.on("SIGTERM", () => beginShutdown("SIGTERM"));
  process.on("SIGINT", () => beginShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — daemon crashing");
    exitAfterPinoFlush();
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection — daemon crashing");
    exitAfterPinoFlush();
  });
}

// Give pino async streams a moment to flush the fatal log entry to daemon.log
// before the process exits. Without this, the last few entries that explain
// why the daemon crashed can be lost.
function exitAfterPinoFlush(): void {
  setTimeout(() => process.exit(1), 200);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  exitAfterPinoFlush();
});
