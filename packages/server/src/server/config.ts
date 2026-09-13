import { brandEnv } from "@fde/branding/identity";
import { brand } from "@fde/branding";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveFdeNodeEnv } from "./fde-env.js";
import { z } from "zod";

import { expandTilde } from "../utils/path.js";

import type { FdeDaemonConfig } from "./bootstrap.js";
import {
  loadPersistedConfig,
  LogFormatSchema,
  LogLevelSchema,
  type PersistedConfig,
} from "./persisted-config.js";
import type { AgentProvider } from "./agent/agent-sdk-types.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ProviderOverride,
} from "./agent/provider-launch-config.js";
import { ProviderOverrideSchema } from "./agent/provider-launch-config.js";
import { AgentProviderSchema } from "@fde/protocol/provider-manifest";
import { DEFAULT_TRUST_LAN } from "./access-policy.js";
import { hashDaemonPassword } from "./auth.js";
import { resolveSpeechConfig } from "./speech/speech-config-resolver.js";
import type { RequestedSpeechProviders } from "./speech/speech-types.js";
import { mergeHostnames, parseHostnamesEnv, type HostnamesConfig } from "./hostnames.js";
import { resolveGitProcessPolicy } from "../utils/git-process-scheduler.js";
import type { DaemonAutoUpdateConfig } from "@fde/protocol/messages";

const DEFAULT_PORT = brand.daemonPort;
const DEFAULT_RELAY_ENDPOINT = brand.services.relayEndpoint ?? "";
const DEFAULT_APP_BASE_URL = brand.services.pairingUrl ?? "";
/**
 * Bases written into config.json by earlier releases as *their* default. A home
 * carrying one of these is not expressing a preference, so the current default
 * wins; anything else the owner typed is honoured.
 */
const SUPERSEDED_APP_BASE_URLS = new Set(["https://frogg.app/pair"]);

export function resolvePairingBaseUrl(app: {
  pairingBaseUrl?: string;
  baseUrl?: string;
}): string | undefined {
  for (const candidate of [app.pairingBaseUrl, app.baseUrl]) {
    const trimmed = candidate?.trim().replace(/\/+$/, "");
    if (trimmed && (!brand.legacyFde || !SUPERSEDED_APP_BASE_URLS.has(trimmed))) return trimmed;
  }
  return undefined;
}

function resolvePersistedPairingBaseUrl(persisted: PersistedConfig): string | undefined {
  return resolvePairingBaseUrl(persisted.app ?? {});
}
const DEFAULT_TRUSTED_PROXIES = ["loopback"];

interface ResolveBundledWebUiDistDirInput {
  moduleUrl?: string | URL;
  resourcesPath?: string;
}

export function resolveBundledWebUiDistDir(input: ResolveBundledWebUiDistDirInput = {}): string {
  const moduleUrl = input.moduleUrl ?? import.meta.url;
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));

  if (path.basename(moduleDir) === "server" && path.basename(path.dirname(moduleDir)) === "src") {
    return path.resolve(moduleDir, "..", "..", "dist", "server", "web-ui");
  }

  if (
    path.basename(moduleDir) === "server" &&
    path.basename(path.dirname(moduleDir)) === "server" &&
    path.basename(path.dirname(path.dirname(moduleDir))) === "dist"
  ) {
    const appDistDir = input.resourcesPath ? path.join(input.resourcesPath, "app-dist") : null;

    if (appDistDir && existsSync(appDistDir)) {
      return appDistDir;
    }

    return path.resolve(moduleDir, "..", "web-ui");
  }

  return path.resolve(moduleDir, "web-ui");
}

const processResourcesPath = "resourcesPath" in process ? process.resourcesPath : undefined;
const BUNDLED_WEB_UI_DIST_DIR = resolveBundledWebUiDistDir({
  resourcesPath: typeof processResourcesPath === "string" ? processResourcesPath : undefined,
});

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeLogEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().toLowerCase();
}

function resolveGitProcessConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): NonNullable<FdeDaemonConfig["git"]> {
  return resolveGitProcessPolicy({
    env,
    persisted: persisted.daemon?.git,
  });
}

