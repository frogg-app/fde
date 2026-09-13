import { brand } from "@fde/branding";
import express from "express";
import { createServer as createHTTPServer, type IncomingMessage, type ServerResponse } from "http";
import { constants, existsSync, unlinkSync } from "fs";
import { open, rm } from "fs/promises";
import { randomUUID } from "node:crypto";
import { hostname as getHostname } from "node:os";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "pino";
import { z } from "zod";
import { createBranchChangeRouteHandler } from "./script-route-branch-handler.js";

import { parseListenString, type ListenTarget } from "./listen-target.js";
export { parseListenString, type ListenTarget } from "./listen-target.js";
import { createExecutionHttpServer } from "./execution-service/http-server.js";

function resolveBoundListenTarget(
  listenTarget: ListenTarget,
  httpServer: ReturnType<typeof createHTTPServer>,
): ListenTarget {
  if (listenTarget.type !== "tcp") {
    return listenTarget;
  }

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("HTTP server did not expose a TCP address after listening");
  }

  return {
    type: "tcp",
    host: listenTarget.host,
    port: address.port,
  };
}

function formatListenTarget(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget) {
    return null;
  }
  if (listenTarget.type === "tcp") {
    return `${listenTarget.host}:${listenTarget.port}`;
  }
  return listenTarget.path;
}

export async function fanOutReconciledWorkspaceUpdates(input: {
  sessions: Iterable<{
    syncWorkspaceGitObserversForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
    emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIds: Iterable<string>): Promise<void>;
  }>;
  workspaceIds: readonly string[];
  logger: Pick<Logger, "warn">;
}): Promise<void> {
  await Promise.all(
    Array.from(input.sessions, async (session) => {
      try {
        await session.syncWorkspaceGitObserversForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn(
          { err: error },
          "Failed to sync workspace Git observers after reconciliation",
        );
      }
      try {
        await session.emitWorkspaceUpdatesForExternalWorkspaceIds(input.workspaceIds);
      } catch (error) {
        input.logger.warn({ err: error }, "Failed to emit workspace updates after reconciliation");
      }
    }),
  );
}

import { VoiceAssistantWebSocketServer } from "./websocket-server.js";
import { WorkspaceSetupRuntime } from "./workspace-setup-runtime.js";
import { createWorkspaceLabelService } from "./workspace-labels/index.js";
import { createGitHubService } from "../services/github-service.js";
import { createFdeWorktree as createRegisteredFdeWorktree } from "./fde-worktree-service.js";
import { createWorkspaceProvisioningService } from "./session/workspace-provisioning/workspace-provisioning-service.js";
import { createFdeWorktreeWorkflow } from "./worktree-session.js";
import { DownloadTokenStore } from "./file-download/token-store.js";
import type { OpenAiSpeechProviderConfig } from "./speech/providers/openai/config.js";
import type { LocalSpeechProviderConfig } from "./speech/providers/local/config.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { createSpeechService } from "./speech/speech-runtime.js";
import { mountNotificationAudioRoute } from "./notifications/audio-route.js";
import {
  createSpokenAlertService,
  isSpokenNotificationsEnabled,
} from "./notifications/spoken-alerts.js";
import { createTtsCache } from "./notifications/tts-cache.js";
import { resolveCompanionCapability } from "./companion/capability.js";
import {
  resolveCompanionModelConfig,
  isCompanionNativeVoiceAvailable,
  resolveCompanionModelInputs,
} from "./companion/model-config.js";
import { createCompanionFillerBank } from "./companion/fillers.js";
import { CompanionNotebookStore, companionNotebookPath } from "./companion/store.js";
import { createCompanionTools } from "./companion/tools/index.js";
import { createCompanionSubagentRunner } from "./companion/tools/thinking.js";
import { createCompanionBackendFactory } from "./companion/backends/create-backend.js";
import { CompanionMessageReceipts } from "./companion/message-receipts.js";
import { CompanionDeferredJobs } from "./companion/deferred-jobs.js";
import { watchCompanionAgent } from "./companion/watch-agent.js";
import type { CompanionRuntime } from "./companion/session.js";
import { AgentManager } from "./agent/agent-manager.js";
import { AgentStorage } from "./agent/agent-storage.js";
import {
  collectMidTurnAgentIds,
  DAEMON_RESTART_INTERRUPT_REASON,
  resumeInterruptedAgents,
} from "./agent/interrupted-turns.js";
import { attachAgentStoragePersistence } from "./persistence-hooks.js";
import { createAgentMcpServer } from "./agent/mcp-server.js";
import { createFdeToolCatalog, type FdeToolHostDependencies } from "./agent/tools/fde-tools.js";
import type { FdeToolRuntimeContext } from "./agent/tools/types.js";
import { createAgentProviderRuntime } from "./agent/provider-runtime.js";
import { bootstrapWorkspaceRegistries } from "./workspace-registry-bootstrap.js";
import { WorkspaceReconciliationService } from "./workspace-reconciliation-service.js";
import {
  FileBackedProjectRegistry,
  FileBackedWorkspaceRegistry,
  type WorkspaceArchiveContext,
} from "./workspace-registry.js";
import { CheckoutDiffManager } from "./checkout-diff-manager.js";
import { ScheduleService } from "./schedule/service.js";
import { DaemonConfigStore, type MutableDaemonConfig } from "./daemon-config-store.js";
import { createOrchestrationSkills } from "./orchestration-skills/index.js";
import {
  resolveConfigFromPersisted,
  resolvePairingBaseUrl,
  type CliConfigOverrides,
} from "./config.js";
import { BrowserToolsBroker } from "./browser-tools/broker.js";
import { DaemonConfigBrowserToolsPolicy } from "./browser-tools/policy.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";
import { resolveWorkspaceIdForPath } from "./resolve-workspace-id-for-path.js";
import {
  archiveByScope,
  archivePersistedWorkspaceRecord,
  killTerminalsForWorkspace,
  type ActiveWorkspaceRef,
} from "./workspace-archive-service.js";
import { setupAutoArchiveOnMerge } from "./auto-archive-on-merge/index.js";
import { wrapSessionMessage, type SessionOutboundMessage } from "./messages.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";
import { createConfiguredTerminalManager } from "../terminal/terminal-manager-factory.js";
import { applyTerminalAgentHookSetting } from "../terminal/agent-hooks/terminal-agent-hook-setting.js";
import { loadOrCreateDaemonKeyPair } from "./daemon-keypair.js";
import { createRelayRuntime, type RelayRuntime } from "./relay-runtime.js";
import type { PushNotificationSender } from "./push/index.js";
import { getOrCreateServerId } from "./server-id.js";
import { resolveDaemonVersion } from "./daemon-version.js";
import type { AgentClient, AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProfile,
  AgentSkillSelection,
  FirstAgentContext,
  PluginSource,
  TerminalProfile,
} from "@fde/protocol/messages";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { loadPersistedConfig, type PersistedConfig } from "./persisted-config.js";
import { createServiceProxySubsystem, type ServiceProxySubsystem } from "./service-proxy.js";
import { releaseWorkspaceServicePortPlan } from "./workspace-service-port-registry.js";
import { ScriptHealthMonitor } from "./script-health-monitor.js";
import { createScriptStatusEmitter } from "./script-status-projection.js";
import { WorkspaceScriptRuntimeStore } from "./workspace-script-runtime-store.js";
import { createWorkspaceScriptsService } from "./session/workspace-scripts/workspace-scripts-service.js";
import { spawnWorkspaceScript } from "./worktree-bootstrap.js";
import {
  createManagedProcessRegistry,
  createSystemManagedProcessTable,
  type ManagedProcessRegistry,
} from "./managed-processes/managed-processes.js";
import { terminateWithTreeKill } from "../utils/tree-kill.js";
import { isHostnameAllowed, type HostnamesConfig } from "./hostnames.js";
import {
  createRequireBearerMiddleware,
  isAgentMcpRequestAuthorized,
  type DaemonAuthConfig,
} from "./auth.js";
import { createWebUiMiddleware, type WebUiGate } from "./web-ui.js";
import { createAccessPolicy, DEFAULT_TRUST_LAN } from "./access-policy.js";
import { createClaimStore, type ClaimStore } from "./claim-store.js";
import { createClaimOfferStore } from "./claim-offer-store.js";
import { buildDirectClaimOffer, type ClaimOfferSource } from "./claim-offer.js";
import { renderPairingQrSvg } from "./pairing-qr.js";
import { renderClaimGatePage } from "./claim-gate-page.js";
import { mountPairingCodeRoutes } from "./pairing-code-route.js";

import { createIdentityPreflightHandler, createIdentityRouteHandler } from "./identity-route.js";
import { mountSetupRoutes } from "./setup-routes.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createGitMutationService } from "./session/git-mutation/git-mutation-service.js";
import { workspaceIdsOnCheckout } from "./workspace-directory.js";
import { configureGitProcessPolicy } from "../utils/run-git-command.js";
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";
import { resolveFirstAgentPromptTitle } from "./agent/create-agent-title.js";
import {
  createAgentCommand,
  type CreateAgentCommandDependencies,
} from "./agent/create-agent/create.js";
import { archiveAgentCommand, cancelAgentRunCommand } from "./agent/lifecycle-command.js";
import { CreateAgentLifecycleDispatch } from "./agent/create-agent-lifecycle-dispatch.js";
import {
  HubRelationshipController,
  type HubRelationshipClock,
  type HubRelationshipRetryPolicy,
} from "./hub/relationship-controller.js";
import {
  DirectHubRelationshipRemote,
  type HubRelationshipRemote,
} from "./hub/relationship-remote.js";
import { DaemonExecutions } from "./hub/daemon-executions.js";
import { PluginService } from "./plugins/index.js";
import {
  DaemonAutoUpdater,
  DEFAULT_AUTO_UPDATE_CONFIG,
} from "./session/daemon/daemon-auto-updater.js";
import { describeDaemonInstall } from "./session/daemon/daemon-update-install.js";
import { DaemonUpdateService } from "./session/daemon/daemon-update-service.js";
import type { DaemonAutoUpdateConfig } from "@fde/protocol/messages";
import { ManagedPluginSources } from "./plugins/managed-source.js";

