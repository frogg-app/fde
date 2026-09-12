import type {
  AgentSnapshotPayload,
  CreateAgentRequestMessage,
  FetchWorkspacesRequestMessage,
  FetchWorkspacesResponseMessage,
  GetProvidersSnapshotResponseMessage,
  ListAvailableProvidersResponse,
  ListCommandsResponse,
  ListProviderFeaturesRequestMessage,
  ListProviderFeaturesResponseMessage,
  ListProviderModelsResponseMessage,
  ProjectListRequestMessage,
  ProjectListResponseMessage,
  ListProviderModesResponseMessage,
  MutableDaemonConfig,
  MutableDaemonConfigPatch,
  ProviderDiagnosticResponseMessage,
  ProjectPlacementPayload,
  WorkspaceProjectDescriptorPayload,
  RefreshProvidersSnapshotResponseMessage,
  SendAgentMessageRequest,
  SessionOutboundMessage,
  WorkspaceDescriptorPayload,
  WorkspaceCreateRequest,
} from "@fde/protocol/messages";
import { DaemonClient } from "./daemon-client.js";
import type { PluginTimelineItem } from "@fde/protocol/agent-types";
import type {
  FetchAgentsEntry,
  FetchAgentsOptions,
  FetchAgentsPageInfo,
  FetchAgentTimelineCursor,
  FetchAgentTimelineDirection,
  FetchAgentTimelinePayload,
  FetchAgentTimelineProjection,
  WaitForFinishResult,
} from "./daemon-client.js";

/**
 * Coding turns routinely run for minutes, so the handle waits far longer than
 * the transport's own conservative default.
 */
const DEFAULT_WAIT_FOR_FINISH_MS = 10 * 60_000;

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

export interface FdeLogger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface FdeClientConfig {
  url: string;
  clientId?: string;
  appVersion?: string;
  runtimeGeneration?: number | null;
  password?: string;
  authHeader?: string;
  suppressSendErrors?: boolean;
  logger?: FdeLogger;
  connectTimeoutMs?: number;
  e2ee?: {
    enabled?: boolean;
    daemonPublicKeyB64?: string;
  };
  reconnect?: {
    enabled?: boolean;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  runtimeMetricsIntervalMs?: number;
  runtimeMetricsWindowMs?: number;
}

export type FdeWorkspace = WorkspaceDescriptorPayload;
export type FdeAgent = AgentSnapshotPayload;
export type FdeAgentListOptions = FetchAgentsOptions;
export type FdeProject = WorkspaceProjectDescriptorPayload;
export type FdeProjectListOptions = Omit<ProjectListRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};
export type FdeProjectListResult = ProjectListResponseMessage["payload"];

export interface FdeAgentListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: FetchAgentsEntry[];
  pageInfo: FetchAgentsPageInfo;
}
export type FdeWorkspaceListOptions = Omit<FetchWorkspacesRequestMessage, "type" | "requestId"> & {
  requestId?: string;
};

export interface FdeWorkspaceListResult {
  requestId: string;
  subscriptionId?: string | null;
  entries: FdeWorkspace[];
  pageInfo: FetchWorkspacesResponseMessage["payload"]["pageInfo"];
}

export interface FdeWorkspaceOpenOptions {
  cwd: string;
  requestId?: string;
}

export type FdeWorkspaceCreateOptions = Omit<WorkspaceCreateRequest, "type" | "requestId"> & {
  requestId?: string;
};

export interface FdeWorkspaceArchiveResult {
  requestId: string;
  workspaceId: string;
  archivedAt: string | null;
  error: string | null;
}

export type FdeWorkspaceUpdate = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export type FdeWorkspaceUpdateHandler = (update: FdeWorkspaceUpdate) => void;