export type CliConfigOverrides = Partial<{
  listen: string;
  relayEnabled: boolean;
  relayUseTls: boolean;
  mcpEnabled: boolean;
  mcpInjectIntoAgents: boolean;
  webUiEnabled: boolean;
  hostnames: HostnamesConfig;
}>;

type TrustedProxiesConfig = true | string[];

function resolveLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: PersistedConfig,
): PersistedConfig["log"] {
  const level = parseLogLevelEnv(env.FDE_LOG_LEVEL ?? env.FDE_LOG);
  const format = parseLogFormatEnv(env.FDE_LOG_FORMAT);
  const console = resolveConsoleLogConfigFromEnv(env, persisted.log?.console);
  const file = resolveFileLogConfigFromEnv(env, persisted.log?.file);

  if (level === undefined && format === undefined && !console && !file) {
    return persisted.log;
  }

  return {
    ...persisted.log,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
    ...(console ? { console } : {}),
    ...(file ? { file } : {}),
  };
}

function resolveConsoleLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["console"],
): NonNullable<PersistedConfig["log"]>["console"] {
  const level = parseLogLevelEnv(env.FDE_LOG_CONSOLE_LEVEL);
  const format = parseLogFormatEnv(env.FDE_LOG_CONSOLE_FORMAT);
  if (level === undefined && format === undefined) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(format !== undefined ? { format } : {}),
  };
}

function resolveFileLogConfigFromEnv(
  env: NodeJS.ProcessEnv,
  persisted: NonNullable<PersistedConfig["log"]>["file"],
): NonNullable<PersistedConfig["log"]>["file"] {
  const level = parseLogLevelEnv(env.FDE_LOG_FILE_LEVEL);
  const filePath = nonEmptyEnv(env.FDE_LOG_FILE_PATH);
  const maxSize = nonEmptyEnv(env.FDE_LOG_FILE_ROTATE_SIZE);
  const maxFiles = parsePositiveIntegerEnv(env.FDE_LOG_FILE_ROTATE_COUNT);
  const hasRotateOverride = maxSize !== undefined || maxFiles !== undefined;
  if (level === undefined && filePath === undefined && !hasRotateOverride) return undefined;
  return {
    ...persisted,
    ...(level !== undefined ? { level } : {}),
    ...(filePath !== undefined ? { path: filePath } : {}),
    ...(hasRotateOverride
      ? {
          rotate: {
            ...persisted?.rotate,
            ...(maxSize !== undefined ? { maxSize } : {}),
            ...(maxFiles !== undefined ? { maxFiles } : {}),
          },
        }
      : {}),
  };
}

