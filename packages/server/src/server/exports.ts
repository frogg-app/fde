// CLI exports for @frogg/server
export { createFroggDaemon, type FroggDaemon, type FroggDaemonConfig } from "./bootstrap.js";
export { loadConfig, type CliConfigOverrides } from "./config.js";
export { prepareFroggHome, resolveConfiguredHome, resolveFroggHome } from "./frogg-home.js";
export { getOrCreateServerId } from "./server-id.js";
export { createRootLogger, type LogLevel, type LogFormat } from "./logger.js";
export {
  loadPersistedConfig,
  formatPersistedConfig,
  savePersistedConfig,
  type PersistedConfig,
} from "./persisted-config.js";
export { hashDaemonPassword, isBearerTokenValid } from "./auth.js";
export { DEFAULT_TRUST_LAN } from "./access-policy.js";
export { generateLocalPairingOffer, type LocalPairingOffer } from "./pairing-offer.js";
export {
  createClaimStore,
  PRINCIPALS_FILENAME,
  type ClaimStore,
  type PrincipalRecord,
} from "./claim-store.js";
export { type DaemonIdentity } from "./identity-route.js";
export {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl,
  type ConnectionOffer,
} from "@frogg/protocol/connection-offer";
export { buildRelayWebSocketUrl } from "@frogg/protocol/daemon-endpoints";
export {
  buildDaemonWebSocketUrl,
  deriveLabelFromEndpoint,
  normalizeHostPort,
  parseConnectionUri,
  shouldUseTlsForDefaultHostedRelay,
} from "@frogg/protocol/daemon-endpoints";
export { PARENT_AGENT_ID_LABEL } from "@frogg/protocol/agent-labels";
export {
  DirectTcpHostConnectionSchema,
  type DirectTcpHostConnection,
  type NormalizedDirectTcpHostConnection,
} from "@frogg/protocol/host-connection-schema";
export {
  ensureLocalSpeechModels,
  listLocalSpeechModels,
  type LocalSpeechModelId,
  type LocalSttModelId,
  type LocalTtsModelId,
} from "./speech/providers/local/models.js";
export {
  applySherpaLoaderEnv,
  resolveSherpaLoaderEnv,
  sherpaLoaderEnvKey,
  sherpaPlatformArch,
  sherpaPlatformPackageName,
  type SherpaLoaderEnvKey,
  type SherpaLoaderEnvResolution,
} from "./speech/providers/local/sherpa/sherpa-runtime-env.js";

// Provider binary resolution
export {
  type ProviderOverride,
  type ProviderProfileModel,
} from "./agent/provider-launch-config.js";
export { findExecutable } from "../executable-resolution/executable-resolution.js";
export { execCommand, spawnProcess } from "../utils/spawn.js";

// Provider manifest (source of truth for provider definitions)
export {
  AGENT_PROVIDER_DEFINITIONS,
  BUILTIN_PROVIDER_IDS,
  type AgentProviderDefinition,
} from "@frogg/protocol/provider-manifest";

// Agent SDK types for CLI commands
export type {
  AgentMode,
  AgentUsage,
  AgentCapabilityFlags,
  AgentPermissionRequest,
  AgentTimelineItem,
  ProviderSnapshotEntry,
} from "./agent/agent-sdk-types.js";

// Agent activity curator for CLI logs
export { curateAgentActivity } from "./agent/activity-curator.js";
export {
  getStructuredAgentResponse,
  StructuredAgentResponseError,
  StructuredAgentFallbackError,
  DEFAULT_STRUCTURED_GENERATION_PROVIDERS,
  generateStructuredAgentResponseWithFallback,
  type AgentCaller,
  type JsonSchema,
  type StructuredGenerationAttempt,
  type StructuredGenerationProvider,
  type StructuredAgentGenerationOptions,
  type StructuredAgentGenerationWithFallbackOptions,
  type StructuredAgentResponseOptions,
} from "./agent/agent-response-loop.js";

// WebSocket message types for CLI streaming
export type {
  AgentSnapshotPayload,
  AgentStreamEventPayload,
  AgentStreamMessage,
} from "@frogg/protocol/messages";

export { getExecutionServiceStatus, stopExecutionService } from "./execution-service/client.js";
export type { ExecutionServiceStatus } from "./execution-service/protocol.js";
