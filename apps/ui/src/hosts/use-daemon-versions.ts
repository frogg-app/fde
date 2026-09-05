import { useEffect, useState } from "react";
import { buildDaemonHttpBase } from "@/pairing/claim-offer";
import type { HostConnection, HostProfile } from "@/types/host-connection";

const IDENTITY_TIMEOUT_MS = 2_000;

/** The first connection we can build an HTTP base from. */
function httpBaseFor(profile: HostProfile): string | null {
  const preferred =
    profile.connections.find((c) => c.id === profile.preferredConnectionId) ??
    profile.connections[0];
  return preferred ? httpBaseForConnection(preferred) : null;
}

function httpBaseForConnection(connection: HostConnection): string | null {
  if (connection.type !== "directTcp") return null;
  try {
    return buildDaemonHttpBase(connection.endpoint, connection.useTls ?? false);
  } catch {
    return null;
  }
}

async function fetchVersion(base: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}/api/identity`, { signal: controller.signal });
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    return typeof body.version === "string" ? body.version : null;
  } catch {
    // Unreachable or not a daemon: the caller renders "unknown" rather than
    // blocking the warning it is decorating.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * serverId -> daemon version, read from the unauthenticated `/api/identity`.
 * Versions are not part of the saved host record, and the handshake does not
 * carry them, so telling two daemons apart means asking each one.
 */
export function useDaemonVersions(profiles: readonly HostProfile[]): Map<string, string | null> {
  const [versions, setVersions] = useState<Map<string, string | null>>(new Map());
  const key = profiles.map((profile) => profile.serverId).join("|");

  useEffect(() => {
    let cancelled = false;
    const targets = profiles
      .map((profile) => ({ serverId: profile.serverId, base: httpBaseFor(profile) }))
      .filter((target): target is { serverId: string; base: string } => target.base !== null);

    const probeAll = async (): Promise<void> => {
      const entries = await Promise.all(
        targets.map(async ({ serverId, base }) => [serverId, await fetchVersion(base)] as const),
      );
      if (!cancelled) setVersions(new Map(entries));
    };
    void probeAll();

    return () => {
      cancelled = true;
    };
    // Re-probe when the set of hosts changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return versions;
}