function parseLogLevelEnv(value: string | undefined): z.infer<typeof LogLevelSchema> | undefined {
  const parsed = LogLevelSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function parseLogFormatEnv(value: string | undefined): z.infer<typeof LogFormatSchema> | undefined {
  const parsed = LogFormatSchema.safeParse(normalizeLogEnv(value));
  return parsed.success ? parsed.data : undefined;
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveIntegerEnv(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const OptionalVoiceLlmProviderSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value): string | null =>
    typeof value === "string" ? value.trim().toLowerCase() : null,
  )
  .pipe(z.union([AgentProviderSchema, z.null()]));

function parseOptionalVoiceLlmProvider(value: unknown): AgentProvider | null {
  const parsed = OptionalVoiceLlmProviderSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function extractProviderOverrides(
  providers: Record<string, unknown> | undefined,
): Record<string, ProviderOverride> | undefined {
  if (!providers) {
    return undefined;
  }

  const providerOverrides = Object.entries(providers).flatMap(([providerId, provider]) => {
    const parsed = ProviderOverrideSchema.safeParse(provider);
    return parsed.success ? [[providerId, parsed.data] as const] : [];
  });

  return providerOverrides.length > 0 ? Object.fromEntries(providerOverrides) : undefined;
}

function extractAgentProviderSettings(
  providerOverrides: Record<string, ProviderOverride> | undefined,
): AgentProviderRuntimeSettingsMap | undefined {
  if (!providerOverrides) {
    return undefined;
  }

  const runtimeSettings = Object.entries(providerOverrides).flatMap(([providerId, provider]) => {
    const parsedProviderId = AgentProviderSchema.safeParse(providerId);
    if (!parsedProviderId.success || (!provider.command && !provider.env)) {
      return [];
    }

    return [
      [
        parsedProviderId.data,
        {
          command: provider.command
            ? {
                mode: "replace" as const,
                argv: provider.command,
              }
            : undefined,
          env: provider.env,
        },
      ] as const,
    ];
  });

  return runtimeSettings.length > 0
    ? (Object.fromEntries(runtimeSettings) as AgentProviderRuntimeSettingsMap)
    : undefined;
}

interface ResolveRelayInput {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  cliRelayEnabled: boolean | undefined;
  cliRelayUseTls: boolean | undefined;
  enabledFallback: boolean;
}

interface ResolvedRelay {
  enabled: boolean;
  enabledMutable: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface ResolvedServiceProxy {
  publicBaseUrl: string | null;
  standaloneListen: string | null;
}

function resolveTlsFromEnv(
  envValue: string | undefined,
  persistedValue: boolean | undefined,
  fallback: boolean,
): boolean {
  if (envValue !== undefined) {
    return parseBooleanEnv(envValue) ?? false;
  }
  return persistedValue ?? fallback;
}

function validateRelayEndpoint(enabled: boolean, endpoint: string): void {
  if (enabled && !endpoint)
    throw new Error(
      "Configure a relay endpoint before enabling relay for this product. For direct or SSH connections, set daemon.relay.enabled to false in config.json; for relay access, set daemon.relay.endpoint to your relay server.",
    );
}

function resolveRelayConfig(input: ResolveRelayInput): ResolvedRelay {
  const environmentEnabled = parseBooleanEnv(input.env.FDE_RELAY_ENABLED);
  // COMPAT(relayOptInDefault): daemons whose startup config omitted this field
  // retain relay-on removal semantics until 2027-01-31. Modern homes use false.
  const enabled =
    input.cliRelayEnabled ??
    environmentEnabled ??
    input.persisted.daemon?.relay?.enabled ??
    input.enabledFallback;
  const endpoint =
    input.env.FDE_RELAY_ENDPOINT ??
    input.persisted.daemon?.relay?.endpoint ??
    DEFAULT_RELAY_ENDPOINT;
  validateRelayEndpoint(enabled, endpoint);
  const publicEndpoint =
    input.env.FDE_RELAY_PUBLIC_ENDPOINT ??
    input.persisted.daemon?.relay?.publicEndpoint ??
    endpoint;
  const useTls =
    input.cliRelayUseTls ??
    resolveTlsFromEnv(
      input.env.FDE_RELAY_USE_TLS,
      input.persisted.daemon?.relay?.useTls,
      endpoint === DEFAULT_RELAY_ENDPOINT,
    );
  const publicUseTls = resolveTlsFromEnv(
    input.env.FDE_RELAY_PUBLIC_USE_TLS,
    input.persisted.daemon?.relay?.publicUseTls,
    useTls,
  );
  return {
    enabled,
    enabledMutable: input.cliRelayEnabled === undefined && environmentEnabled === undefined,
    endpoint,
    publicEndpoint,
    useTls,
    publicUseTls,
  };
}

interface ResolvedVoiceLlm {
  provider: AgentProvider | null;
  providerExplicit: boolean;
  model: string | null;
}

function resolveServiceProxyPublicBaseUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`Invalid FDE_SERVICE_PROXY_PUBLIC_BASE_URL: ${value}`);
  }
}

function resolveServiceProxyConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedServiceProxy {
  const enabledShim =
    parseBooleanEnv(env.FDE_SERVICE_PROXY_ENABLED) ?? persisted.daemon?.serviceProxy?.enabled;
  // COMPAT(serviceProxyEnabled): added 2026-06-02, remove after 2026-12-02.
  // `enabled=false` used to disable the separate service proxy listener. Localhost
  // service proxying is now always enabled; this only suppresses optional layers.
  const optionalLayersEnabled = enabledShim !== false;
  const publicBaseUrl = optionalLayersEnabled
    ? resolveServiceProxyPublicBaseUrl(
        env.FDE_SERVICE_PROXY_PUBLIC_BASE_URL ??
          persisted.daemon?.serviceProxy?.publicBaseUrl ??
          null,
      )
    : null;
  const standaloneListen = optionalLayersEnabled
    ? (env.FDE_SERVICE_PROXY_LISTEN ?? persisted.daemon?.serviceProxy?.listen ?? null)
    : null;

  return { publicBaseUrl, standaloneListen };
}

