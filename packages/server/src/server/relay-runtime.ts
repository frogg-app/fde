import type pino from "pino";
import type { KeyPair } from "@fde/relay/e2ee";
import type { ExternalSocketMetadata } from "./websocket-server.js";
import {
  startRelayTransport,
  type RelaySocketLike,
  type RelayTransportController,
} from "./relay-transport.js";

export interface RelayRuntimeConfig {
  enabled: boolean;
  endpoint: string;
  publicEndpoint: string;
  useTls: boolean;
  publicUseTls: boolean;
}

interface RelayRuntimeOptions {
  config: RelayRuntimeConfig;
  logger: pino.Logger;
  attachSocket(ws: RelaySocketLike, metadata?: ExternalSocketMetadata): Promise<void>;
  serverId: string;
  daemonKeyPair: KeyPair;
  startTransport?: typeof startRelayTransport;
}

export interface RelayRuntime {
  getConfig(): RelayRuntimeConfig;
  setEnabled(enabled: boolean): void;
  /** Replace the relay endpoint; restarts an active transport, empty endpoint stops it. */
  setEndpoint(next: { endpoint: string; useTls: boolean }): void;
  stop(): Promise<void>;
}

export function createRelayRuntime(options: RelayRuntimeOptions): RelayRuntime {
  const startTransport = options.startTransport ?? startRelayTransport;
  let config = options.config;
  let transport: RelayTransportController | null = null;

  function start(): void {
    if (transport) return;
    if (!config.endpoint) {
      options.logger.warn(
        "Relay is enabled but no relay endpoint is configured; relay stays inactive until one is set (daemon.relay.endpoint, FDE_RELAY_ENDPOINT, or host settings)",
      );
      return;
    }
    transport = startTransport({
      logger: options.logger,
      attachSocket: options.attachSocket,
      relayEndpoint: config.endpoint,
      relayUseTls: config.useTls,
      serverId: options.serverId,
      daemonKeyPair: options.daemonKeyPair,
    });
  }

  function setEnabled(enabled: boolean): void {
    if (config.enabled === enabled) return;
    if (enabled) {
      start();
      config = { ...config, enabled: true };
      return;
    }
    config = { ...config, enabled: false };
    stopInBackground();
  }

  function stopInBackground(): void {
    const current = transport;
    transport = null;
    void current?.stop().catch((error) => {
      options.logger.warn({ err: error }, "Failed to stop relay transport");
    });
  }

  function setEndpoint(next: { endpoint: string; useTls: boolean }): void {
    const endpoint = next.endpoint.trim();
    if (config.endpoint === endpoint && config.useTls === next.useTls) return;
    const previous = config;
    // A public endpoint that merely mirrored the dial endpoint follows it; an
    // explicitly distinct public endpoint (reverse proxy) is kept.
    const publicFollows = previous.publicEndpoint === previous.endpoint;
    const publicTlsFollows = previous.publicUseTls === previous.useTls;
    config = {
      ...previous,
      endpoint,
      useTls: next.useTls,
      publicEndpoint: publicFollows ? endpoint : previous.publicEndpoint,
      publicUseTls: publicTlsFollows ? next.useTls : previous.publicUseTls,
    };
    stopInBackground();
    if (!config.enabled) return;
    try {
      start();
    } catch (error) {
      config = previous;
      if (previous.enabled) start();
      throw error;
    }
  }

  async function stop(): Promise<void> {
    const current = transport;
    transport = null;
    await current?.stop();
  }

  if (config.enabled) start();

  return {
    getConfig: () => config,
    setEnabled,
    setEndpoint,
    stop,
  };
}
