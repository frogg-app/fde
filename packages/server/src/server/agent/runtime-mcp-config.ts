import type { AgentSessionConfig, McpServerConfig } from "./agent-sdk-types.js";

const FROGG_MCP_SERVER_NAME = "frogg";
const FROGG_MCP_PATHNAME = "/mcp/agents";

export function stripInternalFroggMcpServer(config: AgentSessionConfig): AgentSessionConfig {
  const mcpServers = config.mcpServers;
  if (!mcpServers) {
    return config;
  }

  const froggServer = mcpServers[FROGG_MCP_SERVER_NAME];
  if (!froggServer || !isInternalFroggMcpServer(froggServer)) {
    return config;
  }

  const nextMcpServers = { ...mcpServers };
  delete nextMcpServers[FROGG_MCP_SERVER_NAME];

  const next = { ...config };
  if (Object.keys(nextMcpServers).length > 0) {
    next.mcpServers = nextMcpServers;
  } else {
    delete next.mcpServers;
  }
  return next;
}

export function withRuntimeFroggMcpServer(params: {
  config: AgentSessionConfig;
  agentId: string;
  mcpBaseUrl: string | null;
  /**
   * Capability token authenticating the injected connection to the daemon's
   * Agent MCP endpoint. The daemon password is gated off this route, so without
   * this header the agent's MCP requests are rejected when a password is set.
   */
  mcpAuthToken: string | null;
}): AgentSessionConfig {
  const storedConfig = stripInternalFroggMcpServer(params.config);
  if (!params.mcpBaseUrl || storedConfig.mcpServers?.[FROGG_MCP_SERVER_NAME]) {
    return storedConfig;
  }

  return {
    ...storedConfig,
    mcpServers: {
      [FROGG_MCP_SERVER_NAME]: {
        type: "http",
        url: `${params.mcpBaseUrl}?callerAgentId=${params.agentId}`,
        ...(params.mcpAuthToken
          ? { headers: { Authorization: `Bearer ${params.mcpAuthToken}` } }
          : {}),
      },
      ...storedConfig.mcpServers,
    },
  };
}

function isInternalFroggMcpServer(config: McpServerConfig): boolean {
  if (config.type !== "http" && config.type !== "sse") {
    return false;
  }

  try {
    return new URL(config.url).pathname === FROGG_MCP_PATHNAME;
  } catch {
    return false;
  }
}
