import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import type { DaemonServerInfo } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";

export type HostFeatureName = keyof NonNullable<DaemonServerInfo["features"]>;

export interface HostFeatureSessionState {
  sessions: Record<
    string,
    | {
        serverInfo: DaemonServerInfo | null;
      }
    | undefined
  >;
}

export function hostSupportsFeature(
  serverInfo: DaemonServerInfo | null | undefined,
  feature: HostFeatureName,
): boolean {
  return serverInfo?.features?.[feature] === true;
}

export function selectHostFeature(
  state: HostFeatureSessionState,
  serverId: string,
  feature: HostFeatureName,
): boolean {
  return hostSupportsFeature(state.sessions[serverId]?.serverInfo, feature);
}

export function useHostFeature(
  serverId: string | null | undefined,
  feature: HostFeatureName,
): boolean {
  const normalizedServerId = serverId?.trim() ?? "";
  return useSessionStore((state) => selectHostFeature(state, normalizedServerId, feature));
}

export function useHostFeatureMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean> {
  const flags = useSessionStore(
    useShallow((state) => serverIds.map((serverId) => selectHostFeature(state, serverId, feature))),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index] === true] as const)),
    [flags, serverIds],
  );
}

export function useHostFeatureAvailabilityMap(
  serverIds: readonly string[],
  feature: HostFeatureName,
): ReadonlyMap<string, boolean | null> {
  const flags = useSessionStore(
    useShallow((state) =>
      serverIds.map((serverId) => {
        const serverInfo = state.sessions[serverId]?.serverInfo;
        return serverInfo ? hostSupportsFeature(serverInfo, feature) : null;
      }),
    ),
  );

  return useMemo(
    () => new Map(serverIds.map((serverId, index) => [serverId, flags[index]] as const)),
    [flags, serverIds],
  );
}

/**
 * Whether every host with a live handshake advertises the feature, and at least one does. For
 * sidebar-wide behaviour that would be wrong for one host's rows (a sort key it never sends).
 */
export function selectAllConnectedHostsSupportFeature(
  state: HostFeatureSessionState,
  feature: HostFeatureName,
): boolean {
  let connected = 0;
  for (const session of Object.values(state.sessions)) {
    if (!session?.serverInfo) continue;
    if (!hostSupportsFeature(session.serverInfo, feature)) return false;
    connected += 1;
  }
  return connected > 0;
}

export function useAllConnectedHostsSupportFeature(feature: HostFeatureName): boolean {
  return useSessionStore((state) => selectAllConnectedHostsSupportFeature(state, feature));
}