export interface FdeWorkspaceHandle {
  readonly id: string;
  readonly projectId: string | null;
  readonly directory: string | null;
  readonly name: string | null;
  readonly status: FdeWorkspace["status"] | null;
  readonly agents: {
    create(options: FdeWorkspaceAgentCreateOptions): Promise<FdeAgentHandle>;
  };
  current(): FdeWorkspace | null;
  refresh(options?: { requestId?: string }): Promise<FdeWorkspace | null>;
  setTitle(title: string | null, requestId?: string): Promise<{ title: string | null }>;
  archive(requestId?: string): Promise<FdeWorkspaceArchiveResult>;
  /**
   * Subscribes to already-emitted daemon workspace_update events for this id.
   * This returns a local unsubscribe function; it does not own app cache state or
   * send a daemon unsubscribe RPC. Call `workspaces.list({ subscribe: {} })` when
   * the daemon should start streaming workspace directory updates.
   */
  subscribe(handler: (update: FdeWorkspaceUpdate) => void): () => void;
}

export interface FdeProjectActions {
  list(options?: FdeProjectListOptions): Promise<FdeProjectListResult>;
}

export interface FdeWorkspaceActions {
  list(options?: FdeWorkspaceListOptions): Promise<FdeWorkspaceListResult>;
  ref(workspace: string | FdeWorkspace): FdeWorkspaceHandle;
  open(input: string | FdeWorkspaceOpenOptions, requestId?: string): Promise<FdeWorkspaceHandle>;
  create(options: FdeWorkspaceCreateOptions): Promise<FdeWorkspaceHandle>;
  archive(
    workspace: string | FdeWorkspaceHandle,
    requestId?: string,
  ): Promise<FdeWorkspaceArchiveResult>;
  /**
   * Local event subscription over the low-level driver's workspace_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: FdeWorkspaceUpdateHandler): () => void;
}

type FdeAgentSessionConfig = CreateAgentRequestMessage["config"];
export type FdeAgentProvider = FdeAgentSessionConfig["provider"];

export type FdeProviderFeatureValues = Record<string, unknown>;

export interface FdeAgentConfig {
  /** Provider and model in `provider/model` format. */
  provider: string;
  modeId?: FdeAgentSessionConfig["modeId"];
  thinkingOptionId?: FdeAgentSessionConfig["thinkingOptionId"];
  featureValues?: FdeProviderFeatureValues;
  /** JSON-safe provider-native settings, validated by the selected provider. */
  options?: FdeAgentSessionConfig["providerOptions"];
  systemPrompt?: FdeAgentSessionConfig["systemPrompt"];
  toolPolicy?: FdeAgentSessionConfig["toolPolicy"];
  mcpServers?: FdeAgentSessionConfig["mcpServers"];
}

export interface FdeAgentCreateOptions {
  config: FdeAgentConfig;
  cwd: string;
  parent?: string | FdeAgentHandle;
  title?: FdeAgentSessionConfig["title"];
  env?: CreateAgentRequestMessage["env"];
  prompt?: string;
  clientMessageId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: CreateAgentRequestMessage["git"];
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  requestId?: string;
  labels?: Record<string, string>;
}

export type FdeWorkspaceAgentCreateOptions = Omit<FdeAgentCreateOptions, "cwd">;

export interface FdeAgentRefetchResult {
  agent: FdeAgent;
  project: ProjectPlacementPayload | null;
}

export interface FdeAgentTimelineRefetchOptions {
  direction?: FetchAgentTimelineDirection;
  cursor?: FetchAgentTimelineCursor;
  limit?: number;
  projection?: FetchAgentTimelineProjection;
  requestId?: string;
}

export interface FdeAgentSendOptions {
  messageId?: string;
  images?: Array<{ data: string; mimeType: string }>;
  attachments?: SendAgentMessageRequest["attachments"];
}

export interface FdeAgentRunOptions extends FdeAgentSendOptions {
  timeoutMs?: number;
}

export type FdeAgentRunResult = WaitForFinishResult;

export interface FdeAgentCommandsOptions {
  requestId?: string;
}

export type FdeAgentCommandsResult = ListCommandsResponse["payload"];

export type FdeAgentUpdate = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];

export type FdeAgentStream = Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"];

export type FdeAgentUpdateHandler = (update: FdeAgentUpdate) => void;

