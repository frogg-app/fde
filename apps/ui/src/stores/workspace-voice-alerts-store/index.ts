import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  buildWorkspaceVoiceAlertsKey,
  isWorkspaceVoiceAlertsEnabled,
  mergePersistedWorkspaceVoiceAlerts,
  PersistedWorkspaceVoiceAlertsSchema,
  serializeWorkspaceVoiceAlerts,
  setWorkspaceVoiceAlertsEnabled,
  type PersistedWorkspaceVoiceAlerts,
  type WorkspaceVoiceAlertsState,
} from "./state";

interface WorkspaceVoiceAlertsStore extends WorkspaceVoiceAlertsState {
  setEnabled: (key: string | null, enabled: boolean) => void;
}

export const useWorkspaceVoiceAlertsStore = create<WorkspaceVoiceAlertsStore>()(
  persist<WorkspaceVoiceAlertsStore, [], [], PersistedWorkspaceVoiceAlerts>(
    (set) => ({
      enabledWorkspaceKeys: new Set(),
      setEnabled: (key, enabled) =>
        set((state) => setWorkspaceVoiceAlertsEnabled(state, key, enabled)),
    }),
    {
      name: "workspace-voice-alerts",
      storage: createValidatedPersistStorage(AsyncStorage, PersistedWorkspaceVoiceAlertsSchema),
      partialize: (state) => serializeWorkspaceVoiceAlerts(state),
      merge: (persistedState, currentState) =>
        mergePersistedWorkspaceVoiceAlerts(persistedState, currentState),
    },
  ),
);

/** Reactive read of the opt-in for one workspace; false while the workspace is unknown. */
export function useWorkspaceVoiceAlertsEnabled(
  serverId: string | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  const key = buildWorkspaceVoiceAlertsKey(serverId, workspaceId);
  return useWorkspaceVoiceAlertsStore((state) => isWorkspaceVoiceAlertsEnabled(state, key));
}

/** Non-reactive read for event handlers that only need the current value. */
export function readWorkspaceVoiceAlertsEnabled(
  serverId: string | null | undefined,
  workspaceId: string | null | undefined,
): boolean {
  const key = buildWorkspaceVoiceAlertsKey(serverId, workspaceId);
  return isWorkspaceVoiceAlertsEnabled(useWorkspaceVoiceAlertsStore.getState(), key);
}

export { buildWorkspaceVoiceAlertsKey };