const MCP_DEBUG_BATCH_LIMIT = 10;
const MCP_DEBUG_SECRET = "[redacted]";
const DOWNLOAD_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW;

function formatHostForHttpUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function resolveAgentMcpClientHost(host: string): string {
  if (host === "0.0.0.0") {
    return "127.0.0.1";
  }
  if (host === "::" || host === "[::]") {
    return "::1";
  }
  return host;
}

function createAgentMcpBaseUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/mcp/agents",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

function createTerminalActivityUrl(listenTarget: ListenTarget | null): string | null {
  if (!listenTarget || listenTarget.type !== "tcp") {
    return null;
  }
  const host = resolveAgentMcpClientHost(listenTarget.host);
  return new URL(
    "/api/terminal-activity",
    `http://${formatHostForHttpUrl(host)}:${listenTarget.port}`,
  ).toString();
}

const TerminalActivityReportSchema = z.object({
  terminalId: z.string().min(1),
  token: z.string().min(1),
  state: z.enum(["running", "idle", "needs-input"]),
});

const TERMINAL_ACTIVITY_STATE_MAP = {
  running: "working",
  idle: "idle",
  "needs-input": "attention",
} as const;

const LOOPBACK_REMOTE_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_REMOTE_ADDRESSES.has(remoteAddress);
}

export function createTerminalActivityRouteHandler(
  terminalManager: TerminalManager,
): express.RequestHandler {
  return async (req, res) => {
    if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const parsed = TerminalActivityReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid terminal activity report" });
      return;
    }

    const validation = terminalManager.validateTerminalActivityToken(
      parsed.data.terminalId,
      parsed.data.token,
    );
    if (validation !== "valid") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      const updated = await terminalManager.setTerminalActivity(
        parsed.data.terminalId,
        TERMINAL_ACTIVITY_STATE_MAP[parsed.data.state],
      );
      if (!updated) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      res.status(204).end();
    } catch {
      res.status(500).json({ error: "Failed to update terminal activity" });
    }
  };
}

function describeMcpRequest(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { shape: value === null ? "null" : typeof value };
  }
  const request = value as Record<string, unknown>;
  return {
    shape: "request",
    ...(typeof request.jsonrpc === "string" ? { jsonrpc: request.jsonrpc } : {}),
    ...(typeof request.method === "string" ? { method: request.method } : {}),
    hasId: "id" in request,
    hasParams: "params" in request,
  };
}

function describeMcpDebugPayload(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return describeMcpRequest(value);
  const sampled = value.slice(0, MCP_DEBUG_BATCH_LIMIT).map(describeMcpRequest);
  return {
    shape: "batch",
    count: value.length,
    sampled,
    ...(sampled.length < value.length ? { skipped: value.length - sampled.length } : {}),
  };
}

export type FdeOpenAIConfig = OpenAiSpeechProviderConfig;
export type FdeLocalSpeechConfig = LocalSpeechProviderConfig;

export interface FdeSpeechSttLanguages {
  dictation: string;
  voice: string;
}

export interface FdeSpeechConfig {
  providers: RequestedSpeechProviders;
  /** Spoken agent alerts (TTS of attention notifications). Absent means off. */
  notifications?: { enabled: boolean };
  sttLanguages?: FdeSpeechSttLanguages;
  local?: FdeLocalSpeechConfig;
}

export type DaemonLifecycleIntent =
  | {
      type: "shutdown";
      clientId: string;
      requestId: string;
      reason: string;
    }
  | {
      type: "restart";
      clientId: string;
      requestId: string;
      reason: string;
    };

export interface FdeDaemonConfig {
  /** Internal transport boundary; never persisted or accepted from remote clients. */
  executionService?: { token: string; getPublicListen(): string };
  listen: string;
  fdeHome: string;
  daemonVersion?: string;
  desktopManaged?: boolean;
  worktreesRoot?: string;
  corsAllowedOrigins: string[];
  allowedHosts?: HostnamesConfig;
  hostnames?: HostnamesConfig;
  trustedProxies?: true | string[];
  /** Treat private-network clients like loopback (docs/permissions.md, "Trusted LAN"). */
  trustLan?: boolean;
  mcpEnabled?: boolean;
  mcpInjectIntoAgents?: boolean;
  browserToolsEnabled?: boolean;
  git?: {
    maxProcessesPerSecond: number;
    maxProcessConcurrency: number;
  };
  autoArchiveAfterMerge?: boolean;
  autoUpdate?: DaemonAutoUpdateConfig;
  enableTerminalAgentHooks?: boolean;
  appendSystemPrompt?: string;
  terminalProfiles?: TerminalProfile[];
  agentProfiles?: AgentProfile[];
  skillSelection?: AgentSkillSelection;
  pluginsEnabled?: boolean;
  plugins?: Record<string, PluginSource>;
  staticDir: string;
  mcpDebug: boolean;
  isDev?: boolean;
  agentClients: Partial<Record<AgentProvider, AgentClient>>;
  agentStoragePath: string;
  relayEnabled?: boolean;
  relayEnabledMutable?: boolean;
  relayEndpoint?: string;
  relayPublicEndpoint?: string;
  relayUseTls?: boolean;
  relayPublicUseTls?: boolean;
  serviceProxy?: {
    publicBaseUrl: string | null;
    standaloneListen: string | null;
  };
  webUi?: {
    enabled: boolean;
    distDir: string | null;
  };
  appBaseUrl?: string;
  auth?: DaemonAuthConfig;
  openai?: FdeOpenAIConfig;
  speech?: FdeSpeechConfig;
  voiceLlmProvider?: AgentProvider | null;
  voiceLlmProviderExplicit?: boolean;
  voiceLlmModel?: string | null;
  dictationFinalTimeoutMs?: number;
  downloadTokenTtlMs?: number;
  agentProviderSettings?: AgentProviderRuntimeSettingsMap;
  providerCatalogRefreshTimeoutMs?: number;
  metadataGeneration?: {
    providers?: Array<{
      provider: string;
      model?: string;
      thinkingOptionId?: string;
    }>;
  };
  providerOverrides?: Record<string, ProviderOverride>;
  log?: PersistedConfig["log"];
  onLifecycleIntent?: (intent: DaemonLifecycleIntent) => void;
  pushNotificationSender?: PushNotificationSender;
  managedProcesses?: ManagedProcessRegistry;
  configReload?: {
    env: NodeJS.ProcessEnv;
    cli?: CliConfigOverrides;
    overrideControlledPaths: string[];
    relayEnabledFallback: boolean;
    startupPersisted: PersistedConfig;
  };
}

export interface FdeDaemon {
  config: FdeDaemonConfig;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  terminalManager: TerminalManager;
  serviceProxy: ServiceProxySubsystem;
  scriptRuntimeStore: WorkspaceScriptRuntimeStore;
  browserToolsBroker: BrowserToolsBroker;
  claimStore: ClaimStore;
  start(): Promise<void>;
  stop(): Promise<void>;
  getListenTarget(): ListenTarget | null;
}

export interface FdeDaemonDependencies {
  hubRelationshipRemote?: HubRelationshipRemote;
  hubRelationshipClock?: HubRelationshipClock;
  hubRelationshipRetryPolicy?: HubRelationshipRetryPolicy;
  createHubDaemonId?: () => string;
  serverFeatureOverrides?: {
    daemonStatusRpc?: boolean;
    relayConfig?: boolean;
  };
}

function createBootstrapManagedProcessRegistry(
  config: Pick<FdeDaemonConfig, "fdeHome" | "managedProcesses">,
  logger: Logger,
): ManagedProcessRegistry {
  if (config.managedProcesses) {
    return config.managedProcesses;
  }

  return createManagedProcessRegistry({
    fdeHome: config.fdeHome,
    processTable: createSystemManagedProcessTable(),
    terminateProcess: terminateWithTreeKill,
    logger,
  });
}

async function reconcileManagedProcessLedger(
  managedProcesses: ManagedProcessRegistry,
  logger: Logger,
): Promise<void> {
  const reapResult = await managedProcesses.reapStale();
  if (reapResult.checked > 0 || reapResult.errors.length > 0) {
    logger.info(reapResult, "Managed helper process ledger reconciled");
  }
}

function mountWebUi(
  app: express.Application,
  config: FdeDaemonConfig,
  logger: Logger,
  gate: WebUiGate,
): void {
  app.use(
    createWebUiMiddleware({
      enabled: config.webUi?.enabled ?? false,
      distDir: config.webUi?.distDir ?? null,
      label: getHostname(),
      logger,
      gate,
    }),
  );
}

/**
 * The claim page replaces the app only while nobody can authenticate yet
 * (no password, no paired device) and the visitor is not on loopback. A
 * single-machine setup opening http://localhost keeps working untouched.
 */