export interface FdeAgentTimelineHandle {
  append(item: Omit<PluginTimelineItem, "pluginId">): Promise<{ seq: number; epoch: string }>;
  /**
   * Fetches a fresh timeline page through the existing daemon RPC. If the daemon
   * includes an agent snapshot in the response, the parent handle is updated to
   * that value.
   */
  refetch(options?: FdeAgentTimelineRefetchOptions): Promise<FetchAgentTimelinePayload>;
  /**
   * Local listener for agent_stream events matching this handle id. It does not
   * retain timeline entries or own application cache state.
   */
  subscribe(handler: (event: FdeAgentStream) => void): () => void;
}

export interface FdeAgentHandle {
  readonly id: string;
  /**
   * `workspaceId` through `archivedAt` mirror the last snapshot this handle
   * observed. A handle from `ref()` reads `null` for all of them until
   * `refresh()`, `run()`, `waitForFinish()`, a timeline refetch, or
   * `subscribe()` delivers a snapshot. Optional snapshot values also read as
   * `null`; use `current()` when you need to distinguish those states.
   */
  readonly workspaceId: string | null;
  readonly cwd: string | null;
  readonly status: FdeAgent["status"] | null;
  readonly capabilities: FdeAgent["capabilities"] | null;
  readonly availableModes: FdeAgent["availableModes"] | null;
  readonly pendingPermissions: FdeAgent["pendingPermissions"] | null;
  readonly activeTurn: NonNullable<FdeAgent["activeTurn"]> | null;
  readonly lastUsage: NonNullable<FdeAgent["lastUsage"]> | null;
  readonly lastError: NonNullable<FdeAgent["lastError"]> | null;
  readonly features: NonNullable<FdeAgent["features"]> | null;
  readonly runtimeInfo: NonNullable<FdeAgent["runtimeInfo"]> | null;
  readonly archivedAt: NonNullable<FdeAgent["archivedAt"]> | null;
  readonly timeline: FdeAgentTimelineHandle;
  current(): FdeAgent | null;
  refresh(requestId?: string): Promise<FdeAgentRefetchResult | null>;
  send(text: string, options?: FdeAgentSendOptions): Promise<void>;
  /** Sends a prompt and resolves when that turn finishes or needs attention. */
  run(text: string, options?: FdeAgentRunOptions): Promise<FdeAgentRunResult>;
  /** Waits for the current turn, including one started with `prompt`. */
  waitForFinish(timeoutMs?: number): Promise<FdeAgentRunResult>;
  /**
   * Asks the running session for the slash commands and skills it actually
   * loaded. Providers answer from the live session, so this sees built-in and
   * bundled entries that no directory scan can find. The payload carries its own
   * `error` string; a provider that cannot answer reports it there rather than
   * rejecting.
   */
  commands(options?: FdeAgentCommandsOptions): Promise<FdeAgentCommandsResult>;
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  subscribe(handler: (update: FdeAgentUpdate) => void): () => void;
}

export interface FdeAgentActions {
  list(options?: FdeAgentListOptions): Promise<FdeAgentListResult>;
  ref(agent: string | FdeAgent): FdeAgentHandle;
  create(options: FdeAgentCreateOptions): Promise<FdeAgentHandle>;
  /**
   * Local event subscription over the low-level driver's agent_update stream.
   * The returned function only removes this SDK listener.
   */
  subscribe(handler: FdeAgentUpdateHandler): () => void;
}

export type FdeProviderModelsResult = ListProviderModelsResponseMessage["payload"];
export type FdeProviderModesResult = ListProviderModesResponseMessage["payload"];
type FdeProviderFeaturesDraft = ListProviderFeaturesRequestMessage["draftConfig"];
export interface FdeProviderFeaturesInput extends Omit<
  FdeProviderFeaturesDraft,
  "provider" | "model"
> {
  /** Provider and model in `provider/model` format. */
  provider: string;
}
export type FdeProviderFeaturesResult = ListProviderFeaturesResponseMessage["payload"];
export type FdeProviderAvailabilityResult = ListAvailableProvidersResponse["payload"];
export type FdeProviderSnapshotResult = GetProvidersSnapshotResponseMessage["payload"];
export type FdeProviderSnapshotUpdate = Extract<
  SessionOutboundMessage,
  { type: "providers_snapshot_update" }
