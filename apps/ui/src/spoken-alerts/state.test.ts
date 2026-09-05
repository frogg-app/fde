import { describe, expect, it } from "vitest";
import {
  EMPTY_SPOKEN_ALERTS_STATE,
  alertKey,
  reduceSpokenAlerts,
  selectSpokenAlertNotificationKeys,
  shouldAutoPlaySpokenAlert,
  type SpokenAlert,
  type SpokenAlertsState,
} from "./state";

const alert: SpokenAlert = {
  id: "n1",
  serverId: "srv",
  agentId: "agent",
  workspaceId: "ws",
  reason: "finished",
  spokenText: "Fix login in webapp finished.",
  receivedAt: 1000,
};
const key = alertKey("srv", "agent");

function received(
  state: SpokenAlertsState = EMPTY_SPOKEN_ALERTS_STATE,
  next = alert,
  notify = false,
) {
  return reduceSpokenAlerts(state, { type: "received", alert: next, notify });
}

describe("reduceSpokenAlerts", () => {
  it("keeps one idle entry per agent and replaces it with a newer alert", () => {
    const first = received();
    expect(first.entries[key]).toEqual({
      alert,
      playback: { status: "idle" },
      autoPlayAttempted: false,
      notify: false,
    });

    const playing = reduceSpokenAlerts(first, { type: "play_requested", key, autoPlay: false });
    const newer = received(playing, { ...alert, id: "n2", spokenText: "Now finished." });
    expect(newer.entries[key]).toEqual({
      alert: { ...alert, id: "n2", spokenText: "Now finished." },
      playback: { status: "idle" },
      autoPlayAttempted: false,
      notify: false,
    });
  });

  it("ignores a duplicate delivery of the same notification", () => {
    const first = received();
    const playing = reduceSpokenAlerts(first, { type: "play_requested", key, autoPlay: true });
    expect(received(playing)).toBe(playing);
  });

  it("walks idle -> loading -> playing -> played and back to idle on stop", () => {
    let state = received();
    state = reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: false });
    expect(state.entries[key]?.playback).toEqual({ status: "loading" });
    expect(reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: false })).toBe(state);

    state = reduceSpokenAlerts(state, { type: "playback_started", key, id: "n1" });
    expect(state.entries[key]?.playback).toEqual({ status: "playing" });

    const stopped = reduceSpokenAlerts(state, { type: "stopped", key });
    expect(stopped.entries[key]?.playback).toEqual({ status: "idle" });

    state = reduceSpokenAlerts(state, { type: "playback_finished", key, id: "n1" });
    expect(state.entries[key]?.playback).toEqual({ status: "played" });
  });

  it("drops playback results that belong to a superseded notification", () => {
    let state = received();
    state = reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: false });
    state = received(state, { ...alert, id: "n2" });
    const stale = reduceSpokenAlerts(state, { type: "playback_started", key, id: "n1" });
    expect(stale).toBe(state);
    const staleFailure = reduceSpokenAlerts(state, {
      type: "playback_failed",
      key,
      id: "n1",
      message: "boom",
    });
    expect(staleFailure).toBe(state);
  });

  it("records a failure the banner can show and lets the user retry", () => {
    let state = received();
    state = reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: false });
    state = reduceSpokenAlerts(state, {
      type: "playback_failed",
      key,
      id: "n1",
      message: "No audio",
    });
    expect(state.entries[key]?.playback).toEqual({ status: "failed", message: "No audio" });
    const retried = reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: false });
    expect(retried.entries[key]?.playback).toEqual({ status: "loading" });
  });

  it("removes the entry on dismiss", () => {
    const state = received();
    expect(reduceSpokenAlerts(state, { type: "dismissed", key })).toEqual(
      EMPTY_SPOKEN_ALERTS_STATE,
    );
    expect(reduceSpokenAlerts(EMPTY_SPOKEN_ALERTS_STATE, { type: "dismissed", key })).toBe(
      EMPTY_SPOKEN_ALERTS_STATE,
    );
  });
});

describe("shouldAutoPlaySpokenAlert", () => {
  const entry = received().entries[key]!;

  it("plays a fresh alert once while the app is foregrounded with the setting on", () => {
    expect(
      shouldAutoPlaySpokenAlert({ entry, autoPlayEnabled: true, appActivelyVisible: true }),
    ).toBe(true);
    expect(
      shouldAutoPlaySpokenAlert({ entry, autoPlayEnabled: false, appActivelyVisible: true }),
    ).toBe(false);
    expect(
      shouldAutoPlaySpokenAlert({ entry, autoPlayEnabled: true, appActivelyVisible: false }),
    ).toBe(false);
  });

  it("never auto-plays twice, even after the alert was stopped", () => {
    let state = received();
    state = reduceSpokenAlerts(state, { type: "play_requested", key, autoPlay: true });
    state = reduceSpokenAlerts(state, { type: "stopped", key });
    expect(
      shouldAutoPlaySpokenAlert({
        entry: state.entries[key]!,
        autoPlayEnabled: true,
        appActivelyVisible: true,
      }),
    ).toBe(false);
  });

  it("raises a notification only for an alert that asked for one", () => {
    expect(received().entries[key]!.notify).toBe(false);
    expect(received(EMPTY_SPOKEN_ALERTS_STATE, alert, true).entries[key]!.notify).toBe(true);
  });

  it("clears the notification without losing the alert", () => {
    const state = received(EMPTY_SPOKEN_ALERTS_STATE, alert, true);
    const dismissed = reduceSpokenAlerts(state, { type: "notification_dismissed", key });
    expect(dismissed.entries[key]!.notify).toBe(false);
    expect(dismissed.entries[key]!.alert).toEqual(alert);
    expect(reduceSpokenAlerts(dismissed, { type: "notification_dismissed", key })).toBe(dismissed);
  });

  it("lists the alerts owed a card oldest first", () => {
    let state = received(EMPTY_SPOKEN_ALERTS_STATE, { ...alert, receivedAt: 2000 }, true);
    state = received(state, { ...alert, agentId: "older", receivedAt: 1000 }, true);
    state = received(state, { ...alert, agentId: "quiet", receivedAt: 3000 }, false);
    expect(selectSpokenAlertNotificationKeys(state)).toEqual([
      alertKey("srv", "older"),
      alertKey("srv", "agent"),
    ]);
  });
});
