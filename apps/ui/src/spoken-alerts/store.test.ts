import { beforeEach, describe, expect, it } from "vitest";
import { alertKey, type SpokenAlert } from "./state";
import { selectBusySpokenAlertEntry, useSpokenAlertsStore } from "./store";

const alert: SpokenAlert = {
  id: "n1",
  serverId: "srv",
  agentId: "agent",
  workspaceId: "ws",
  reason: "finished",
  title: "ade finished",
  spokenText: "Added the play button.",
  receivedAt: 1000,
};
const key = alertKey(alert.serverId, alert.agentId);

function receive(): void {
  useSpokenAlertsStore.getState().dispatch({ type: "received", alert });
}

describe("spoken alert notifications", () => {
  beforeEach(() => {
    useSpokenAlertsStore.setState({ entries: {}, notificationKey: null });
  });

  it("raises the card for an alert and takes it away on dismiss", () => {
    receive();
    useSpokenAlertsStore.getState().showNotification(key);
    expect(useSpokenAlertsStore.getState().notificationKey).toBe(key);

    useSpokenAlertsStore.getState().dismissNotification(key);
    expect(useSpokenAlertsStore.getState().notificationKey).toBeNull();
    // The alert itself survives, so the agent's banner can still play it.
    expect(useSpokenAlertsStore.getState().entries[key]).toBeDefined();
  });

  it("ignores a dismiss aimed at an alert that is no longer showing", () => {
    receive();
    useSpokenAlertsStore.getState().showNotification(key);
    useSpokenAlertsStore.getState().dismissNotification("srv:other");
    expect(useSpokenAlertsStore.getState().notificationKey).toBe(key);
  });

  it("clears the card when the alert itself is dismissed", () => {
    receive();
    useSpokenAlertsStore.getState().showNotification(key);
    useSpokenAlertsStore.getState().dispatch({ type: "dismissed", key });
    expect(useSpokenAlertsStore.getState().notificationKey).toBeNull();
    expect(useSpokenAlertsStore.getState().entries[key]).toBeUndefined();
  });

  it("reports the alert the audio output is busy with, for the floating stop control", () => {
    receive();
    expect(selectBusySpokenAlertEntry(useSpokenAlertsStore.getState())).toBeNull();

    useSpokenAlertsStore.getState().dispatch({ type: "play_requested", key, autoPlay: false });
    expect(selectBusySpokenAlertEntry(useSpokenAlertsStore.getState())?.alert.id).toBe("n1");

    useSpokenAlertsStore.getState().dispatch({ type: "playback_started", key, id: "n1" });
    expect(selectBusySpokenAlertEntry(useSpokenAlertsStore.getState())?.alert.id).toBe("n1");

    useSpokenAlertsStore.getState().dispatch({ type: "playback_finished", key, id: "n1" });
    expect(selectBusySpokenAlertEntry(useSpokenAlertsStore.getState())).toBeNull();
  });
});