>["payload"];
export type FdeProviderRefreshResult = RefreshProvidersSnapshotResponseMessage["payload"];
export type FdeProviderDiagnosticResult = ProviderDiagnosticResponseMessage["payload"];

export interface FdeProviderListOptions {
  cwd?: string;
  requestId?: string;
}

export interface FdeProviderRefreshOptions {
  cwd?: string;
  providers?: FdeAgentProvider[];
  requestId?: string;
}

export interface FdeProviderWaitOptions extends FdeProviderListOptions {
  timeoutMs?: number;
}

export interface FdeProviderActions {
  listModels(
    provider: FdeAgentProvider,
    options?: FdeProviderListOptions,
  ): Promise<FdeProviderModelsResult>;
  listModes(
    provider: FdeAgentProvider,
    options?: FdeProviderListOptions,
  ): Promise<FdeProviderModesResult>;
  listFeatures(
    draftConfig: FdeProviderFeaturesInput,
    options?: { requestId?: string },
  ): Promise<FdeProviderFeaturesResult>;
  listAvailable(options?: { requestId?: string }): Promise<FdeProviderAvailabilityResult>;
  snapshot(options?: FdeProviderListOptions): Promise<FdeProviderSnapshotResult>;
  /** Resolves after the daemon's lazy provider discovery has finished. */
  waitForReady(options?: FdeProviderWaitOptions): Promise<FdeProviderSnapshotResult>;
  refresh(options?: FdeProviderRefreshOptions): Promise<FdeProviderRefreshResult>;
  diagnostic(
    provider: FdeAgentProvider,
    options?: { requestId?: string },
  ): Promise<FdeProviderDiagnosticResult>;
  subscribe(handler: (update: FdeProviderSnapshotUpdate) => void): () => void;
}

export interface FdeConfigActions {
  /**
   * Reads daemon config through the existing config RPC. Provider profiles,
   * custom provider entries, keys/env, custom binaries, and provider enablement
   * are currently config-file-shaped daemon state, so the SDK exposes this raw
   * typed surface instead of pretending there are higher-level provider-settings
   * RPCs.
   */
  get(requestId?: string): Promise<{ requestId: string; config: MutableDaemonConfig }>;
  /**
   * Patches daemon config through the existing config RPC. The daemon validates
   * and persists supported fields; unsupported provider/settings workflows remain
   * daemon gaps until first-class RPCs exist.
   */
  patch(
    config: MutableDaemonConfigPatch,
    requestId?: string,
  ): Promise<{ requestId: string; config: MutableDaemonConfig }>;
}

export interface FdeApi {
  readonly workspaces: FdeWorkspaceActions;
  readonly projects: FdeProjectActions;
  readonly agents: FdeAgentActions;
  readonly providers: FdeProviderActions;
  readonly config: FdeConfigActions;
}

export interface FdeClient extends FdeApi {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureConnected(): void;
  getConnectionState(): ConnectionState;
}

export function createFdeClient(config: FdeClientConfig): FdeClient {
  const daemonClient = new DaemonClient({
    ...config,
    clientId: config.clientId ?? createGeneratedClientId(),
    clientType: "cli",
  });
  return {
    ...createFdeApi(daemonClient),
    connect: () => daemonClient.connect(),
    close: () => daemonClient.close(),
    ensureConnected: () => daemonClient.ensureConnected(),
    getConnectionState: () => daemonClient.getConnectionState(),
  };
}

