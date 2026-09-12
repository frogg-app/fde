import { brand } from "@fde/branding";
import { randomUUID } from "node:crypto";
import { createPaseoDaemon, type DaemonLifecycleIntent } from "../bootstrap.js";
import { loadConfig } from "../config.js";
import { applyCliFlagOverrides } from "../daemon-cli-overrides.js";
import { createRootLogger } from "../logger.js";
import { resolveFdeHome } from "../paseo-home.js";
import { acquirePidLock, releasePidLock, startPidLockHeartbeat } from "../pid-lock.js";
import { createExecutionControlServer, publicExecutionStatus } from "./control-server.js";
import {
  EXECUTION_PROTOCOL_VERSION,
  type ExecutionServiceDescriptor,
  type ExecutionServiceStatus,
} from "./protocol.js";
import {
  prepareExecutionDirectory,
  publishExecutionDescriptor,
  removeExecutionDescriptor,
} from "./state.js";

process.title = `${brand.name} Execution Service`;

async function main(): Promise<void> {
  const home = resolveFdeHome();
  const directory = await prepareExecutionDirectory(home);
  await acquirePidLock(directory, null);
  const stopHeartbeat = startPidLockHeartbeat(directory, {
    onError: () => {
      process.exitCode = 1;
      void shutdown();
    },
  });
  const config = loadConfig(home);
  applyCliFlagOverrides(config);
  const logger = createRootLogger({ log: config.log }, { paseoHome: directory, file: false });
  const instanceId = randomUUID();
  const token = randomUUID() + randomUUID();
  const startedAt = new Date().toISOString();
  let publicListen = config.listen;
  let descriptor: ExecutionServiceDescriptor | null = null;
  let daemon: Awaited<ReturnType<typeof createPaseoDaemon>> | null = null;
  let control: Awaited<ReturnType<typeof createExecutionControlServer>> | null = null;
  let stopping = false;
  let sequence = 0;
  const lifecycle: NonNullable<ExecutionServiceStatus["lifecycle"]>[] = [];
  const onLifecycleIntent = (intent: DaemonLifecycleIntent) => {
    lifecycle.push({ sequence: ++sequence, type: intent.type, reason: intent.reason });
  };
  async function shutdown(): Promise<void> {
    if (stopping) return;
    stopping = true;
    daemon?.agentManager.prepareForShutdown();
    const forceExit = setTimeout(() => process.exit(1), 15_000);
    try {
      await daemon?.stop();
      await control?.close();
      await removeExecutionDescriptor(home, instanceId);
      stopHeartbeat();
      await releasePidLock(directory);
      clearTimeout(forceExit);
      process.exit(process.exitCode ?? 0);
    } catch (error) {
      logger.error({ err: error }, "Execution service shutdown failed");
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  try {
    daemon = await createPaseoDaemon(
      {
        ...config,
        listen: "127.0.0.1:0",
        daemonVersion: process.env.FDE_EXECUTION_VERSION,
        executionService: { token, getPublicListen: () => publicListen },
        onLifecycleIntent,
      },
      logger,
    );
    await daemon.start();
    const bound = daemon.getListenTarget();
    if (bound?.type !== "tcp") throw new Error("Execution service did not bind TCP");
    control = await createExecutionControlServer({
      token,
      instanceId,
      status: () => {
        if (!descriptor) throw new Error("Execution service initializing");
        return publicExecutionStatus(
          descriptor,
          daemon!.agentManager.listAgents().filter((agent) => agent.session !== null).length,
          lifecycle[0] ?? null,
        );
      },
      stop: (force) => {
        if (
          !force &&
          (daemon!.agentManager.listAgents().some((agent) => agent.session !== null) ||
            daemon!.agentManager.hasPendingAgentRegistrations())
        ) {
          throw new Error(
            "Execution service has resident agents or pending launches; archive them first or explicitly stop with --all",
          );
        }
        daemon!.agentManager.prepareForShutdown();
        // Let the successful control response flush before closing its listener.
        setImmediate(() => void shutdown());
      },
      acknowledge: (ack) => {
        if (lifecycle[0]?.sequence === ack) lifecycle.shift();
      },
      setPublicListen: (listen) => {
        publicListen = listen;
      },
    });
    descriptor = {
      protocolVersion: EXECUTION_PROTOCOL_VERSION,
      instanceId,
      pid: process.pid,
      version: process.env.FDE_EXECUTION_VERSION ?? "unknown",
      startedAt,
      port: bound.port,
      controlPort: control.port,
      token,
    };
    await publishExecutionDescriptor(home, descriptor);
    logger.info({ instanceId, version: descriptor.version }, "Independent execution service ready");
  } catch (error) {
    logger.error({ err: error }, "Execution service startup failed");
    process.exitCode = 1;
    await shutdown();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