function createClaimGate(input: {
  auth: DaemonAuthConfig;
  claimStore: ClaimStore;
  offerSource: ClaimOfferSource;
  daemonVersion: string;
}): WebUiGate {
  const { auth, claimStore, offerSource } = input;
  return {
    shouldGate: (req) =>
      !auth.password && !claimStore.isClaimed() && auth.access?.isTrustedClient(req) === false,
    render: async (req) => {
      const requestHost = typeof req.headers.host === "string" ? req.headers.host : undefined;
      const built = buildDirectClaimOffer(offerSource, {
        requestHost,
        useTls: req.protocol === "https",
      });
      return renderClaimGatePage({
        hostname: offerSource.hostname,
        serverId: offerSource.serverId,
        version: input.daemonVersion,
        pairingUrl: built.url,
        qrSvg: await renderPairingQrSvg(built.url),
        expiresAt: built.expiresAt,
        endpoints: built.endpoints,
      });
    },
  };
}

/**
 * `trustLan` rides along in the mutable config (the schema passes unknown keys
 * through) so `fde daemon trust-lan` and `fde daemon reload` apply it live.
 */
function readMutableTrustLan(config: MutableDaemonConfig): boolean {
  const value = (config as Record<string, unknown>).trustLan;
  return typeof value === "boolean" ? value : DEFAULT_TRUST_LAN;
}

function configuredTrustLan(config: Pick<FdeDaemonConfig, "trustLan">): boolean {
  return config.trustLan ?? DEFAULT_TRUST_LAN;
}

function resolveExpressTrustProxySetting(config: FdeDaemonConfig): true | string[] {
  return config.trustedProxies ?? ["loopback"];
}

function resolveAutoUpdate(config: FdeDaemonConfig): DaemonAutoUpdateConfig {
  return config.autoUpdate ?? DEFAULT_AUTO_UPDATE_CONFIG;
}

const BRAND_PAIRING_URL = brand.services.pairingUrl ?? "";
const BRAND_RELAY_ENDPOINT = brand.services.relayEndpoint ?? "";

function createInitialMutableDaemonConfig(config: FdeDaemonConfig): MutableDaemonConfig {
  const providers = config.providerOverrides ?? {};

  const initialConfig: MutableDaemonConfig = {
    relay: { enabled: config.relayEnabled ?? true },
    mcp: {
      enabled: config.mcpEnabled ?? true,
      injectIntoAgents: config.mcpInjectIntoAgents ?? true,
    },
    ...(config.hostnames !== undefined ? { hostnames: config.hostnames } : {}),
    cors: { allowedOrigins: config.corsAllowedOrigins },
    trustedProxies: config.trustedProxies ?? ["loopback"],
    trustLan: configuredTrustLan(config),
    git: config.git ?? resolveGitProcessPolicy({ env: process.env }),
    app: { baseUrl: config.appBaseUrl ?? BRAND_PAIRING_URL },
    ...(config.providerCatalogRefreshTimeoutMs !== undefined
      ? { catalogRefreshTimeoutMs: config.providerCatalogRefreshTimeoutMs }
      : {}),
    browserTools: { enabled: config.browserToolsEnabled ?? false },
    providers,
    metadataGeneration: {
      providers: config.metadataGeneration?.providers ?? [],
    },
    autoArchiveAfterMerge: config.autoArchiveAfterMerge ?? false,
    autoUpdate: resolveAutoUpdate(config),
    enableTerminalAgentHooks: config.enableTerminalAgentHooks ?? false,
    appendSystemPrompt: config.appendSystemPrompt ?? "",
    pluginsEnabled: config.pluginsEnabled ?? false,
    plugins: config.plugins ?? {},
    skills: { selection: config.skillSelection },
  };

  if (config.terminalProfiles !== undefined) {
    initialConfig.terminalProfiles = config.terminalProfiles;
  }

  if (config.agentProfiles !== undefined) {
    initialConfig.agentProfiles = config.agentProfiles;
  }

  return initialConfig;
}