export function createFdeApi(daemonClient: DaemonClient): FdeApi {
  const createAgentHandle = createAgentHandleFactory(daemonClient);
  const createAgent = async (
    options: FdeAgentCreateOptions,
    placement?: { workspaceId: string; cwd: string },
  ) => {
    const { config: agentConfig, cwd, parent, title, prompt, ...requestOptions } = options;
    const { provider: providerModel, options: providerOptions, ...runtimeConfig } = agentConfig;
    const { provider, model } = parseProviderModel(providerModel);
    const effectiveCwd = placement?.cwd ?? cwd;
    const agent = await daemonClient.createAgent({
      ...requestOptions,
      config: {
        ...runtimeConfig,
        provider,
        model,
        cwd: effectiveCwd,
        ...(title !== undefined ? { title } : {}),
        ...(providerOptions !== undefined ? { providerOptions } : {}),
      },
      ...(placement ? { workspaceId: placement.workspaceId } : {}),
      ...(parent ? { callerAgentId: resolveAgentId(parent) } : {}),
      ...(prompt !== undefined ? { initialPrompt: prompt } : {}),
    });
    return createAgentHandle(agent);
  };
  const createWorkspaceHandle = createWorkspaceHandleFactory(daemonClient, createAgent);

  return {
    projects: {
      list: (options) => daemonClient.listProjects(options),
    },
    workspaces: {
      list: (options) => daemonClient.fetchWorkspaces(options),
      ref: (workspace) => createWorkspaceHandle(workspace),
      open: (input, requestId) =>
        openWorkspace(daemonClient, createWorkspaceHandle, input, requestId),
      create: async ({ requestId, ...options }) => {
        const result = await daemonClient.createWorkspace(options, requestId);
        if (result.error || !result.workspace) {
          throw new Error(result.error ?? "The daemon did not create a workspace");
        }
        return createWorkspaceHandle(result.workspace);
      },
      archive: (workspace, requestId) =>
        daemonClient.archiveWorkspace(resolveWorkspaceId(workspace), requestId),
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          handler(message.payload);
        }),
    },
    agents: {
      list: (options) => daemonClient.fetchAgents(options),
      ref: (agent) => createAgentHandle(agent),
      create: (options) => createAgent(options),
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          handler(message.payload);
        }),
    },
    providers: {
      listModels: (provider, options) => daemonClient.listProviderModels(provider, options),
      listModes: (provider, options) => daemonClient.listProviderModes(provider, options),
      listFeatures: ({ provider: providerModel, ...draftConfig }, options) => {
        const { provider, model } = parseProviderModel(providerModel);
        return daemonClient.listProviderFeatures({ ...draftConfig, provider, model }, options);
      },
      listAvailable: (options) => daemonClient.listAvailableProviders(options),
      snapshot: (options) => daemonClient.getProvidersSnapshot(options),
      waitForReady: (options) => waitForProvidersReady(daemonClient, options),
      refresh: (options) => daemonClient.refreshProvidersSnapshot(options),
      diagnostic: (provider, options) => daemonClient.getProviderDiagnostic(provider, options),
      subscribe: (handler) =>
        daemonClient.on("providers_snapshot_update", (message) => {
          handler(message.payload);
        }),
    },
    config: {
      get: (requestId) => daemonClient.getDaemonConfig(requestId),
      patch: (patch, requestId) => daemonClient.patchDaemonConfig(patch, requestId),
    },
  };
}

type WorkspaceHandleFactory = (workspace: string | FdeWorkspace) => FdeWorkspaceHandle;
type AgentHandleFactory = (agent: string | FdeAgent) => FdeAgentHandle;
type CreateAgent = (
  options: FdeAgentCreateOptions,
  placement?: { workspaceId: string; cwd: string },
) => Promise<FdeAgentHandle>;