interface ResolvedWebUi {
  enabled: boolean;
  distDir: string | null;
}

function resolveWebUiConfig(
  fdeHome: string,
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedWebUi {
  const enabled =
    cli?.webUiEnabled ??
    parseBooleanEnv(env.FDE_WEB_UI_ENABLED) ??
    persisted.features?.webUi?.enabled ??
    false;
  const rawDistDir = env.FDE_WEB_UI_DIST_DIR ?? persisted.features?.webUi?.distDir;
  const trimmedDistDir = rawDistDir?.trim();
  const distDir = trimmedDistDir
    ? path.resolve(path.isAbsolute(trimmedDistDir) ? trimmedDistDir : fdeHome, trimmedDistDir)
    : BUNDLED_WEB_UI_DIST_DIR;
  return {
    enabled,
    distDir,
  };
}

function resolveVoiceLlmConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): ResolvedVoiceLlm {
  const envVoiceLlmProvider = parseOptionalVoiceLlmProvider(env.FDE_VOICE_LLM_PROVIDER);
  const persistedVoiceLlmProvider = parseOptionalVoiceLlmProvider(
    persisted.features?.voiceMode?.llm?.provider,
  );
  return {
    provider: envVoiceLlmProvider ?? persistedVoiceLlmProvider ?? null,
    providerExplicit: envVoiceLlmProvider !== null || persistedVoiceLlmProvider !== null,
    model: persisted.features?.voiceMode?.llm?.model ?? null,
  };
}

function resolveCorsAllowedOrigins(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string[] {
  const envCorsOrigins = env.FDE_CORS_ORIGINS
    ? env.FDE_CORS_ORIGINS.split(",").map((s) => s.trim())
    : [];
  const persistedCorsOrigins = persisted.daemon?.cors?.allowedOrigins ?? [];
  return Array.from(
    new Set([...persistedCorsOrigins, ...envCorsOrigins].filter((s) => s.length > 0)),
  );
}

function parseTrustedProxiesEnv(value: string | undefined): TrustedProxiesConfig | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return [];
  }

  return trimmed
    .split(",")
    .map((proxy) => proxy.trim())
    .filter((proxy) => proxy.length > 0);
}

function resolveTrustLanConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): boolean {
  return (
    parseBooleanEnv(env.FDE_TRUST_LAN) ?? persisted.daemon?.auth?.trustLan ?? DEFAULT_TRUST_LAN
  );
}

function resolveTrustedProxiesConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): TrustedProxiesConfig {
  return (
    parseTrustedProxiesEnv(env.FDE_TRUSTED_PROXIES) ??
    persisted.daemon?.trustedProxies ??
    DEFAULT_TRUSTED_PROXIES
  );
}

// FDE_LISTEN can be:
// - host:port (TCP)
// - /path/to/socket (Unix socket)
// - unix:///path/to/socket (Unix socket)
// Default is TCP at 0.0.0.0:9999
function resolveListenAddress(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string {
  return (
    cli?.listen ??
    env.FDE_LISTEN ??
    persisted.daemon?.listen ??
    `0.0.0.0:${env.PORT ?? DEFAULT_PORT}`
  );
}

function resolveAuthConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): FdeDaemonConfig["auth"] {
  const envPassword = env.FDE_PASSWORD?.trim();
  if (envPassword) {
    return { password: hashDaemonPassword(envPassword) };
  }
  return persisted.daemon?.auth?.password
    ? { password: persisted.daemon.auth.password }
    : undefined;
}

