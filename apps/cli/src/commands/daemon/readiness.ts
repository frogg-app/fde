import os from "node:os";

import type { DaemonIdentity } from "@fde/server";

import { daemonHttpJson, resolveLoopbackHttpBase } from "./daemon-http.js";
import { resolveLocalDaemonState, resolveTcpHostFromListen } from "./local-daemon.js";

/**
 * Readiness for onboarding and status: the daemon is ready as soon as the
 * public `GET /api/identity` answers with `product: "fde"`.
 *
 * That endpoint is deliberately unauthenticated, so a daemon that already has
 * a password or requires pairing answers it too. Polling an authenticated call
 * instead (the old `fetchAgents` probe) hung for the full timeout against
 * exactly those daemons.
 */
const IDENTITY_PROBE_TIMEOUT_MS = 1200;

export interface DaemonReadiness {
  identity: DaemonIdentity;
  listen: string;
  host: string | null;
}

export async function probeDaemonIdentity(
  listen: string,
  timeoutMs: number = IDENTITY_PROBE_TIMEOUT_MS,
): Promise<DaemonIdentity | null> {
  const base = resolveLoopbackHttpBase(listen);
  if (!base) return null;
  try {
    const identity = await daemonHttpJson<DaemonIdentity>({
      base,
      path: "/api/identity",
      timeoutMs,
    });
    return identity.product === "fde" ? identity : null;
  } catch {
    return null;
  }
}

/** One readiness attempt against the local daemon; null while it is not up yet. */
export async function probeLocalDaemonReadiness(
  home: string | undefined,
  timeoutMs: number = IDENTITY_PROBE_TIMEOUT_MS,
): Promise<DaemonReadiness | null> {
  const state = resolveLocalDaemonState({ home });
  if (!state.running) return null;
  const host = resolveTcpHostFromListen(state.listen);
  if (!host) {
    // A unix socket or named pipe has no HTTP endpoint to probe; a running PID
    // is all the readiness there is.
    return null;
  }
  const identity = await probeDaemonIdentity(state.listen, timeoutMs);
  return identity ? { identity, listen: state.listen, host } : null;
}

/** The port from a listen target, for building reachable addresses. */
export function resolveListenPort(listen: string): number | null {
  const host = resolveTcpHostFromListen(listen);
  if (!host) return null;
  const port = Number(host.slice(host.lastIndexOf(":") + 1));
  return Number.isInteger(port) && port > 0 ? port : null;
}

/**
 * The addresses someone on the same network can type into the app: every
 * non-loopback IPv4 address of an interface that is up, with the daemon's
 * port. Empty when the daemon listens on loopback only.
 */
export function listLanAddresses(listen: string): string[] {
  const port = resolveListenPort(listen);
  if (port === null) return [];
  const host = resolveTcpHostFromListen(listen) ?? "";
  const bindHost = host.slice(0, host.lastIndexOf(":"));
  const wildcard = bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]";
  if (!wildcard) {
    const loopback = bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "[::1]";
    return loopback ? [] : [`http://${bindHost}:${port}`];
  }

  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces).sort()) {
    for (const entry of interfaces[name] ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return Array.from(new Set(addresses));
}

export type DaemonAccessMode = "password" | "lan_trusted" | "pairing_required";

export function resolveAccessMode(input: {
  passwordConfigured: boolean;
  lanTrusted: boolean;
}): DaemonAccessMode {
  if (input.passwordConfigured) return "password";
  return input.lanTrusted ? "lan_trusted" : "pairing_required";
}

/** One line for `fde pair` and onboarding: who can connect right now. */
export function describeAccessMode(mode: DaemonAccessMode): string {
  switch (mode) {
    case "password":
      return "Access: password set — every client, LAN included, must enter the daemon password.";
    case "lan_trusted":
      return "Access: LAN trusted — devices on your private network connect without pairing; anyone else must pair.";
    case "pairing_required":
      return "Access: pairing required — every client beyond this machine must pair first.";
  }
}