function createWorkspaceHandleFactory(
  daemonClient: DaemonClient,
  createAgent: CreateAgent,
): WorkspaceHandleFactory {
  return (workspace) => {
    const id = typeof workspace === "string" ? workspace : workspace.id;
    let current = typeof workspace === "string" ? null : workspace;

    const refresh = async (options?: { requestId?: string }) => {
      let cursor: string | undefined;
      let requestId = options?.requestId;
      do {
        const result = await daemonClient.fetchWorkspaces({
          requestId,
          page: { limit: 200, ...(cursor ? { cursor } : {}) },
        });
        const match = result.entries.find((entry) => entry.id === id);
        if (match) {
          current = match;
          return current;
        }
        cursor = result.pageInfo.nextCursor ?? undefined;
        requestId = undefined;
      } while (cursor);
      current = null;
      return current;
    };

    return {
      id,
      get projectId() {
        return current?.projectId ?? null;
      },
      get directory() {
        return current?.workspaceDirectory ?? null;
      },
      get name() {
        return current?.name ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      agents: {
        create: async (options) => {
          const snapshot = current ?? (await refresh());
          if (!snapshot?.workspaceDirectory) {
            throw new Error(`Workspace ${id} has no available directory`);
          }
          return createAgent(
            { ...options, cwd: snapshot.workspaceDirectory },
            { workspaceId: id, cwd: snapshot.workspaceDirectory },
          );
        },
      },
      current: () => current,
      refresh,
      setTitle: (title, requestId) => daemonClient.setWorkspaceTitle(id, title, requestId),
      archive: async (requestId) => {
        const result = await daemonClient.archiveWorkspace(id, requestId);
        if (current) {
          current = { ...current, archivingAt: result.archivedAt };
        }
        return result;
      },
      subscribe: (handler) =>
        daemonClient.on("workspace_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.workspace.id === id) {
            current = update.workspace;
            handler(update);
          }
          if (update.kind === "remove" && update.id === id) {
            current = null;
            handler(update);
          }
        }),
    };
  };
}

