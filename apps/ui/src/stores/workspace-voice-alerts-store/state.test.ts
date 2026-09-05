import { describe, expect, it } from "vitest";
import {
  buildWorkspaceVoiceAlertsKey,
  isWorkspaceVoiceAlertsEnabled,
  mergePersistedWorkspaceVoiceAlerts,
  serializeWorkspaceVoiceAlerts,
  setWorkspaceVoiceAlertsEnabled,
  type WorkspaceVoiceAlertsState,
} from "./state";

function emptyState(): WorkspaceVoiceAlertsState {
  return { enabledWorkspaceKeys: new Set() };
}

describe("workspace voice alerts state", () => {
  it("builds a key only when both ids are present", () => {
    expect(buildWorkspaceVoiceAlertsKey("host", "ws")).toBe("host::ws");
    expect(buildWorkspaceVoiceAlertsKey("host", " ")).toBeNull();
    expect(buildWorkspaceVoiceAlertsKey(null, "ws")).toBeNull();
    expect(buildWorkspaceVoiceAlertsKey("host", undefined)).toBeNull();
  });

  it("treats an unknown workspace as opted out", () => {
    expect(isWorkspaceVoiceAlertsEnabled(emptyState(), "host::ws")).toBe(false);
    expect(isWorkspaceVoiceAlertsEnabled(emptyState(), null)).toBe(false);
  });

  it("opts a workspace in and back out", () => {
    const enabled = setWorkspaceVoiceAlertsEnabled(emptyState(), "host::ws", true);
    expect(isWorkspaceVoiceAlertsEnabled(enabled, "host::ws")).toBe(true);
    const disabled = setWorkspaceVoiceAlertsEnabled(enabled, "host::ws", false);
    expect(isWorkspaceVoiceAlertsEnabled(disabled, "host::ws")).toBe(false);
  });

  it("keeps the same state object when nothing changes", () => {
    const state = emptyState();
    expect(setWorkspaceVoiceAlertsEnabled(state, "host::ws", false)).toBe(state);
    expect(setWorkspaceVoiceAlertsEnabled(state, null, true)).toBe(state);
  });

  it("round-trips through persistence", () => {
    const state = setWorkspaceVoiceAlertsEnabled(emptyState(), "host::ws", true);
    const restored = mergePersistedWorkspaceVoiceAlerts(
      serializeWorkspaceVoiceAlerts(state),
      emptyState(),
    );
    expect(isWorkspaceVoiceAlertsEnabled(restored, "host::ws")).toBe(true);
  });

  it("falls back to the current state when the persisted value is unusable", () => {
    const current = emptyState();
    expect(mergePersistedWorkspaceVoiceAlerts({ enabledWorkspaceKeys: 7 }, current)).toBe(current);
  });
});