function resolveWorktreesRoot(
  fdeHome: string,
  persisted: ReturnType<typeof loadPersistedConfig>,
): string | undefined {
  const configuredRoot = persisted.worktrees?.root?.trim();
  if (!configuredRoot) {
    return undefined;
  }

  const expandedRoot = expandTilde(configuredRoot);
  return path.isAbsolute(expandedRoot)
    ? path.resolve(expandedRoot)
    : path.resolve(fdeHome, expandedRoot);
}

function resolveAppendSystemPrompt(persisted: ReturnType<typeof loadPersistedConfig>): string {
  return persisted.daemon?.appendSystemPrompt ?? "";
}

/** `daemon.autoUpdate` with `FDE_AUTO_UPDATE` overriding `enabled`; off by default. */
export function resolveAutoUpdateConfig(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): DaemonAutoUpdateConfig {
  const persistedAutoUpdate = persisted.daemon?.autoUpdate;
  return {
    enabled: parseBooleanEnv(env.FDE_AUTO_UPDATE) ?? persistedAutoUpdate?.enabled ?? false,
    channel: persistedAutoUpdate?.channel ?? "stable",
    checkIntervalHours: persistedAutoUpdate?.checkIntervalHours ?? 24,
    quietHours: persistedAutoUpdate?.quietHours ?? null,
  };
}

function resolveBrowserToolsEnabled(persisted: ReturnType<typeof loadPersistedConfig>): boolean {
  return persisted.daemon?.browserTools?.enabled ?? false;
}

/**
 * Both profile lists stay `undefined` when absent rather than defaulting to an
 * empty array: for terminal profiles that is what selects the built-in
 * defaults, so an empty array has to keep meaning "the user removed them all".
 */
function resolveProfileLists(persisted: ReturnType<typeof loadPersistedConfig>) {
  return {
    terminalProfiles: persisted.daemon?.terminalProfiles,
    agentProfiles: persisted.daemon?.agentProfiles,
  };
}

function resolveStaticLoadConfigSettings(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  persisted: ReturnType<typeof loadPersistedConfig>,
) {
  return {
    mcpEnabled: cli?.mcpEnabled ?? persisted.daemon?.mcp?.enabled ?? true,
    mcpInjectIntoAgents:
      cli?.mcpInjectIntoAgents ?? persisted.daemon?.mcp?.injectIntoAgents ?? false,
    browserToolsEnabled: resolveBrowserToolsEnabled(persisted),
    autoArchiveAfterMerge: persisted.daemon?.autoArchiveAfterMerge ?? false,
    autoUpdate: resolveAutoUpdateConfig(env, persisted),
    appendSystemPrompt: resolveAppendSystemPrompt(persisted),
    ...resolveProfileLists(persisted),
    hostnames: mergeHostnames([
      persisted.daemon?.hostnames,
      parseHostnamesEnv(env.FDE_HOSTNAMES ?? env.FDE_ALLOWED_HOSTS),
      cli?.hostnames,
    ]),
    trustedProxies: resolveTrustedProxiesConfig(env, persisted),
    trustLan: resolveTrustLanConfig(env, persisted),
    appBaseUrl:
      brandEnv(brand, env, "PAIRING_BASE_URL") ??
      env.FDE_APP_BASE_URL ??
      resolvePersistedPairingBaseUrl(persisted) ??
      DEFAULT_APP_BASE_URL,
  };
}

interface ResolveConfigFromPersistedOptions {
  env?: NodeJS.ProcessEnv;
  cli?: CliConfigOverrides;
  relayEnabledFallback?: boolean;
}