function createAgentHandleFactory(daemonClient: DaemonClient): AgentHandleFactory {
  return (agent) => {
    const id = typeof agent === "string" ? agent : agent.id;
    let current = typeof agent === "string" ? null : agent;

    const handle: FdeAgentHandle = {
      id,
      timeline: {
        append: (item) => daemonClient.appendAgentTimelineItem(id, item),
        refetch: async (options) => {
          const result = await daemonClient.fetchAgentTimeline(id, options);
          if (result.agent) {
            current = result.agent;
          }
          return result;
        },
        subscribe: (handler) =>
          daemonClient.on("agent_stream", (message) => {
            if (message.payload.agentId === id) {
              handler(message.payload);
            }
          }),
      },
      get workspaceId() {
        return current?.workspaceId ?? null;
      },
      get cwd() {
        return current?.cwd ?? null;
      },
      get status() {
        return current?.status ?? null;
      },
      get capabilities() {
        return current?.capabilities ?? null;
      },
      get availableModes() {
        return current?.availableModes ?? null;
      },
      get pendingPermissions() {
        return current?.pendingPermissions ?? null;
      },
      get activeTurn() {
        return current?.activeTurn ?? null;
      },
      get lastUsage() {
        return current?.lastUsage ?? null;
      },
      get lastError() {
        return current?.lastError ?? null;
      },
      get features() {
        return current?.features ?? null;
      },
      get runtimeInfo() {
        return current?.runtimeInfo ?? null;
      },
      get archivedAt() {
        return current?.archivedAt ?? null;
      },
      current: () => current,
      refresh: async (requestId) => {
        const result = await daemonClient.fetchAgent({ agentId: id, requestId });
        current = result?.agent ?? null;
        return result;
      },
      send: async (text, options) => {
        await daemonClient.sendAgentMessage(id, text, options);
      },
      run: async (text, options) => {
        const { timeoutMs, ...sendOptions } = options ?? {};
        await daemonClient.sendAgentMessage(id, text, sendOptions);
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      waitForFinish: async (timeoutMs) => {
        const result = await daemonClient.waitForFinish(
          id,
          timeoutMs ?? DEFAULT_WAIT_FOR_FINISH_MS,
        );
        if (result.final) {
          current = result.final;
        }
        return result;
      },
      commands: (options) => daemonClient.listCommands({ agentId: id, ...options }),
      archive: async () => {
        const result = await daemonClient.archiveAgent(id);
        if (current) {
          current = { ...current, archivedAt: result.archivedAt };
        }
        return result;
      },
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      subscribe: (handler) =>
        daemonClient.on("agent_update", (message) => {
          const update = message.payload;
          if (update.kind === "upsert" && update.agent.id === id) {
            current = update.agent;
            handler(update);
          }
          if (update.kind === "remove" && update.agentId === id) {
            current = null;
            handler(update);
          }
        }),
    };

    return handle;
  };
}

async function openWorkspace(
  daemonClient: DaemonClient,
  createWorkspaceHandle: WorkspaceHandleFactory,
  input: string | FdeWorkspaceOpenOptions,
  requestId?: string,
): Promise<FdeWorkspaceHandle> {
  const options = typeof input === "string" ? { cwd: input, requestId } : input;
  const result = await daemonClient.openProject(options.cwd, options.requestId);
  if (result.error || !result.workspace) {
    throw new Error(result.error ?? `The daemon did not open a workspace for ${options.cwd}`);
  }
  return createWorkspaceHandle(result.workspace);
}

function resolveWorkspaceId(workspace: string | FdeWorkspaceHandle): string {
  return typeof workspace === "string" ? workspace : workspace.id;
}

function resolveAgentId(agent: string | FdeAgentHandle): string {
  return typeof agent === "string" ? agent : agent.id;
}

function parseProviderModel(selection: string): { provider: string; model: string } {
  const separator = selection.indexOf("/");
  if (separator <= 0 || separator === selection.length - 1) {
    throw new Error('Expected config.provider in "provider/model" format');
  }
  return {
    provider: selection.slice(0, separator),
    model: selection.slice(separator + 1),
  };
}

function waitForProvidersReady(
  daemonClient: DaemonClient,
  options: FdeProviderWaitOptions = {},
): Promise<FdeProviderSnapshotResult> {
  // COMPAT(providersSnapshotCwd): added in v0.3.2, remove gate after 2027-02-10.
  if (daemonClient.getLastServerInfoMessage()?.features?.providersSnapshotCwd !== true) {
    return Promise.reject(new Error("Update the host to wait for provider discovery."));
  }

  const { timeoutMs = 60_000, ...snapshotOptions } = options;

  return new Promise((resolve, reject) => {
    let settled = false;
    let requestId: string | null = null;
    let snapshotCwd: string | undefined;
    const pendingUpdates = new Map<string | undefined, FdeProviderSnapshotUpdate>();
    let latestEntries: FdeProviderSnapshotResult["entries"] = [];

    const cleanup = () => {
      clearTimeout(timeout);
      unsubscribe();
    };
    const finish = (snapshot: FdeProviderSnapshotResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(snapshot);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const updateMatches = (update: FdeProviderSnapshotUpdate) => update.cwd === snapshotCwd;

    const unsubscribe = daemonClient.on("providers_snapshot_update", (message) => {
      const update = message.payload;
      if (!requestId) {
        pendingUpdates.set(update.cwd, update);
        return;
      }
      if (!updateMatches(update)) return;
      latestEntries = update.entries;
      if (update.entries.some((entry) => entry.status === "loading")) return;
      finish({ ...update, requestId });
    });

    const timeout = setTimeout(() => {
      const loading = latestEntries
        .filter((entry) => entry.status === "loading")
        .map((entry) => entry.provider)
        .join(", ");
      fail(
        new Error(
          loading
            ? `Timed out waiting for providers: ${loading}`
            : "Timed out waiting for provider discovery",
        ),
      );
    }, timeoutMs);

    void daemonClient
      .getProvidersSnapshot(snapshotOptions)
      .then((snapshot) => {
        requestId = snapshot.requestId;
        snapshotCwd = snapshot.cwd;
        latestEntries = snapshot.entries;
        if (!snapshot.entries.some((entry) => entry.status === "loading")) {
          finish(snapshot);
          return;
        }
        const pendingUpdate = pendingUpdates.get(snapshotCwd);
        if (pendingUpdate && !pendingUpdate.entries.some((entry) => entry.status === "loading")) {
          finish({ ...pendingUpdate, requestId });
        }
        return undefined;
      })
      .catch(fail);
  });
}

function createGeneratedClientId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `fde-sdk-${randomId}`;
}
