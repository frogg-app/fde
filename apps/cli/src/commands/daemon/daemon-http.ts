import { resolveTcpHostFromListen } from "./local-daemon.js";

/**
 * Plain HTTP access to the local daemon's small unauthenticated/setup routes
 * (`/api/identity`, `/api/setup/*`). Only TCP listen targets qualify; a daemon
 * on a unix socket or named pipe has no LAN endpoint to pair against anyway.
 */
const DEFAULT_HTTP_TIMEOUT_MS = 1500;

export function resolveLoopbackHttpBase(listen: string): string | null {
  const host = resolveTcpHostFromListen(listen);
  if (!host) return null;
  const withoutScheme = host.replace(/^tcp:\/\//, "").split("?")[0] ?? "";
  const lastColon = withoutScheme.lastIndexOf(":");
  if (lastColon === -1) return null;
  const rawHost = withoutScheme.slice(0, lastColon).replace(/^\[|\]$/g, "");
  const port = withoutScheme.slice(lastColon + 1);
  const wildcard = rawHost === "0.0.0.0" || rawHost === "::" || rawHost === "";
  const hostForUrl = wildcard ? "127.0.0.1" : rawHost.includes(":") ? `[${rawHost}]` : rawHost;
  return `http://${hostForUrl}:${port}`;
}

export interface DaemonHttpRequest {
  base: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  bearer?: string;
  timeoutMs?: number;
}

export async function daemonHttpJson<T>(request: DaemonHttpRequest): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(`${request.base}${request.path}`, {
      method: request.method ?? "GET",
      headers: {
        ...(request.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(request.bearer ? { authorization: `Bearer ${request.bearer}` } : {}),
      },
      body: request.body !== undefined ? JSON.stringify(request.body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${request.method ?? "GET"} ${request.path} failed with ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
