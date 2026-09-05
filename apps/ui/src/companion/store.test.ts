import type { CompanionNotebookEntry } from "@fde/protocol/messages";
import { beforeEach, describe, expect, it } from "vitest";
import { deriveCompanionMicState, useCompanionStore } from "./store";

function store() {
  return useCompanionStore.getState();
}

function micState() {
  const state = store();
  return deriveCompanionMicState(state);
}

function openSession() {
  store().open();
  store().sessionStarting();
  store().sessionStarted();
}

const topic: CompanionNotebookEntry = {
  id: "topic-1",
  kind: "topic",
  text: "Ship the installer",
  status: "active",
  agentId: "agent-1",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

beforeEach(() => {
  store().sessionStopped();
  store().close();
  store().notebookReceived([]);
});

describe("companion mic state", () => {
  it("is idle until a session is open", () => {
    expect(micState()).toBe("idle");

    store().sessionStarting();
    expect(micState()).toBe("idle");
  });

  it("listens once the session opens", () => {
    openSession();
    expect(micState()).toBe("listening");
  });

  it("thinks while a final transcript is being answered", () => {
    openSession();
    store().transcriptReceived({ text: "what is the installer doing", isFinal: true });

    expect(micState()).toBe("thinking");
    expect(store().partialTranscript).toBe("");
    expect(store().finalTranscript).toBe("what is the installer doing");
  });

  it("keeps listening when the final transcript is empty", () => {
    openSession();
    store().transcriptReceived({ text: "   ", isFinal: true });

    expect(micState()).toBe("listening");
  });

  it("speaks while Companion audio plays, and outranks thinking", () => {
    openSession();
    store().transcriptReceived({ text: "status please", isFinal: true });
    store().companionAudioStarted();

    expect(micState()).toBe("speaking");

    store().companionAudioFinished();
    expect(micState()).toBe("listening");
  });

  it("reads as idle while muted", () => {
    openSession();
    store().setMuted(true);

    expect(micState()).toBe("idle");
    expect(store().volume).toBe(0);
  });

  it("holds the volume ring at zero while muted", () => {
    openSession();
    store().setMuted(true);
    store().setVolume(0.8);

    expect(store().volume).toBe(0);

    store().setMuted(false);
    store().setVolume(0.8);
    expect(store().volume).toBe(0.8);
  });
});

describe("companion transcript and reply", () => {
  it("replaces the partial transcript with the final one", () => {
    openSession();
    store().transcriptReceived({ text: "how is", isFinal: false });
    store().transcriptReceived({ text: "how is the", isFinal: false });

    expect(store().partialTranscript).toBe("how is the");
    expect(store().finalTranscript).toBe("");

    store().transcriptReceived({ text: "how is the build", isFinal: true });

    expect(store().partialTranscript).toBe("");
    expect(store().finalTranscript).toBe("how is the build");
  });

  it("shows the latest reply snapshot rather than concatenating them", () => {
    openSession();
    store().replyReceived({ text: "Two agents ", isFinal: false });
    store().replyReceived({ text: "Two agents are running.", isFinal: true });

    expect(store().reply).toBe("Two agents are running.");
    expect(store().isReplyFinal).toBe(true);
  });

  it("replaces a spoken filler with the reply that follows it", () => {
    openSession();
    store().replyReceived({ text: "One sec.", isFinal: true });
    store().replyReceived({ text: "Two agents are running.", isFinal: true });

    expect(store().reply).toBe("Two agents are running.");
  });
});

describe("companion barge-in", () => {
  it("stops the reply the moment the user talks over it", () => {
    openSession();
    store().replyReceived({ text: "Let me look into that", isFinal: false });
    store().companionAudioStarted();

    store().userSpeakingChanged(true);

    expect(store().isSpeaking).toBe(false);
    expect(store().isThinking).toBe(false);
    expect(store().reply).toBe("");
    expect(micState()).toBe("listening");
  });

  it("leaves a settled reply on screen when the user speaks again", () => {
    openSession();
    store().replyReceived({ text: "Two agents are running.", isFinal: true });
    store().companionAudioStarted();
    store().companionAudioFinished();

    store().userSpeakingChanged(true);

    expect(store().reply).toBe("Two agents are running.");
  });
});

describe("companion session failure", () => {
  it("keeps an actionable failure until the user dismisses it", () => {
    store().open();
    store().sessionStarting();
    store().sessionFailed({ reasonCode: "companion_backend_missing", retryable: false });

    expect(store().session).toEqual({
      status: "failed",
      reasonCode: "companion_backend_missing",
      retryable: false,
    });
    expect(micState()).toBe("idle");

    store().dismissSessionError();
    expect(store().session).toEqual({ status: "closed" });
  });

  it("ignores a dismissal when nothing has failed", () => {
    openSession();
    store().dismissSessionError();

    expect(store().session).toEqual({ status: "open" });
  });
});

describe("companion typed fallback", () => {
  it("moves through pending and into thinking on success", () => {
    openSession();
    store().sendPending("restart the installer agent");

    expect(store().send).toEqual({ status: "pending", text: "restart the installer agent" });

    store().sendSucceeded();

    expect(store().send).toEqual({ status: "sent", text: "restart the installer agent" });
    expect(micState()).toBe("thinking");
  });

  it("keeps the failed text so the user can retry it", () => {
    openSession();
    store().sendPending("restart the installer agent");
    store().sendFailed("companion_session_closed");

    expect(store().send).toEqual({
      status: "failed",
      text: "restart the installer agent",
      reasonCode: "companion_session_closed",
    });

    store().dismissSendError();
    expect(store().send).toEqual({ status: "idle" });
  });
});

describe("companion notebook", () => {
  it("replaces the topics strip with each snapshot", () => {
    openSession();
    store().notebookReceived([topic]);

    expect(store().topics).toEqual([topic]);

    store().notebookReceived([]);
    expect(store().topics).toEqual([]);
  });

  it("clears the conversation but keeps the notebook when a session ends", () => {
    openSession();
    store().notebookReceived([topic]);
    store().replyReceived({ text: "on it", isFinal: true });

    store().sessionStopped();

    expect(store().reply).toBe("");
    expect(store().topics).toEqual([topic]);
  });
});