export async function createFdeDaemon(
  config: FdeDaemonConfig,
  rootLogger: Logger,
  dependencies: FdeDaemonDependencies = {},
): Promise<FdeDaemon> {
  configureGitProcessPolicy(config.git ?? resolveGitProcessPolicy({ env: process.env }));
  const logger = rootLogger.child({ module: "bootstrap" });
  const obsoleteTimelineDirectory = path.join(config.fdeHome, "agent-timelines");
  await rm(obsoleteTimelineDirectory, { recursive: true, force: true }).catch((error) => {
    logger.warn(
      { err: error, path: obsoleteTimelineDirectory },
      "Failed to remove obsolete agent timeline data",
    );
  });
  const bootstrapStart = performance.now();
  const elapsed = () => `${(performance.now() - bootstrapStart).toFixed(0)}ms`;
  const daemonVersion = config.daemonVersion ?? resolveDaemonVersion(import.meta.url);
  const initialMutableConfig = createInitialMutableDaemonConfig(config);
  const daemonConfigStore = new DaemonConfigStore(config.fdeHome, initialMutableConfig, logger, {
    relayEnabledMutable: config.relayEnabledMutable ?? true,
    startupPersisted: config.configReload?.startupPersisted,
    reloadSource: {
      resolve: (persisted) => {
        const reloaded = resolveConfigFromPersisted(config.fdeHome, persisted, {
          env: config.configReload?.env ?? process.env,
          cli: config.configReload?.cli,
          relayEnabledFallback: config.configReload?.relayEnabledFallback,
        });
        return {
          mutable: createInitialMutableDaemonConfig(reloaded),
          overrideControlledPaths: reloaded.configReload?.overrideControlledPaths ?? [],
        };
      },
    },
  });
  const orchestrationSkills = createOrchestrationSkills(daemonConfigStore);
  void orchestrationSkills.autoUpdate().catch((error) => {
    logger.error({ err: error }, "Failed to maintain orchestration skills at startup");
  });
  const browserToolsPolicy = new DaemonConfigBrowserToolsPolicy(daemonConfigStore);
  const browserToolsBroker = new BrowserToolsBroker({});
  const pluginRuntime = new PluginService(logger, daemonConfigStore, daemonVersion, {
    managedSources: new ManagedPluginSources(config.fdeHome),
  });

  const serverId = getOrCreateServerId(config.fdeHome, { logger });
  const daemonKeyPair = await loadOrCreateDaemonKeyPair(config.fdeHome, logger);
  // Paired principals/credentials and the first-run claim gate (docs/permissions.md).
  const claimStore = createClaimStore(config.fdeHome);
  const claimOffers = createClaimOfferStore();
  const authConfig: DaemonAuthConfig = {
    ...config.auth,
    access: createAccessPolicy({
      claimStore,
      getTrustedProxies: () => daemonConfigStore.get().trustedProxies ?? ["loopback"],
      getTrustLan: () => readMutableTrustLan(daemonConfigStore.get()),
    }),
  };
  const managedProcesses = createBootstrapManagedProcessRegistry(config, logger);
  // Reconcile the helper-process ledger in the background so it never blocks the
  // daemon from coming up; terminating a live leftover can take a few seconds.
  // Best-effort, so a failure is logged here rather than crashing startup.
  void reconcileManagedProcessLedger(managedProcesses, logger).catch((error) => {
    logger.warn({ err: error }, "Failed to reconcile managed helper process ledger");
  });
  let relayRuntime: RelayRuntime | null = null;

  const staticDir = config.staticDir;
  const downloadTokenTtlMs = config.downloadTokenTtlMs ?? 60000;

  const downloadTokenStore = new DownloadTokenStore({
    ttlMs: downloadTokenTtlMs,
  });

  // Capability token authenticating the daemon's own agents to the loopback
  // Agent MCP endpoint (/mcp/agents). Random per daemon run, injected only into
  // local agent configs and the daemon's own MCP client — never sent to remote
  // clients — so it cannot be replayed off-box. This lets the injected MCP
  // authenticate even when the daemon password is set via the app (hash only,
  // no plaintext available). Mirrors the /api/files/download capability-token
  // pattern.
  const agentMcpAuthToken = randomUUID();

  const listenTarget = parseListenString(config.listen);
  const publicListenTarget = () =>
    config.executionService
      ? parseListenString(config.executionService.getPublicListen())
      : (boundListenTarget ?? listenTarget);
  const publicTcpPort = () => {
    const target = publicListenTarget();
    return target.type === "tcp" ? target.port : null;
  };
  const publicTcpHost = () => {
    const target = publicListenTarget();
    return target.type === "tcp" ? target.host : null;
  };
  const publicOrigins = () => {
    const target = publicListenTarget();
    return target.type === "tcp"
      ? [
          `http://${formatHostForHttpUrl(target.host)}:${target.port}`,
          `http://localhost:${target.port}`,
          `http://127.0.0.1:${target.port}`,
        ]
      : [];
  };

  const app = express();
  app.set("trust proxy", resolveExpressTrustProxySetting(config));
  daemonConfigStore.onFieldChange("trustedProxies", (value) => {
    app.set("trust proxy", value ?? ["loopback"]);
  });
  let boundListenTarget: ListenTarget | null = null;
  let workspaceRegistry: FileBackedWorkspaceRegistry | null = null;
  const terminalManager = createConfiguredTerminalManager({
    getTerminalActivityUrl: () => createTerminalActivityUrl(boundListenTarget),
  });
  applyTerminalAgentHookSetting({ store: daemonConfigStore, logger });

  const serviceProxyPublicBaseUrl = config.serviceProxy?.publicBaseUrl
    ? config.serviceProxy.publicBaseUrl
    : null;
  const serviceProxy = createServiceProxySubsystem({
    logger,
    publicBaseUrl: serviceProxyPublicBaseUrl,
  });
  const scriptRuntimeStore = new WorkspaceScriptRuntimeStore();
  const workspaceSetupRuntime = new WorkspaceSetupRuntime();
  let configuredHostnames = config.hostnames ?? config.allowedHosts;
  // `app.pairingBaseUrl` is the current name and `app.baseUrl` the pre-rename
  // one; both are watched so an edit to either applies without a restart.
  const persistedApp: { pairingBaseUrl?: string; baseUrl?: string } = {};
  let appBaseUrl = config.appBaseUrl ?? BRAND_PAIRING_URL;
  const applyAppBaseUrl = () => {
    appBaseUrl = resolvePairingBaseUrl(persistedApp) ?? BRAND_PAIRING_URL;
  };
  daemonConfigStore.onFieldChange("hostnames", (value) => {
    configuredHostnames = value as HostnamesConfig | undefined;
  });
  daemonConfigStore.onFieldChange("app.baseUrl", (value) => {
    persistedApp.baseUrl = typeof value === "string" ? value : undefined;
    applyAppBaseUrl();
  });
  daemonConfigStore.onFieldChange("app.pairingBaseUrl", (value) => {
    persistedApp.pairingBaseUrl = typeof value === "string" ? value : undefined;
    applyAppBaseUrl();
  });
  let wsServer: VoiceAssistantWebSocketServer | null = null;
  let autoUpdater: DaemonAutoUpdater | null = null;
  let serviceProxyListenTarget: ListenTarget | null = null;
  const scriptHealthMonitor = new ScriptHealthMonitor({
    serviceProxy,
    onChange: createScriptStatusEmitter({
      sessions: () =>
        wsServer?.listSessions().map((session) => ({
          emit: (message) => session.emitServerMessage(message),
        })) ?? [],
      serviceProxy,
      runtimeStore: scriptRuntimeStore,
      daemonPort: publicTcpPort,
      resolveWorkspaceDirectory: async (workspaceId) =>
        (await workspaceRegistry?.get(workspaceId))?.cwd ?? null,
      logger,
      serviceProxyPublicBaseUrl,
    }),
  });
  const handleBranchChange = createBranchChangeRouteHandler({
    serviceProxy,
    onRoutesChanged: (workspaceId) => {
      scriptHealthMonitor.invalidateWorkspace(workspaceId);
    },
    logger,
  });

  // Service proxy classifies service hosts before daemon auth/route fallthrough.
  // Registered service hosts proxy directly; known service namespaces without a
  // route return 404 and never reach daemon APIs.
  app.use(serviceProxy.middleware());

  // Host allowlist / DNS rebinding protection (vite-like semantics).
  // For non-TCP (unix sockets), skip host validation.
  if (listenTarget.type === "tcp") {
    app.use((req, res, next) => {
      const hostHeader = typeof req.headers.host === "string" ? req.headers.host : undefined;
      if (
        publicListenTarget().type === "tcp" &&
        !isHostnameAllowed(hostHeader, configuredHostnames)
      ) {
        res.status(403).json({ error: "Invalid Host header" });
        return;
      }
      next();
    });
  }

  // CORS - allow same-origin + configured origins
  const fixedAllowedOrigins = [
    // Fde's Electron renderer used the custom fde:// scheme.
    "fde://app",
    // The FDE Tauri shell: WebKit reports `tauri://localhost`, WebView2 (Windows)
    // `http://tauri.localhost` (or https on newer builds).
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    // For TCP, add localhost variants
    ...(listenTarget.type === "tcp"
      ? [
          `http://${listenTarget.host}:${listenTarget.port}`,
          `http://localhost:${listenTarget.port}`,
          `http://127.0.0.1:${listenTarget.port}`,
        ]
      : []),
  ];
  const allowedOrigins = new Set([...config.corsAllowedOrigins, ...fixedAllowedOrigins]);
  daemonConfigStore.onFieldChange("cors.allowedOrigins", (value) => {
    allowedOrigins.clear();
    for (const origin of [...((value as string[] | undefined) ?? []), ...fixedAllowedOrigins]) {
      allowedOrigins.add(origin);
    }
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      (allowedOrigins.has("*") || allowedOrigins.has(origin) || publicOrigins().includes(origin))
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Local, harmless, and token-gated; deliberately skips daemon auth.
  app.post(
    "/api/terminal-activity",
    express.json(),
    createTerminalActivityRouteHandler(terminalManager),
  );

  // Serve the bundled browser web UI when enabled. Mounted after service-proxy
  // classification and host/CORS handling, but before daemon bearer auth, so
  // static app files load without the daemon password while API/WebSocket calls
  // remain protected.
  const claimOfferSource: ClaimOfferSource = {
    serverId,
    hostname: getHostname(),
    daemonPublicKeyB64: daemonKeyPair.publicKeyB64,
    appBaseUrl: () => appBaseUrl,
    listenTarget: publicListenTarget,
    relay: () => {
      const live = relayRuntime?.getConfig();
      return {
        enabled: live?.enabled ?? daemonConfigStore.get().relay?.enabled ?? false,
        publicEndpoint: live?.publicEndpoint ?? config.relayPublicEndpoint ?? BRAND_RELAY_ENDPOINT,
        publicUseTls: live?.publicUseTls ?? config.relayPublicUseTls ?? false,
      };
    },
    offers: claimOffers,
  };
  // The pairing landing page for this daemon's own `/code/<code>` links, so
  // `pair.frogg.app` can be reverse-proxied here. Public, and mounted before
  // the web UI so the SPA fallback does not swallow it.
  mountPairingCodeRoutes(app, {
    serverId,
    offers: claimOffers,
    pairingBaseUrl: () => appBaseUrl,
  });

  mountWebUi(
    app,
    config,
    logger,
    createClaimGate({ auth: authConfig, claimStore, offerSource: claimOfferSource, daemonVersion }),
  );

  app.use(
    createRequireBearerMiddleware(authConfig, (context) => {
      logger.warn(context, "Rejected HTTP request without valid daemon credentials");
    }),
  );

  app.use(express.json());

  // Serve static files from public directory
  app.use("/public", express.static(staticDir));

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Unauthenticated daemon identity for LAN scanners and the pairing flow. The preflight is
  // registered before the generic CORS middleware, which answers every OPTIONS with a bare 204.
  app.options("/api/identity", createIdentityPreflightHandler());
  app.get(
    "/api/identity",
    createIdentityRouteHandler({
      serverId,
      version: daemonVersion,
      hostname: getHostname,
      listen: () => formatListenTarget(publicListenTarget()),
      isClaimed: () => claimStore.isClaimed() || Boolean(config.auth?.password),
      trustLan: () => authConfig.access?.trustLan() ?? DEFAULT_TRUST_LAN,
      isTrustedClient: (req) => authConfig.access?.isTrustedClient(req) ?? false,
    }),
  );
  mountSetupRoutes(app, {
    claimStore,
    offerSource: claimOfferSource,
    hasPassword: () => Boolean(config.auth?.password),
    logger,
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      status: "server_info",
      serverId,
      hostname: getHostname(),
      version: daemonVersion,
      listen: formatListenTarget(publicListenTarget()),
    });
  });

  const handleFileDownload = async (req: express.Request, res: express.Response): Promise<void> => {
    const token =
      typeof req.query.token === "string" && req.query.token.trim().length > 0
        ? req.query.token.trim()
        : null;

    if (!token) {
      res.status(400).json({ error: "Missing download token" });
      return;
    }

    const entry = downloadTokenStore.consumeToken(token);
    if (!entry) {
      res.status(403).json({ error: "Invalid or expired token" });
      return;
    }

    let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      fileHandle = await open(entry.absolutePath, DOWNLOAD_OPEN_FLAGS);
      const fileStats = await fileHandle.stat();
      if (!fileStats.isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const safeFileName = entry.fileName.replace(/["\r\n]/g, "_");
      res.setHeader("Content-Type", entry.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${safeFileName}"`);
      res.setHeader("Content-Length", fileStats.size.toString());

      const stream = fileHandle.createReadStream();
      fileHandle = null;
      stream.on("error", (err) => {
        logger.error({ err }, "Failed to stream download");
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to read file" });
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      logger.error({ err }, "Failed to download file");
      if (!res.headersSent) {
        res.status(404).json({ error: "File not found" });
      }
    } finally {
      await fileHandle?.close().catch(() => undefined);
    }
  };

  app.get("/api/files/download", (req, res) => {
    void handleFileDownload(req, res);
  });

  const httpServer = createExecutionHttpServer(app, config.executionService);

  // Script proxy WebSocket upgrade handler — must be registered before the
  // VoiceAssistantWebSocketServer attaches its own "upgrade" listener so that
  // script-bound upgrades are forwarded first. The handler is a no-op for
  // requests that don't match a registered script route.
  httpServer.on("upgrade", serviceProxy.upgradeHandler({ passthroughUnknown: true }));

  if (config.serviceProxy?.standaloneListen) {
    serviceProxyListenTarget = parseListenString(config.serviceProxy.standaloneListen);
  }

  const agentStorage = new AgentStorage(config.agentStoragePath, logger);
  const projectRegistry = new FileBackedProjectRegistry(
    path.join(config.fdeHome, "projects", "projects.json"),
    logger,
  );
  workspaceRegistry = new FileBackedWorkspaceRegistry(
    path.join(config.fdeHome, "projects", "workspaces.json"),
    logger,
  );
  const workspaceLabelService = createWorkspaceLabelService({
    fdeHome: config.fdeHome,
    workspaceRegistry,
  });
  const github = createGitHubService();
  const workspaceGitService = new WorkspaceGitServiceImpl({
    logger,
    fdeHome: config.fdeHome,
    worktreesRoot: config.worktreesRoot,
    deps: {
      forgeOverrides: { github },
    },
  });
  const workspaceProvisioning = createWorkspaceProvisioningService({
    serverId,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  const agentProviderRuntime = await createAgentProviderRuntime({
    fdeHome: config.fdeHome,
    logger,
    snapshotManager: {
      refreshTimeoutMs: config.providerCatalogRefreshTimeoutMs,
      runtimeSettings: config.agentProviderSettings,
      providerOverrides: config.providerOverrides,
      workspaceGitService,
      managedProcesses,
      isDev: config.isDev === true,
      extraClients: config.agentClients,
    },
  });
  const providerSnapshotManager = agentProviderRuntime.snapshotManager;
  daemonConfigStore.onFieldChange("catalogRefreshTimeoutMs", (value) => {
    providerSnapshotManager.setRefreshTimeoutMs(typeof value === "number" ? value : undefined);
  });
  daemonConfigStore.onFieldChange("git.maxProcessesPerSecond", () => {
    const git = daemonConfigStore.get().git;
    if (git) configureGitProcessPolicy(git);
  });
  daemonConfigStore.onFieldChange("git.maxProcessConcurrency", () => {
    const git = daemonConfigStore.get().git;
    if (git) configureGitProcessPolicy(git);
  });
  const initialAgentManagerState = providerSnapshotManager.getAgentManagerProviderState();
  const agentManager = new AgentManager({
    clients: initialAgentManagerState.clients,
    providerDefinitions: initialAgentManagerState.providerDefinitions,
    registry: agentStorage,
    appendSystemPrompt: config.appendSystemPrompt,
    onWorkspaceStateMayHaveChanged: ({ cwd }) => {
      workspaceGitService.onWorkspaceStateMayHaveChanged(cwd);
    },
    mcpAuthToken: agentMcpAuthToken,
    logger,
  });

  const detachAgentStoragePersistence = attachAgentStoragePersistence(
    logger,
    agentManager,
    agentStorage,
  );
  await agentStorage.initialize();
  logger.info({ elapsed: elapsed() }, "Agent storage initialized");
  await bootstrapWorkspaceRegistries({
    serverId,
    fdeHome: config.fdeHome,
    agentStorage,
    projectRegistry,
    workspaceRegistry,
    workspaceGitService,
    logger,
  });
  await workspaceLabelService.initialize();
  logger.info({ elapsed: elapsed() }, "Workspace registries bootstrapped");
  const teardownArchivedWorkspaceRuntime = (workspaceId: string): void => {
    scriptRuntimeStore.removeForWorkspace(workspaceId);
    releaseWorkspaceServicePortPlan(workspaceId);
  };
  const workspaceReconciliation = new WorkspaceReconciliationService({
    serverId,
    projectRegistry,
    workspaceRegistry,
    logger,
    workspaceGitService,
    onProjectUpdate: (update) => wsServer?.publishProjectUpdate(update),
    onWorkspaceArchived: teardownArchivedWorkspaceRuntime,
    onWorkspacesChanged: async (workspaceIds) => {
      await fanOutReconciledWorkspaceUpdates({
        sessions: wsServer?.listSessions() ?? [],
        workspaceIds,
        logger,
      });
    },
  });
  await workspaceReconciliation.start();
  void workspaceReconciliation.reconcileNow().catch((error) => {
    logger.warn({ err: error }, "Initial workspace reconciliation failed");
  });
  const checkoutDiffManager = new CheckoutDiffManager({
    logger,
    fdeHome: config.fdeHome,
    workspaceGitService,
  });
  const archiveWorkspaceRecordExternal = async (
    workspaceId: string,
    context?: WorkspaceArchiveContext,
  ) => {
    const existingWorkspace = await archivePersistedWorkspaceRecord({
      workspaceId,
      workspaceRegistry,
      context,
    });
    if (!existingWorkspace || existingWorkspace.archivedAt) return;
    teardownArchivedWorkspaceRuntime(workspaceId);
  };
  // external path→workspace adapter, not ownership: archive-by-path requests that
  // arrive with a worktree path and no workspaceId (old clients / CLI).
  const findWorkspaceIdForCwdExternal = async (cwd: string): Promise<string | null> => {
    return resolveWorkspaceIdForPath(cwd, await workspaceRegistry.list());
  };
  const ensureWorkspaceForCreateExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
      cwd,
      resolveFirstAgentPromptTitle(firstAgentContext),
    );
    if (firstAgentContext) {
      workspaceAutoName.scheduleForDirectory({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        firstAgentContext,
      });
    }
    return workspace.workspaceId;
  };
  const listActiveWorkspacesExternal = async (): Promise<ActiveWorkspaceRef[]> => {
    const workspaces = await workspaceRegistry.list();
    return workspaces
      .filter((workspace) => !workspace.archivedAt)
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        cwd: workspace.cwd,
        kind: workspace.kind,
        worktreeRoot: workspace.worktreeRoot,
        isFdeOwnedWorktree: workspace.isFdeOwnedWorktree,
        mainRepoRoot: workspace.mainRepoRoot,
      }));
  };
  const markWorkspaceArchivingExternal = (workspaceIds: Iterable<string>, archivingAt: string) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listSessions() ?? []) {
      session.markWorkspaceArchivingForExternalMutation(workspaceIdList, archivingAt);
    }
  };
  const clearWorkspaceArchivingExternal = (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    for (const session of wsServer?.listSessions() ?? []) {
      session.clearWorkspaceArchivingForExternalMutation(workspaceIdList);
    }
  };
  const emitWorkspaceUpdatesExternal = async (workspaceIds: Iterable<string>) => {
    const workspaceIdList = Array.from(workspaceIds);
    await Promise.all(
      (wsServer?.listSessions() ?? []).map((session) =>
        session.emitWorkspaceUpdatesForExternalWorkspaceIds(workspaceIdList),
      ),
    );
  };
  const ensureWorkspaceForCreateAndBroadcastExternal = async (
    cwd: string,
    firstAgentContext?: FirstAgentContext,
  ): Promise<string> => {
    const workspaceId = await ensureWorkspaceForCreateExternal(cwd, firstAgentContext);
    await emitWorkspaceUpdatesExternal([workspaceId]);
    return workspaceId;
  };
  const emitWorkspaceUpdateForCwdExternal = async (cwd: string) => {
    const workspaceIds = workspaceIdsOnCheckout(await workspaceRegistry.list(), cwd);
    await emitWorkspaceUpdatesExternal(workspaceIds);
  };
  const emitExternalSessionMessage = (message: SessionOutboundMessage) => {
    wsServer?.broadcast(wrapSessionMessage(message));
  };
  const workspaceAutoName = new WorkspaceAutoName({
    agentManager,
    workspaceRegistry,
    workspaceGitService,
    providerSnapshotManager,
    readDaemonConfig: () => ({ metadataGeneration: daemonConfigStore.get().metadataGeneration }),
    gitMutation: createGitMutationService({
      workspaceGitService,
      logger,
    }),
    emitWorkspaceUpdateForCwd: emitWorkspaceUpdateForCwdExternal,
    emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
      await emitWorkspaceUpdatesExternal([workspaceId]);
    },
    logger,
  });

  setupAutoArchiveOnMerge({
    fdeHome: config.fdeHome,
    fdeWorktreesBaseRoot: config.worktreesRoot,
    daemonConfigStore,
    workspaceGitService,
    github,
    agentManager,
    agentStorage,
    terminalManager,
    logger,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    getAutoArchivedChangeRequestUrl: async (workspaceId) =>
      (await workspaceRegistry.get(workspaceId))?.autoArchivedChangeRequestUrl ?? null,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
  });

  const createFdeWorktreeForTools = async (
    input: Parameters<typeof createFdeWorktreeWorkflow>[1],
    serviceOptions?: Parameters<typeof createFdeWorktreeWorkflow>[2],
  ) => {
    return createFdeWorktreeWorkflow(
      {
        fdeHome: config.fdeHome,
        worktreesRoot: config.worktreesRoot,
        createFdeWorktree: async (workflowInput, workflowOptions) => {
          return createRegisteredFdeWorktree(workflowInput, {
            github,
            ...(workflowOptions?.resolveDefaultBranch
              ? {
                  resolveDefaultBranch: workflowOptions.resolveDefaultBranch,
                }
              : {}),
            workspaceGitService,
            workspaceProvisioning,
          });
        },
        warmWorkspaceGitData: async (workspace) => {
          await Promise.all(
            wsServer
              ?.listSessions()
              .map((session) => session.warmWorkspaceGitDataForWorkspace(workspace)) ?? [],
          );
        },
        autoNameWorkspaceBranchForFirstAgent: (autoNameInput) =>
          workspaceAutoName.scheduleForWorktree(autoNameInput),
        emitWorkspaceUpdateForWorkspaceId: async (workspaceId) => {
          await emitWorkspaceUpdatesExternal([workspaceId]);
        },
        cacheWorkspaceSetupSnapshot: () => {},
        startWorkspaceSetup: (workspaceId, operation) =>
          workspaceSetupRuntime.start(workspaceId, operation),
        emit: emitExternalSessionMessage,
        sessionLogger: logger,
        terminalManager,
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        serviceProxy,
        scriptRuntimeStore,
        getDaemonTcpPort: publicTcpPort,
        getDaemonTcpHost: publicTcpHost,
        serviceProxyPublicBaseUrl,
        onScriptsChanged: null,
      },
      input,
      serviceOptions,
    );
  };

  const createAgentCommandDependencies: CreateAgentCommandDependencies = {
    agentManager,
    agentStorage,
    logger,
    fdeHome: config.fdeHome,
    worktreesRoot: config.worktreesRoot,
    terminalManager,
    providerSnapshotManager,
    createFdeWorktree: createFdeWorktreeForTools,
    ensureWorkspaceForCreate: ensureWorkspaceForCreateAndBroadcastExternal,
  };
  const createAgent = (input: Parameters<typeof createAgentCommand>[1]) =>
    createAgentCommand(createAgentCommandDependencies, input);
  const archiveWorkspaceByIdExternal = (workspaceId: string, requestId: string) =>
    archiveByScope(
      {
        fdeHome: config.fdeHome,
        fdeWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceIdToKill),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        sessionLogger: logger,
      },
      { scope: { kind: "workspace", workspaceId }, requestId },
    );
  const hubAgentLifecycle = new CreateAgentLifecycleDispatch({
    fdeHome: config.fdeHome,
    worktreesRoot: config.worktreesRoot,
    agentManager,
    agentStorage,
    github,
    workspaceGitService,
    createFdeWorktreeWorkflow: createFdeWorktreeForTools,
    archiveAgentForClose: (agentId) =>
      archiveAgentCommand({ agentManager, agentStorage, logger }, agentId),
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emit: emitExternalSessionMessage,
    emitAgentRemove: async () => undefined,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    killTerminalsForWorkspace: (workspaceId) =>
      killTerminalsForWorkspace({ terminalManager, sessionLogger: logger }, workspaceId),
    logger,
  });
  const hubRelationships = new HubRelationshipController({
    fdeHome: config.fdeHome,
    hostname: getHostname(),
    serverId,
    daemonPublicKey: daemonKeyPair.publicKeyB64,
    logger,
    remote: dependencies.hubRelationshipRemote ?? new DirectHubRelationshipRemote(),
    clock: dependencies.hubRelationshipClock,
    retryPolicy: dependencies.hubRelationshipRetryPolicy,
    createDaemonId: dependencies.createHubDaemonId,
    attachSocket: async (socket, options) => {
      if (!wsServer) throw new Error("WebSocket server is not running");
      await wsServer.attachExternalSocket(
        socket,
        { transport: "hub", hubDaemonId: options.daemonId },
        {
          principalId: options.principalId,
          permissions: options.permissions,
          hubExecutionAgents: options.agents,
        },
        options.sessionProtocol === "legacy"
          ? {
              type: "hello",
              clientId: `hub:${options.daemonId}`,
              clientType: "hub",
              protocolVersion: 1,
            }
          : undefined,
      );
    },
    updateAttachedPermissions: (principalId, permissions) => {
      if (!wsServer) throw new Error("WebSocket server is not running");
      wsServer.updatePrincipalPermissions(principalId, permissions);
    },
    createExecutionAgents: (daemonId) =>
      new DaemonExecutions({
        daemonId,
        agentManager,
        agentStorage,
        createAgent,
        interruptAgent: (agentId) => cancelAgentRunCommand({ agentManager, logger }, agentId),
        archiveWorkspace: archiveWorkspaceByIdExternal,
        cleanupFailedCreate: (input) =>
          hubAgentLifecycle.cleanupCreatedWorktreeAfterFailedAgentCreate(input),
      }),
  });

  const createScheduleLocalWorkspaceExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => {
    const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
      input.cwd,
      resolveFirstAgentPromptTitle(input.firstAgentContext),
    );
    workspaceAutoName.scheduleForDirectory({
      workspaceId: workspace.workspaceId,
      cwd: workspace.cwd,
      firstAgentContext: input.firstAgentContext,
    });
    await emitWorkspaceUpdatesExternal([workspace.workspaceId]);
    return workspace;
  };
  const createScheduleFdeWorktreeExternal = async (input: {
    cwd: string;
    firstAgentContext: FirstAgentContext;
  }) => {
    const result = await createFdeWorktreeForTools({
      cwd: input.cwd,
      firstAgentContext: input.firstAgentContext,
    });
    await emitWorkspaceUpdatesExternal([result.workspace.workspaceId]);
    return result;
  };
  const archiveScheduleWorkspaceExternal = async (workspaceId: string) => {
    await archiveByScope(
      {
        fdeHome: config.fdeHome,
        fdeWorktreesBaseRoot: config.worktreesRoot,
        github,
        workspaceGitService,
        agentManager,
        agentStorage,
        findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
        listActiveWorkspaces: listActiveWorkspacesExternal,
        getWorkspace: (workspaceIdToGet) => workspaceRegistry.get(workspaceIdToGet),
        archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
        emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
        markWorkspaceArchiving: markWorkspaceArchivingExternal,
        clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
        killTerminalsForWorkspace: (workspaceIdToKill) =>
          killTerminalsForWorkspace(
            {
              terminalManager,
              sessionLogger: logger,
            },
            workspaceIdToKill,
          ),
        stopWorkspaceSetup: (workspaceIdToStop) => workspaceSetupRuntime.stop(workspaceIdToStop),
        sessionLogger: logger,
      },
      {
        scope: { kind: "workspace", workspaceId },
        requestId: "schedule-run-finish",
      },
    );
  };
  const scheduleService = new ScheduleService({
    fdeHome: config.fdeHome,
    logger,
    agentManager,
    agentStorage,
    createAgent,
    createDirectoryWorkspace: createScheduleLocalWorkspaceExternal,
    createFdeWorktreeWorkspace: createScheduleFdeWorktreeExternal,
    archiveWorkspace: archiveScheduleWorkspaceExternal,
  });
  await scheduleService.start();
  agentManager.setAgentArchivedCallback(async (agentId) => {
    try {
      await scheduleService.completeForAgent(agentId);
    } catch (error) {
      logger.warn({ err: error, agentId }, "Failed to complete schedules for archived agent");
    }
  });
  logger.info({ elapsed: elapsed() }, "Schedule service initialized");
  logger.info({ elapsed: elapsed() }, "Loading persisted agent registry");
  const persistedRecords = await agentStorage.list();
  logger.info(
    { elapsed: elapsed() },
    `Agent registry loaded (${persistedRecords.length} record${persistedRecords.length === 1 ? "" : "s"}); agents will initialize on demand`,
  );
  logger.info(
    "Voice mode configured for agent-scoped resume flow (no dedicated voice assistant provider)",
  );
  logger.info({ elapsed: elapsed() }, "Preparing voice and MCP runtime");

  const createAgentToolHostDependencies = (
    runtime: FdeToolRuntimeContext,
  ): FdeToolHostDependencies => ({
    agentManager,
    agentStorage,
    terminalManager,
    getDaemonTcpPort: publicTcpPort,
    scheduleService,
    providerSnapshotManager,
    daemonConfigStore,
    github,
    workspaceGitService,
    findWorkspaceIdForCwd: findWorkspaceIdForCwdExternal,
    listActiveWorkspaces: listActiveWorkspacesExternal,
    archiveWorkspaceRecord: archiveWorkspaceRecordExternal,
    emitWorkspaceUpdatesForWorkspaceIds: emitWorkspaceUpdatesExternal,
    workspaceRegistry,
    projectRegistry,
    createDirectoryWorkspace: async (cwd, title, projectId) => {
      const workspace = await workspaceProvisioning.createWorkspaceForDirectory(
        cwd,
        title,
        projectId,
      );
      await emitWorkspaceUpdatesExternal([workspace.workspaceId]);
      return workspace;
    },
    workspaceScripts: createWorkspaceScriptsService({
      serviceProxy,
      scriptRuntimeStore,
      terminalManager,
      workspaceRegistry,
      projectRegistry,
      workspaceGitService,
      getDaemonTcpPort: publicTcpPort,
      getDaemonTcpHost: publicTcpHost,
      serviceProxyPublicBaseUrl,
      resolveScriptHealth: (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
      logger,
      // MCP operations do not belong to one WebSocket session, so lifecycle
      // status updates fan out to every connected client.
      emit: (message) => wsServer?.broadcast(wrapSessionMessage(message)),
      spawnWorkspaceScript,
      globalServicePorts: loadPersistedConfig(config.fdeHome).worktrees?.servicePorts,
    }),
    markWorkspaceArchiving: markWorkspaceArchivingExternal,
    clearWorkspaceArchiving: clearWorkspaceArchivingExternal,
    ensureWorkspaceForCreate: createAgentCommandDependencies.ensureWorkspaceForCreate,
    createFdeWorktree: createAgentCommandDependencies.createFdeWorktree,
    browserToolsEnabled: browserToolsPolicy.isEnabled(),
    browserToolsBroker,
    fdeHome: config.fdeHome,
    worktreesRoot: config.worktreesRoot,
    callerAgentId: runtime.callerAgentId,
    enableVoiceTools: runtime.enableVoiceTools,
    voiceOnly: runtime.voiceOnly,
    resolveSpeakHandler: (agentId) => wsServer?.resolveVoiceSpeakHandler(agentId) ?? null,
    resolveCallerContext: (agentId) => wsServer?.resolveVoiceCallerContext(agentId) ?? null,
    logger,
  });
  const createAgentToolCatalog = (runtime: FdeToolRuntimeContext) =>
    createFdeToolCatalog(createAgentToolHostDependencies(runtime));
  const setAgentProviderToolsEnabled = (enabled: boolean) => {
    agentProviderRuntime.setFdeToolCatalog(enabled ? createAgentToolCatalog({}) : null);
  };
  agentManager.setFdeToolCatalogFactory(createAgentToolCatalog);
  agentManager.setFdeToolsEnabled(config.mcpInjectIntoAgents !== false);
  setAgentProviderToolsEnabled(config.mcpEnabled !== false && config.mcpInjectIntoAgents !== false);

  let mcpEnabled = config.mcpEnabled ?? true;
  let agentMcpBaseUrl: string | null = null;
  {
    const agentMcpRoute = "/mcp/agents";

    const createAgentMcpSession = async (callerAgentId?: string) => {
      const agentMcpServer = await createAgentMcpServer(
        createAgentToolHostDependencies({ callerAgentId }),
      );

      // Stateless mode: each HTTP request builds a fresh server + transport that is
      // torn down when the response closes, so no per-session state is retained between
      // requests. The agent control plane only lists and calls tools, neither of which
      // needs cross-request state, so sessions would only pin memory for the life of the
      // daemon (agents that exit without a clean DELETE never get reaped).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        // NOTE: We enforce a Vite-like host allowlist at the app/websocket layer.
        // StreamableHTTPServerTransport's built-in check requires exact Host header matches.
        enableDnsRebindingProtection: false,
      });
      Object.assign(transport, {
        onerror: (err: Error) => {
          logger.error({ err }, "Agent MCP transport error");
        },
      });

      await agentMcpServer.connect(transport);
      return { server: agentMcpServer, transport };
    };

    const runAgentMcpRequest = async (
      req: express.Request,
      res: express.Response,
    ): Promise<void> => {
      if (!mcpEnabled) {
        res.status(404).json({ error: "Agent MCP endpoint disabled" });
        return;
      }
      // This route is exempt from the global daemon-password middleware, so it
      // authenticates here using the injected capability token (or a valid
      // daemon password). Without this, a password-protected daemon would be
      // wide open on its agent control plane.
      if (
        !(await isAgentMcpRequestAuthorized({
          password: config.auth?.password,
          capabilityToken: agentMcpAuthToken,
          authorizationHeader: req.header("authorization"),
        }))
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (config.mcpDebug) {
        logger.debug(
          {
            method: req.method,
            url: req.originalUrl,
            sessionId: req.header("mcp-session-id"),
            authorization: req.header("authorization") ? MCP_DEBUG_SECRET : undefined,
            body: describeMcpDebugPayload(req.body),
          },
          "Agent MCP request",
        );
      }
      try {
        // Stateless: GET (standalone SSE) and DELETE (session termination) have no
        // meaning without sessions. The MCP client tolerates 405 on the GET stream
        // and never issues a DELETE because it is never handed a session id.
        if (req.method !== "POST") {
          res.status(405).json({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Method not allowed",
            },
            id: null,
          });
          return;
        }
        const callerAgentIdRaw = req.query.callerAgentId;
        let callerAgentId: string | undefined;
        if (typeof callerAgentIdRaw === "string") {
          callerAgentId = callerAgentIdRaw;
        } else if (Array.isArray(callerAgentIdRaw) && typeof callerAgentIdRaw[0] === "string") {
          callerAgentId = callerAgentIdRaw[0];
        }
        const { server, transport } = await createAgentMcpSession(callerAgentId);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });

        await transport.handleRequest(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse,
          req.body,
        );
      } catch (err) {
        logger.error({ err }, "Failed to handle Agent MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: {
              code: -32603,
              message: "Internal MCP server error",
            },
            id: null,
          });
        }
      }
    };

    const handleAgentMcpRequest: express.RequestHandler = (req, res) => {
      void runAgentMcpRequest(req, res);
    };

    app.post(agentMcpRoute, handleAgentMcpRequest);
    app.get(agentMcpRoute, handleAgentMcpRequest);
    app.delete(agentMcpRoute, handleAgentMcpRequest);
    logger.info({ route: agentMcpRoute, enabled: mcpEnabled }, "Agent MCP route mounted");
  }

  const speechService = createSpeechService({
    logger,
    openaiConfig: config.openai,
    speechConfig: config.speech,
  });
  logger.info({ elapsed: elapsed() }, "Speech service created");

  const spokenAlerts = createSpokenAlertService({
    enabled: isSpokenNotificationsEnabled(config.speech),
    resolveTts: () => speechService.resolveTts(),
    cache: createTtsCache({ dir: path.join(config.fdeHome, "tts-cache") }),
    logger,
  });
  mountNotificationAudioRoute({ app, spokenAlerts, logger });

  const companionFillers = createCompanionFillerBank({
    cache: createTtsCache({ dir: path.join(config.fdeHome, "tts-cache") }),
    resolveTts: () => speechService.resolveTts(),
    logger,
  });
  const companionPersisted = loadPersistedConfig(config.fdeHome, logger);
  const companionModelInputs = await resolveCompanionModelInputs({
    env: process.env,
    persisted: companionPersisted,
  });
  const companion: CompanionRuntime = {
    speechReadiness: () => speechService.getReadiness().realtimeVoice,
    acceptedMessages: new CompanionMessageReceipts(
      path.join(config.fdeHome, "companion", "messages.json"),
    ),
    cwd: config.fdeHome,
    nativeVoicePreview: isCompanionNativeVoiceAvailable(companionModelInputs),
    capability: resolveCompanionCapability(companionModelInputs),
    modelConfig: resolveCompanionModelConfig(companionModelInputs),
    notebook: new CompanionNotebookStore({ filePath: companionNotebookPath(config.fdeHome) }),
    fillers: companionFillers,
    createBackend: createCompanionBackendFactory(config.fdeHome),
    createTools: ({ deferredJobs, logger: sessionLogger, endConversation, conversationId }) =>
      createCompanionTools({
        readTimeline: (agentId) => {
          const agent = agentManager.getAgent(agentId);
          if (!agent || agent.internal) throw new Error("Agent is unavailable");
          return agentManager.getTimeline(agentId);
        },
        agentManager,
        agentStorage,
        workspaceRegistry,
        deferredJobs,
        endConversation,
        conversationId,
        notebook: companion.notebook,
        logger: sessionLogger,
      }),
    runDeferredJob: createCompanionSubagentRunner({
      resolveWorkspaceCwd: async (workspaceId) => {
        const workspace = await workspaceRegistry.get(workspaceId);
        if (!workspace || workspace.archivedAt) throw new Error("Workspace is unavailable");
        return workspace.cwd;
      },
      agentManager,
      providerSnapshotManager,
      daemonConfig: { metadataGeneration: daemonConfigStore.get().metadataGeneration },
      cwd: config.fdeHome,
      logger,
    }),
  };

  let companionRefresh: Promise<void> | null = null;
  let companionRefreshedAt = 0;
  companion.refresh = async () => {
    if (companionRefresh) return companionRefresh;
    if (Date.now() - companionRefreshedAt < 15000) return;
    companionRefresh = (async () => {
      const inputs = await resolveCompanionModelInputs({
        env: process.env,
        persisted: loadPersistedConfig(config.fdeHome, logger),
      });
      companion.nativeVoicePreview = isCompanionNativeVoiceAvailable(inputs);
      companion.modelConfig = resolveCompanionModelConfig(inputs);
      companion.capability = resolveCompanionCapability(inputs);
      companionRefreshedAt = Date.now();
    })();
    try {
      await companionRefresh;
    } finally {
      companionRefresh = null;
    }
  };
  companion.jobs = new CompanionDeferredJobs({
    run: companion.runDeferredJob,
    logger,
    filePath: path.join(config.fdeHome, "companion", "jobs.json"),
  });
  companion.watchAgent = (agentId, conversationId, workspaceId) => {
    if (!companion.jobs) return () => {};
    return watchCompanionAgent({
      agentManager,
      jobs: companion.jobs,
      agentId,
      conversationId,
      workspaceId,
    });
  };
  agentManager.subscribe(
    (event) => {
      if (event.type === "agent_state") companion.jobs?.observeAgent(event.agent);
    },
    { replayState: true },
  );

  logger.info({ elapsed: elapsed() }, "Bootstrap complete, ready to start listening");

  const start = async () => {
    let mainStarted = false;
    try {
      if (serviceProxyListenTarget) {
        const boundServiceProxyTarget = await serviceProxy.startStandalone({
          listenTarget: serviceProxyListenTarget,
        });
        serviceProxyListenTarget = boundServiceProxyTarget;
        logger.info(
          {
            listen: formatListenTarget(serviceProxyListenTarget),
            publicBaseUrl: serviceProxyPublicBaseUrl,
            elapsed: elapsed(),
          },
          "Service proxy listening",
        );
      }

      // Start main HTTP server
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          httpServer.off("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          mainStarted = true;
          const logAndResolve = async () => {
            boundListenTarget = resolveBoundListenTarget(listenTarget, httpServer);
            const mcpBaseUrl = createAgentMcpBaseUrl(boundListenTarget);
            agentMcpBaseUrl =
              !mcpEnabled || config.mcpInjectIntoAgents === false ? null : mcpBaseUrl;
            agentManager.setMcpBaseUrl(agentMcpBaseUrl);
            agentManager.setFdeToolsEnabled(mcpEnabled && config.mcpInjectIntoAgents !== false);
            daemonConfigStore.onFieldChange("mcp.enabled", (value) => {
              mcpEnabled = value !== false;
              const inject = daemonConfigStore.get().mcp.injectIntoAgents !== false;
              agentManager.setMcpBaseUrl(mcpEnabled && inject ? mcpBaseUrl : null);
              agentManager.setFdeToolsEnabled(mcpEnabled && inject);
              setAgentProviderToolsEnabled(mcpEnabled && inject);
            });
            daemonConfigStore.onFieldChange("mcp.injectIntoAgents", (value) => {
              agentManager.setMcpBaseUrl(mcpEnabled && value ? mcpBaseUrl : null);
              agentManager.setFdeToolsEnabled(mcpEnabled && value !== false);
              setAgentProviderToolsEnabled(mcpEnabled && value !== false);
            });
            daemonConfigStore.onFieldChange("appendSystemPrompt", (value) => {
              agentManager.setAppendSystemPrompt(typeof value === "string" ? value : "");
            });
            const relayEnabled = config.relayEnabled ?? true;
            const relayEndpoint = config.relayEndpoint ?? BRAND_RELAY_ENDPOINT;
            const relayPublicEndpoint = config.relayPublicEndpoint ?? relayEndpoint;
            const relayUseTls = config.relayUseTls ?? relayEndpoint === BRAND_RELAY_ENDPOINT;
            const relayPublicUseTls = config.relayPublicUseTls ?? relayUseTls;
            if (boundListenTarget.type === "tcp") {
              logger.info(
                {
                  host: boundListenTarget.host,
                  port: boundListenTarget.port,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on http://${boundListenTarget.host}:${boundListenTarget.port}`,
              );
            } else {
              logger.info(
                {
                  path: boundListenTarget.path,
                  authRequired: !!config.auth?.password,
                  elapsed: elapsed(),
                },
                `Server listening on ${boundListenTarget.path}`,
              );
            }
            if (config.auth?.password) {
              logger.info("Daemon password authentication enabled");
            }

            // Self-update lives next to the listener: the CLI verifies the restarted
            // daemon on this exact address (docs/install.md "Updating").
            const updateService = new DaemonUpdateService({
              install: describeDaemonInstall({ desktopManaged: config.desktopManaged === true }),
              daemonVersion,
              fdeHome: config.fdeHome,
              listen: formatListenTarget(publicListenTarget()),
              getListen: () => formatListenTarget(publicListenTarget()),
              retainAcrossGatewayRestart: Boolean(config.executionService),
              logger,
            });
            autoUpdater = new DaemonAutoUpdater({
              service: updateService,
              getConfig: () => daemonConfigStore.get().autoUpdate,
              hasRunningAgents: () =>
                !config.executionService &&
                agentManager.listAgents().some((agent) => agent.lifecycle === "running"),
              logger,
            });

            wsServer = new VoiceAssistantWebSocketServer(
              httpServer,
              logger,
              serverId,
              agentManager,
              agentStorage,
              downloadTokenStore,
              config.fdeHome,
              daemonConfigStore,
              mcpBaseUrl,
              {
                getAllowedOrigins: () => new Set([...allowedOrigins, ...publicOrigins()]),
                getHostnames: () => configuredHostnames,
                daemonStatusRpc: dependencies.serverFeatureOverrides?.daemonStatusRpc,
                relayConfig: dependencies.serverFeatureOverrides?.relayConfig,
                startPaused: true,
              },
              workspaceAutoName,
              authConfig,
              speechService,
              terminalManager,
              {
                finalTimeoutMs: config.dictationFinalTimeoutMs,
              },
              daemonVersion,
              (intent) => {
                try {
                  config.onLifecycleIntent?.(intent);
                } catch (error) {
                  logger.error({ err: error, intent }, "Failed to handle daemon lifecycle intent");
                }
              },
              projectRegistry,
              workspaceRegistry,
              scheduleService,
              checkoutDiffManager,
              serviceProxy,
              scriptRuntimeStore,
              handleBranchChange,
              publicTcpPort,
              publicTcpHost,
              (hostname) => scriptHealthMonitor.getHealthForHostname(hostname),
              workspaceGitService,
              github,
              config.pushNotificationSender,
              providerSnapshotManager,
              {
                get listen() {
                  return formatListenTarget(publicListenTarget());
                },
                worktreesRoot: config.worktreesRoot,
                get appBaseUrl() {
                  return appBaseUrl;
                },
                desktopManaged: config.desktopManaged === true,
                update: updateService,
                getRelayConfig: () =>
                  relayRuntime?.getConfig() ?? {
                    enabled: daemonConfigStore.get().relay?.enabled ?? relayEnabled,
                    endpoint: relayEndpoint,
                    publicEndpoint: relayPublicEndpoint,
                    useTls: relayUseTls,
                    publicUseTls: relayPublicUseTls,
                  },
              },
              serviceProxyPublicBaseUrl,
              browserToolsBroker,
              hubRelationships,
              workspaceSetupRuntime,
              pluginRuntime,
              orchestrationSkills,
              workspaceLabelService,
              spokenAlerts,
              companion,
            );
            pluginRuntime.bindFdeSessionHost(wsServer);
            await pluginRuntime.start();
            wsServer.beginAcceptingConnections();
            {
              const server = wsServer;
              updateService.setBroadcaster((msg) => server.broadcast(wrapSessionMessage(msg)));
            }
            autoUpdater.start();
            // Fire-and-forget: continue agents a previous daemon stop cut off mid-turn.
            void resumeInterruptedAgents({ agentManager, agentStorage, logger }).catch((err) =>
              logger.error({ err }, "Interrupted-turn resume failed"),
            );
            relayRuntime = createRelayRuntime({
              config: {
                enabled: relayEnabled,
                endpoint: relayEndpoint,
                publicEndpoint: relayPublicEndpoint,
                useTls: relayUseTls,
                publicUseTls: relayPublicUseTls,
              },
              logger,
              attachSocket: async (ws, metadata) => {
                if (!wsServer) throw new Error("WebSocket server is not ready");
                await wsServer.attachExternalSocket(ws, metadata);
              },
              serverId,
              daemonKeyPair: daemonKeyPair.keyPair,
            });
            daemonConfigStore.onFieldChange("relay.enabled", (value) => {
              relayRuntime?.setEnabled(value === true);
            });
            await hubRelationships.start();
          };

          logAndResolve().then(resolve, reject);
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);

        if (listenTarget.type === "tcp") {
          httpServer.listen(listenTarget.port, listenTarget.host);
        } else {
          if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
            unlinkSync(listenTarget.path);
          }
          httpServer.listen(listenTarget.path);
        }
      });

      // Start speech service after listening so synchronous Sherpa native
      // model loading doesn't block the server from accepting connections.
      speechService.start();
      scriptHealthMonitor.start();
    } catch (error) {
      await pluginRuntime.stopAllPlugins().catch(() => undefined);
      await serviceProxy.stopStandalone().catch(() => undefined);
      await agentProviderRuntime.shutdown().catch(() => undefined);
      if (mainStarted) {
        httpServer.closeAllConnections();
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      throw error;
    }
  };

  const stop = async () => {
    autoUpdater?.stop();
    await pluginRuntime.stopAllPlugins();
    await hubRelationships.stop();
    workspaceReconciliation.dispose();
    scriptHealthMonitor.stop();
    // Freeze both ingress and registration before taking the agent closure snapshot.
    wsServer?.prepareForShutdown();
    agentManager.prepareForShutdown();
    const midTurnAgentIds = collectMidTurnAgentIds(agentManager.listAgents());
    await closeAllAgents(logger, agentManager);
    await agentManager.flushForShutdown().catch(() => undefined);
    detachAgentStoragePersistence();
    // Close snapshots rebuild records without the flag, so mark after they land.
    if (midTurnAgentIds.length > 0) {
      await agentStorage.flush().catch(() => undefined);
      await agentStorage
        .markInterruptedTurn(midTurnAgentIds, {
          at: new Date().toISOString(),
          reason: DAEMON_RESTART_INTERRUPT_REASON,
        })
        .catch((err) => logger.warn({ err }, "Failed to mark interrupted agent turns"));
      logger.info({ agentIds: midTurnAgentIds }, "Marked mid-turn agents for resume on restart");
    }
    await agentStorage.flush().catch(() => undefined);
    await agentProviderRuntime.shutdown();
    terminalManager.killAll();
    await speechService.stop();
    await scheduleService.stop().catch(() => undefined);
    await relayRuntime?.stop().catch(() => undefined);
    if (wsServer) {
      await wsServer.close();
    }
    await serviceProxy.stopStandalone();
    // Force-drop remaining sockets so httpServer.close() resolves promptly.
    // We've already closed wsServer (which sent ws-layer close frames) and
    // stopped every other service, so anything still attached is a TCP
    // socket whose higher-level shutdown hasn't fully released it (e.g.
    // upgraded WS sockets in the closing handshake, or HTTP keep-alive
    // sockets in CLOSE_WAIT). closeIdleConnections() does not catch
    // upgraded sockets, so we use closeAllConnections() here.
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    // Clean up socket files
    if (listenTarget.type === "socket" && existsSync(listenTarget.path)) {
      unlinkSync(listenTarget.path);
    }
  };

  return {
    config,
    agentManager,
    agentStorage,
    terminalManager,
    serviceProxy,
    scriptRuntimeStore,
    browserToolsBroker,
    claimStore,
    start,
    stop,
    getListenTarget: () => boundListenTarget,
  };
}

async function closeAllAgents(logger: Logger, agentManager: AgentManager): Promise<void> {
  const agents = agentManager.listAgents();
  await Promise.all(
    agents.map(async (agent) => {
      try {
        await agentManager.closeAgent(agent.id);
      } catch (err) {
        logger.error({ err, agentId: agent.id }, "Failed to close agent");
      }
    }),
  );
}