export function resolveConfigFromPersisted(
  fdeHome: string,
  persisted: PersistedConfig,
  options?: ResolveConfigFromPersistedOptions,
): FdeDaemonConfig {
  const resolvedOptions = options ?? {};
  const env = resolvedOptions.env ?? process.env;
  const cli = resolvedOptions.cli;
  const relayEnabledFallback =
    resolvedOptions.relayEnabledFallback ??
    (brand.legacyFde &&
      Boolean(DEFAULT_RELAY_ENDPOINT) &&
      persisted.daemon?.relay?.enabled === undefined);

  const listen = resolveListenAddress(env, cli, persisted);
  const {
    mcpEnabled,
    mcpInjectIntoAgents,
    browserToolsEnabled,
    autoArchiveAfterMerge,
    autoUpdate,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    hostnames,
    trustedProxies,
    trustLan,
    appBaseUrl,
  } = resolveStaticLoadConfigSettings(env, cli, persisted);

  const relay = resolveRelayConfig({
    env,
    persisted,
    cliRelayEnabled: cli?.relayEnabled,
    cliRelayUseTls: cli?.relayUseTls,
    enabledFallback: relayEnabledFallback,
  });
  const serviceProxy = resolveServiceProxyConfig(env, persisted);
  const webUi = resolveWebUiConfig(fdeHome, env, cli, persisted);

  const { openai, speech } = resolveSpeechConfig({
    fdeHome,
    env,
    persisted,
  });

  const voiceLlm = resolveVoiceLlmConfig(env, persisted);
  const providerOverrides = extractProviderOverrides(
    persisted.agents?.providers as Record<string, unknown> | undefined,
  );

  const overrideControlledPaths = resolveOverrideControlledPaths(env, cli, speech.providers);

  return {
    listen,
    fdeHome,
    desktopManaged: env.FDE_DESKTOP_MANAGED === "1",
    worktreesRoot: resolveWorktreesRoot(fdeHome, persisted),
    corsAllowedOrigins: resolveCorsAllowedOrigins(env, persisted),
    hostnames,
    trustedProxies,
    trustLan,
    mcpEnabled,
    mcpInjectIntoAgents,
    browserToolsEnabled,
    git: resolveGitProcessConfig(env, persisted),
    autoArchiveAfterMerge,
    autoUpdate,
    enableTerminalAgentHooks: persisted.daemon?.enableTerminalAgentHooks ?? false,
    appendSystemPrompt,
    terminalProfiles,
    agentProfiles,
    skillSelection: persisted.agents?.skills?.selection,
    mcpDebug: env.MCP_DEBUG === "1",
    isDev: resolveFdeNodeEnv(env) === "development",
    agentStoragePath: path.join(fdeHome, "agents"),
    staticDir: "public",
    agentClients: {},
    relayEnabled: relay.enabled,
    relayEnabledMutable: relay.enabledMutable,
    relayEndpoint: relay.endpoint,
    relayPublicEndpoint: relay.publicEndpoint,
    relayUseTls: relay.useTls,
    relayPublicUseTls: relay.publicUseTls,
    serviceProxy,
    webUi,
    appBaseUrl,
    auth: resolveAuthConfig(env, persisted),
    openai,
    speech,
    voiceLlmProvider: voiceLlm.provider,
    voiceLlmProviderExplicit: voiceLlm.providerExplicit,
    voiceLlmModel: voiceLlm.model,
    agentProviderSettings: extractAgentProviderSettings(providerOverrides),
    providerCatalogRefreshTimeoutMs: persisted.agents?.catalogRefreshTimeoutMs,
    metadataGeneration: persisted.agents?.metadataGeneration,
    providerOverrides,
    log: resolveLogConfigFromEnv(env, persisted),
    configReload: {
      env: { ...env },
      cli: cli ? { ...cli } : undefined,
      overrideControlledPaths,
      relayEnabledFallback,
      startupPersisted: persisted,
    },
  };
}

export function loadConfig(
  fdeHome: string,
  options?: Omit<ResolveConfigFromPersistedOptions, "relayEnabledFallback">,
): FdeDaemonConfig {
  const persisted = loadPersistedConfig(fdeHome);
  return resolveConfigFromPersisted(fdeHome, persisted, options);
}

function parsePositiveGitOverride(value: string | undefined): boolean {
  if (value === undefined) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function resolveOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
  speechProviders: RequestedSpeechProviders,
): string[] {
  return Array.from(
    new Set([
      ...resolveDaemonOverrideControlledPaths(env, cli),
      ...resolveLogOverrideControlledPaths(env),
      ...resolveSpeechOverrideControlledPaths(env, speechProviders),
    ]),
  ).sort();
}

function resolveDaemonOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  return [
    ...resolveCoreDaemonOverridePaths(env, cli),
    ...resolveRelayOverridePaths(env, cli),
    ...resolveServiceAndWebUiOverridePaths(env, cli),
  ];
}

function resolveCoreDaemonOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.listen !== undefined || env.FDE_LISTEN !== undefined) {
    paths.push("daemon.listen");
  }
  if (cli?.mcpEnabled !== undefined) paths.push("daemon.mcp.enabled");
  if (cli?.mcpInjectIntoAgents !== undefined) paths.push("daemon.mcp.injectIntoAgents");
  if (parseBooleanEnv(env.FDE_AUTO_UPDATE) !== undefined) paths.push("daemon.autoUpdate.enabled");
  // Hostname sources append instead of replacing one another, so a launch value
  // does not prevent a persisted hostname edit from taking effect.
  if (parseTrustedProxiesEnv(env.FDE_TRUSTED_PROXIES) !== undefined) {
    paths.push("daemon.trustedProxies");
  }
  if (parseBooleanEnv(env.FDE_TRUST_LAN) !== undefined) paths.push("daemon.auth.trustLan");
  if (parsePositiveGitOverride(env.FDE_GIT_MAX_PROCESSES_PER_SECOND)) {
    paths.push("daemon.git.maxProcessesPerSecond");
  }
  if (parsePositiveGitOverride(env.FDE_GIT_MAX_PROCESS_CONCURRENCY ?? env.FDE_GIT_CONCURRENCY)) {
    paths.push("daemon.git.maxProcessConcurrency");
  }
  if (
    brandEnv(brand, env, "PAIRING_BASE_URL") !== undefined ||
    env.FDE_APP_BASE_URL !== undefined
  ) {
    paths.push("app.baseUrl", "app.pairingBaseUrl");
  }
  if (env.FDE_PASSWORD?.trim()) paths.push("daemon.auth.password");
  return paths;
}

function resolveRelayOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  if (cli?.relayEnabled !== undefined || parseBooleanEnv(env.FDE_RELAY_ENABLED) !== undefined) {
    paths.push("daemon.relay.enabled");
  }
  if (env.FDE_RELAY_ENDPOINT !== undefined) paths.push("daemon.relay.endpoint");
  if (env.FDE_RELAY_PUBLIC_ENDPOINT !== undefined) {
    paths.push("daemon.relay.publicEndpoint");
  }
  if (cli?.relayUseTls !== undefined || env.FDE_RELAY_USE_TLS !== undefined) {
    paths.push("daemon.relay.useTls");
  }
  if (env.FDE_RELAY_PUBLIC_USE_TLS !== undefined) {
    paths.push("daemon.relay.publicUseTls");
  }
  return paths;
}

function resolveServiceAndWebUiOverridePaths(
  env: NodeJS.ProcessEnv,
  cli: CliConfigOverrides | undefined,
): string[] {
  const paths: string[] = [];
  const serviceProxyEnabled = parseBooleanEnv(env.FDE_SERVICE_PROXY_ENABLED);
  if (serviceProxyEnabled !== undefined) paths.push("daemon.serviceProxy.enabled");
  if (env.FDE_SERVICE_PROXY_LISTEN !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.listen");
  }
  if (env.FDE_SERVICE_PROXY_PUBLIC_BASE_URL !== undefined || serviceProxyEnabled === false) {
    paths.push("daemon.serviceProxy.publicBaseUrl");
  }

  if (cli?.webUiEnabled !== undefined || parseBooleanEnv(env.FDE_WEB_UI_ENABLED) !== undefined) {
    paths.push("features.webUi.enabled");
  }
  if (env.FDE_WEB_UI_DIST_DIR !== undefined) paths.push("features.webUi.distDir");
  return paths;
}

function resolveLogOverrideControlledPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];
  if (parseLogLevelEnv(env.FDE_LOG_LEVEL ?? env.FDE_LOG) !== undefined) {
    paths.push("log.level");
  }
  if (parseLogFormatEnv(env.FDE_LOG_FORMAT) !== undefined) paths.push("log.format");
  if (parseLogLevelEnv(env.FDE_LOG_CONSOLE_LEVEL) !== undefined) {
    paths.push("log.console.level");
  }
  if (parseLogFormatEnv(env.FDE_LOG_CONSOLE_FORMAT) !== undefined) {
    paths.push("log.console.format");
  }
  if (parseLogLevelEnv(env.FDE_LOG_FILE_LEVEL) !== undefined) paths.push("log.file.level");
  if (nonEmptyEnv(env.FDE_LOG_FILE_PATH) !== undefined) paths.push("log.file.path");
  if (nonEmptyEnv(env.FDE_LOG_FILE_ROTATE_SIZE) !== undefined) {
    paths.push("log.file.rotate.maxSize");
  }
  if (parsePositiveIntegerEnv(env.FDE_LOG_FILE_ROTATE_COUNT) !== undefined) {
    paths.push("log.file.rotate.maxFiles");
  }
  return paths;
}

function isEnabledSpeechProvider(
  provider: RequestedSpeechProviders[keyof RequestedSpeechProviders],
  expected: "local" | "openai",
): boolean {
  return provider.enabled !== false && provider.provider === expected;
}

function resolveSpeechOverrideControlledPaths(
  env: NodeJS.ProcessEnv,
  providers: RequestedSpeechProviders,
): string[] {
  const paths: string[] = [];
  const add = (envName: string, ...configPaths: string[]) => {
    if (env[envName] !== undefined) paths.push(...configPaths);
  };

  add("FDE_VOICE", "features.voice.enabled");
  add("FDE_VOICE_NOTIFICATIONS", "features.voice.notifications.enabled");
  add("FDE_DICTATION_ENABLED", "features.dictation.enabled");
  add("FDE_DICTATION_STT_PROVIDER", "features.dictation.stt.provider");
  if (
    env.FDE_DICTATION_LOCAL_STT_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.dictationStt, "local")
  ) {
    paths.push("features.dictation.stt.model");
  }
  add("FDE_DICTATION_LANGUAGE", "features.dictation.stt.language");
  add("FDE_VOICE_MODE_ENABLED", "features.voiceMode.enabled");
  add("FDE_VOICE_LLM_PROVIDER", "features.voiceMode.llm.provider");
  add("FDE_VOICE_STT_PROVIDER", "features.voiceMode.stt.provider");
  if (
    env.FDE_VOICE_LOCAL_STT_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.voiceStt, "local")
  ) {
    paths.push("features.voiceMode.stt.model");
  }
  add("FDE_VOICE_LANGUAGE", "features.voiceMode.stt.language");
  add("FDE_VOICE_TURN_DETECTION_PROVIDER", "features.voiceMode.turnDetection.provider");
  add("FDE_VOICE_TTS_PROVIDER", "features.voiceMode.tts.provider");
  if (
    env.FDE_VOICE_LOCAL_TTS_MODEL !== undefined &&
    isEnabledSpeechProvider(providers.voiceTts, "local")
  ) {
    paths.push("features.voiceMode.tts.model");
  }
  add("FDE_VOICE_LOCAL_TTS_SPEAKER_ID", "features.voiceMode.tts.speakerId");
  add("FDE_VOICE_LOCAL_TTS_SPEED", "features.voiceMode.tts.speed");
  add("FDE_LOCAL_MODELS_DIR", "providers.local.modelsDir");
  const openAiDictationStt = isEnabledSpeechProvider(providers.dictationStt, "openai");
  const openAiVoiceStt = isEnabledSpeechProvider(providers.voiceStt, "openai");
  if (env.STT_CONFIDENCE_THRESHOLD !== undefined && (openAiDictationStt || openAiVoiceStt)) {
    paths.push("features.dictation.stt.confidenceThreshold");
  }
  if (env.STT_MODEL !== undefined) {
    if (openAiDictationStt) paths.push("features.dictation.stt.model");
    if (openAiVoiceStt) paths.push("features.voiceMode.stt.model");
  }
  if (isEnabledSpeechProvider(providers.voiceTts, "openai")) {
    add("TTS_MODEL", "features.voiceMode.tts.model");
    add("TTS_VOICE", "features.voiceMode.tts.voice");
  }
  if (env.FDE_DICTATION_LANGUAGE !== undefined && env.FDE_VOICE_LANGUAGE === undefined) {
    paths.push("features.voiceMode.stt.language");
  }
  return paths;
}
