import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "pino";
import type { DaemonLifecycleIntent, FdeDaemonConfig } from "../bootstrap.js";
import { resolveDaemonVersion } from "../daemon-version.js";
import { ensureExecutionService } from "./client.js";
import { executionControlRequest, readExecutionStatus } from "./control-client.js";
import { createExecutionGateway } from "./gateway.js";

export async function createGatewayDaemon(
  config: FdeDaemonConfig,
  logger: Logger,
  onLifecycleIntent: (intent: DaemonLifecycleIntent) => void,
) {
  const sourceEntry = fileURLToPath(new URL("./worker.ts", import.meta.url));
  const workerEntry = existsSync(sourceEntry)
    ? sourceEntry
    : fileURLToPath(new URL("./worker.js", import.meta.url));
  const version = config.daemonVersion ?? resolveDaemonVersion(import.meta.url);
  const runtime = await ensureExecutionService({
    home: config.fdeHome,
    version,
    workerEntry,
    execArgv: workerEntry.endsWith(".ts") ? ["--import", "tsx"] : [],
    workerArgs: process.argv.slice(2),
  });
  logger.info(
    { executionPid: runtime.pid, executionVersion: runtime.version, gatewayVersion: version },
    "Connected to independent execution service",
  );
  const gateway = createExecutionGateway({
    listen: config.listen,
    runtime,
    gatewayVersion: version,
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let lastError: string | null = null;
  async function poll(): Promise<void> {
    try {
      const status = await readExecutionStatus(runtime);
      lastError = null;
      if (!stopped && status.lifecycle) {
        await executionControlRequest(runtime, "/ack", { sequence: status.lifecycle.sequence });
        if (!stopped)
          onLifecycleIntent({
            ...status.lifecycle,
            clientId: "execution-service",
            requestId: String(status.lifecycle.sequence),
          });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (lastError !== message)
        logger.error(
          { err: error },
          "Execution service is unavailable; agent execution may have stopped",
        );
      lastError = message;
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), 500);
    }
  }
  return {
    async start() {
      await gateway.start();
      const bound = gateway.getListenTarget();
      if (!bound) throw new Error("Gateway did not expose its listener");
      const listen = bound.type === "tcp" ? `${bound.host}:${bound.port}` : bound.path;
      try {
        await executionControlRequest(runtime, "/gateway", { listen });
        void poll();
      } catch (error) {
        await gateway.stop();
        throw error;
      }
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await gateway.stop();
    },
    getListenTarget: gateway.getListenTarget,
  };
}
