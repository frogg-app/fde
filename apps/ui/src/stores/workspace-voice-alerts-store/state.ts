import { z } from "zod";

/**
 * Spoken alerts are opt-in per workspace: a workspace only speaks once the user turns the
 * composer's voice-alerts control on, so the set below holds the workspaces that opted in.
 */
export interface WorkspaceVoiceAlertsState {
  enabledWorkspaceKeys: Set<string>;
}

export interface PersistedWorkspaceVoiceAlerts {
  enabledWorkspaceKeys?: string[];
}

export const PersistedWorkspaceVoiceAlertsSchema: z.ZodType<PersistedWorkspaceVoiceAlerts> =
  z.strictObject({
    enabledWorkspaceKeys: z.array(z.string()).optional(),
  });

export function buildWorkspaceVoiceAlertsKey(
  serverId: string | null | undefined,
  workspaceId: string | null | undefined,
): string | null {
  const trimmedServerId = serverId?.trim() ?? "";
  const trimmedWorkspaceId = workspaceId?.trim() ?? "";
  if (!trimmedServerId || !trimmedWorkspaceId) {
    return null;
  }
  return `${trimmedServerId}::${trimmedWorkspaceId}`;
}

export function isWorkspaceVoiceAlertsEnabled(
  state: WorkspaceVoiceAlertsState,
  key: string | null,
): boolean {
  return key !== null && state.enabledWorkspaceKeys.has(key);
}

export function setWorkspaceVoiceAlertsEnabled(
  state: WorkspaceVoiceAlertsState,
  key: string | null,
  enabled: boolean,
): WorkspaceVoiceAlertsState {
  if (key === null || state.enabledWorkspaceKeys.has(key) === enabled) {
    return state;
  }
  const next = new Set(state.enabledWorkspaceKeys);
  if (enabled) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return { ...state, enabledWorkspaceKeys: next };
}

export function serializeWorkspaceVoiceAlerts(state: WorkspaceVoiceAlertsState): {
  enabledWorkspaceKeys: string[];
} {
  return { enabledWorkspaceKeys: Array.from(state.enabledWorkspaceKeys) };
}

export function mergePersistedWorkspaceVoiceAlerts<S extends WorkspaceVoiceAlertsState>(
  persistedValue: unknown,
  current: S,
): S {
  const result = PersistedWorkspaceVoiceAlertsSchema.safeParse(persistedValue);
  if (!result.success) {
    return current;
  }
  const restored = new Set(result.data.enabledWorkspaceKeys ?? []);
  return { ...current, enabledWorkspaceKeys: restored };
}
