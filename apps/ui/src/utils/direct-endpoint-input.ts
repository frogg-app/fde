import { DEFAULT_DAEMON_PORT } from "@/constants/daemon-port";
import {
  buildDaemonWebSocketUrl,
  serializeConnectionUriForStorage,
  type HostPortParts,
} from "@/utils/daemon-endpoints";

/**
 * What the user typed into the direct-connection field, normalised.
 *
 * Accepted forms (with or without a trailing `/`):
 *   host                       → host:DEFAULT_DAEMON_PORT
 *   host:port
 *   [::1]:port, ::1            → IPv6, bracketed on output
 *   http://host[:port]         → plain WebSocket (port defaults to 80)
 *   https://host[:port]        → TLS WebSocket (port defaults to 443)
 *   ws://host[:port][/ws]      → plain WebSocket
 *   wss://host[:port][/ws]     → TLS WebSocket
 *   tcp://host:port[?ssl=true] → legacy Paseo form, `?password=` honoured
 */
export interface DirectEndpointInput extends HostPortParts {
  useTls: boolean;
  password?: string;
}

export interface DirectEndpointInputOptions {
  /** Port used when the input names none and the scheme has no default. */
  defaultPort?: number;
}

export class DirectEndpointInputError extends Error {
  constructor(
    readonly code: "empty" | "invalid" | "scheme" | "host" | "port" | "userinfo",
    message: string,
  ) {
    super(message);
    this.name = "DirectEndpointInputError";
  }
}

type Scheme = "tcp" | "http" | "https" | "ws" | "wss";

const SCHEME_DEFAULT_PORT: Record<Scheme, number | null> = {
  tcp: null,
  http: 80,
  https: 443,
  ws: 80,
  wss: 443,
};

const SCHEME_USES_TLS: Record<Scheme, boolean> = {
  tcp: false,
  http: false,
  https: true,
  ws: false,
  wss: true,
};

function isScheme(value: string): value is Scheme {
  return (
    value === "tcp" || value === "http" || value === "https" || value === "ws" || value === "wss"
  );
}

function parsePort(value: string, defaultPort: number | null): number {
  if (!value) {
    if (defaultPort === null) {
      throw new DirectEndpointInputError("port", "Port is required");
    }
    return defaultPort;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DirectEndpointInputError("port", "Port must be between 1 and 65535");
  }
  return port;
}

/** A bare IPv6 literal such as `::1` or `fe80::1` (no brackets, no port). */
function isBareIpv6(value: string): boolean {
  return !value.startsWith("[") && value.split(":").length > 2 && /^[0-9a-fA-F:.%]+$/.test(value);
}

export function parseDirectEndpointInput(
  raw: string,
  options: DirectEndpointInputOptions = {},
): DirectEndpointInput {
  const defaultPort = options.defaultPort ?? DEFAULT_DAEMON_PORT;
  let text = raw.trim();
  if (!text) {
    throw new DirectEndpointInputError("empty", "Host is required");
  }

  const schemeMatch = text.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  let scheme: Scheme = "tcp";
  if (schemeMatch) {
    const candidate = schemeMatch[1].toLowerCase();
    if (!isScheme(candidate)) {
      throw new DirectEndpointInputError(
        "scheme",
        `Unsupported scheme "${candidate}" (use http, https, ws, wss or tcp)`,
      );
    }
    scheme = candidate;
    text = text.slice(schemeMatch[0].length);
  }

  if (isBareIpv6(text)) {
    text = `[${text}]`;
  }

  // The URL parser rejects out-of-range ports wholesale; check first so the
  // user hears "port must be between…" rather than "invalid address".
  const explicitPort = text.match(/^(?:\[[^\]]*\]|[^/?#:]*):(\d+)(?=[/?#]|$)/);
  if (explicitPort) {
    parsePort(explicitPort[1], null);
  }

  let url: URL;
  try {
    // A `tcp:` URL keeps host and port verbatim; the real scheme is applied below.
    url = new URL(`tcp://${text}`);
  } catch {
    throw new DirectEndpointInputError("invalid", "Invalid connection address");
  }
  if (url.username || url.password) {
    throw new DirectEndpointInputError("userinfo", "Credentials in the address are not supported");
  }
  if (!url.hostname) {
    throw new DirectEndpointInputError("host", "Host is required");
  }

  const isIpv6 = url.hostname.startsWith("[") && url.hostname.endsWith("]");
  const host = isIpv6 ? url.hostname.slice(1, -1) : url.hostname;
  const port = parsePort(url.port, scheme === "tcp" ? defaultPort : SCHEME_DEFAULT_PORT[scheme]);
  const useTls = SCHEME_USES_TLS[scheme] || url.searchParams.get("ssl") === "true";
  const password = url.searchParams.get("password") || undefined;

  return { host, port, isIpv6, useTls, ...(password ? { password } : {}) };
}

export function formatDirectEndpoint(parts: HostPortParts): string {
  return parts.isIpv6 ? `[${parts.host}]:${parts.port}` : `${parts.host}:${parts.port}`;
}

/** The WebSocket URL the client will actually open for this input. */
export function describeDirectEndpointInput(input: DirectEndpointInput): {
  endpoint: string;
  webSocketUrl: string;
  storageUri: string;
} {
  const endpoint = formatDirectEndpoint(input);
  return {
    endpoint,
    webSocketUrl: buildDaemonWebSocketUrl(endpoint, { useTls: input.useTls }),
    storageUri: serializeConnectionUriForStorage(input),
  };
}

/** Best-effort preview for helper text: null while the input does not parse yet. */
export function previewDirectEndpointInput(raw: string): string | null {
  try {
    return describeDirectEndpointInput(parseDirectEndpointInput(raw)).webSocketUrl;
  } catch {
    return null;
  }
}
