import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";

import pino from "pino";
import {
  createFroggDaemon,
  type FroggDaemonConfig,
  type FroggOpenAIConfig,
  type FroggSpeechConfig,
} from "../bootstrap.js";
import type { AgentClient, AgentProvider } from "../agent/agent-sdk-types.js";
import { createTestAgentClients } from "./fake-agent-client.js";
import type { PushNotificationSender } from "../push/index.js";
import type { AgentProfile } from "@frogg/protocol/messages";

interface TestFroggDaemonOptions {
  daemonVersion?: string;
  desktopManaged?: boolean;
  downloadTokenTtlMs?: number;
  corsAllowedOrigins?: string[];
  listen?: string;
  logger?: Parameters<typeof createFroggDaemon>[1];
  mcpEnabled?: boolean;
  mcpDebug?: boolean;
  isDev?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  daemonStatusRpcCapability?: boolean;
  relayConfigCapability?: boolean;
  agentClients?: Partial<Record<AgentProvider, AgentClient>>;
  providerOverrides?: FroggDaemonConfig["providerOverrides"];
  froggHomeRoot?: string;
  staticDir?: string;
  cleanup?: boolean;
  openai?: FroggOpenAIConfig;
  speech?: FroggSpeechConfig;
  voiceLlmProvider?: FroggDaemonConfig["voiceLlmProvider"];
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  auth?: FroggDaemonConfig["auth"];
  pushNotificationSender?: PushNotificationSender;
  serviceProxy?: FroggDaemonConfig["serviceProxy"];
  webUi?: FroggDaemonConfig["webUi"];
  trustedProxies?: FroggDaemonConfig["trustedProxies"];
  trustLan?: FroggDaemonConfig["trustLan"];
  agentProfiles?: AgentProfile[];
  autoArchiveAfterMerge?: boolean;
}

export interface TestFroggDaemon {
  config: FroggDaemonConfig;
  daemon: Awaited<ReturnType<typeof createFroggDaemon>>;
  port: number;
  froggHome: string;
  staticDir: string;
  close: () => Promise<void>;
}

const TEST_DAEMON_START_TIMEOUT_MS = 20_000;

async function startDaemonWithTimeout(
  daemon: Awaited<ReturnType<typeof createFroggDaemon>>,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new Error(
        `Timed out starting test daemon after ${timeoutMs}ms`,
      ) as Error & { code?: string };
      timeoutError.code = "TEST_DAEMON_START_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);

    daemon.start().then(
      () => {
        clearTimeout(timeoutHandle);
        resolve();
        return;
      },
      (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      },
    );
  });
}

export async function createTestFroggDaemon(
  options: TestFroggDaemonOptions = {},
): Promise<TestFroggDaemon> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { config, froggHomeRoot, froggHome, staticDir } = await prepareTestDaemonConfig(options);
    const logger = options.logger ?? pino({ level: "silent" });
    const daemon = await createFroggDaemon(config, logger, {
      serverFeatureOverrides: {
        daemonStatusRpc: options.daemonStatusRpcCapability,
        relayConfig: options.relayConfigCapability,
      },
    });
    try {
      await startDaemonWithTimeout(daemon, TEST_DAEMON_START_TIMEOUT_MS);
      const listenTarget = daemon.getListenTarget();
      if (!listenTarget || listenTarget.type !== "tcp") {
        throw new Error("Test daemon did not expose a bound TCP listen target");
      }

      const close = async (): Promise<void> => {
        await daemon.stop().catch(() => undefined);
        await daemon.agentManager.flush().catch(() => undefined);
        if (options.cleanup ?? true) {
          await new Promise((r) => setTimeout(r, 50));
          await Promise.all([
            rm(froggHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
            rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
          ]);
        }
      };

      return {
        config,
        daemon,
        port: listenTarget.port,
        froggHome,
        staticDir,
        close,
      };
    } catch (error) {
      lastError = error;
      await daemon.stop().catch(() => undefined);
      await Promise.all([
        rm(froggHomeRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
        rm(staticDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
      ]);

      if (
        (!isAddressInUseError(error) && !isStartupTimeoutError(error)) ||
        attempt === maxAttempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Failed to start test daemon");
}

interface PreparedTestDaemonConfig {
  config: FroggDaemonConfig;
  froggHomeRoot: string;
  froggHome: string;
  staticDir: string;
}

async function prepareTestDaemonConfig(
  options: TestFroggDaemonOptions,
): Promise<PreparedTestDaemonConfig> {
  const froggHomeRoot =
    options.froggHomeRoot ?? (await mkdtemp(path.join(os.tmpdir(), "frogg-home-")));
  const froggHome = path.join(froggHomeRoot, ".frogg");
  await mkdir(froggHome, { recursive: true });
  const staticDir = options.staticDir ?? (await mkdtemp(path.join(os.tmpdir(), "frogg-static-")));
  const listenHost = options.listen ?? "127.0.0.1";
  const config: FroggDaemonConfig = {
    listen: `${listenHost}:0`,
    froggHome,
    daemonVersion: options.daemonVersion,
    desktopManaged: options.desktopManaged,
    corsAllowedOrigins: options.corsAllowedOrigins ?? [],
    hostnames: true,
    mcpEnabled: options.mcpEnabled ?? true,
    staticDir,
    mcpDebug: options.mcpDebug ?? false,
    isDev: options.isDev,
    agentClients: options.agentClients ?? createTestAgentClients(),
    providerOverrides: options.providerOverrides,
    agentStoragePath: path.join(froggHome, "agents"),
    relayEnabled: options.relayEnabled ?? false,
    relayEndpoint: options.relayEndpoint ?? "relay.example.test:443",
    relayUseTls: options.relayUseTls,
    relayPublicUseTls: options.relayPublicUseTls,
    appBaseUrl: "https://app.example.test",
    auth: options.auth,
    pushNotificationSender: options.pushNotificationSender,
    serviceProxy: options.serviceProxy,
    webUi: options.webUi,
    trustedProxies: options.trustedProxies,
    trustLan: options.trustLan,
    openai: options.openai,
    speech: options.speech,
    voiceLlmProvider: options.voiceLlmProvider ?? null,
    voiceLlmProviderExplicit: options.voiceLlmProviderExplicit ?? false,
    voiceLlmModel: options.voiceLlmModel ?? null,
    dictationFinalTimeoutMs: options.dictationFinalTimeoutMs,
    downloadTokenTtlMs: options.downloadTokenTtlMs,
    agentProfiles: options.agentProfiles,
    autoArchiveAfterMerge: options.autoArchiveAfterMerge,
  };
  return { config, froggHomeRoot, froggHome, staticDir };
}

function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "EADDRINUSE";
}

function isStartupTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: string };
  return record.code === "TEST_DAEMON_START_TIMEOUT";
}
