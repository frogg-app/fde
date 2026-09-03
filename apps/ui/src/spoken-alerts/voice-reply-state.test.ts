import { describe, expect, it } from "vitest";
import {
  VOICE_REPLY_CONFIRM_MS,
  reduceVoiceReply,
  type VoiceReplyContext,
  type VoiceReplyPhase,
} from "./voice-reply-state";

const listening: VoiceReplyPhase = { status: "listening" };
const noPermission: VoiceReplyContext = { pendingPermission: null, confirmBeforeSend: true };
const withPermission: VoiceReplyContext = {
  pendingPermission: { requestId: "perm-1" },
  confirmBeforeSend: true,
};

describe("reduceVoiceReply", () => {
  it("opens a confirm window that auto-sends a plain message after two seconds", () => {
    const phase = reduceVoiceReply(
      listening,
      { type: "transcript", text: " Ship it. ", now: 1000 },
      noPermission,
    );
    expect(phase).toEqual({
      status: "confirming",
      text: "Ship it.",
      action: { kind: "message", text: "Ship it." },
      autoSendAt: 1000 + VOICE_REPLY_CONFIRM_MS,
    });
    expect(reduceVoiceReply(phase, { type: "send" }, noPermission)).toEqual({
      status: "sending",
      action: { kind: "message", text: "Ship it." },
    });
  });

  it("sends immediately when confirmation is off", () => {
    const phase = reduceVoiceReply(
      listening,
      { type: "transcript", text: "Run the tests", now: 0 },
      { pendingPermission: null, confirmBeforeSend: false },
    );
    expect(phase).toEqual({
      status: "sending",
      action: { kind: "message", text: "Run the tests" },
    });
  });

  it("maps a clear yes or no to the pending permission decision", () => {
    const yes = reduceVoiceReply(
      listening,
      { type: "transcript", text: "Yes, go ahead", now: 0 },
      withPermission,
    );
    expect(yes).toMatchObject({
      status: "confirming",
      action: { kind: "permission", requestId: "perm-1", behavior: "allow" },
      autoSendAt: VOICE_REPLY_CONFIRM_MS,
    });
    const no = reduceVoiceReply(
      listening,
      { type: "transcript", text: "No.", now: 0 },
      {
        ...withPermission,
        confirmBeforeSend: false,
      },
    );
    expect(no).toEqual({
      status: "sending",
      action: { kind: "permission", requestId: "perm-1", behavior: "deny" },
    });
  });

  it("never auto-sends an ambiguous permission answer and waits for an explicit choice", () => {
    const phase = reduceVoiceReply(
      listening,
      { type: "transcript", text: "Use the other branch instead", now: 0 },
      { ...withPermission, confirmBeforeSend: false },
    );
    expect(phase).toEqual({
      status: "confirming",
      text: "Use the other branch instead",
      action: {
        kind: "permission_ambiguous",
        requestId: "perm-1",
        text: "Use the other branch instead",
      },
      autoSendAt: null,
    });
    expect(reduceVoiceReply(phase, { type: "send" }, withPermission)).toBe(phase);
    expect(
      reduceVoiceReply(
        phase,
        { type: "choose", action: { kind: "message", text: "Use the other branch instead" } },
        withPermission,
      ),
    ).toEqual({
      status: "sending",
      action: { kind: "message", text: "Use the other branch instead" },
    });
  });

  it("stops the countdown as soon as the transcript is edited", () => {
    const confirming = reduceVoiceReply(
      listening,
      { type: "transcript", text: "Ship it", now: 0 },
      noPermission,
    );
    const edited = reduceVoiceReply(
      confirming,
      { type: "edited", text: "Ship it now" },
      noPermission,
    );
    expect(edited).toEqual({
      status: "confirming",
      text: "Ship it now",
      action: { kind: "message", text: "Ship it now" },
      autoSendAt: null,
    });
    const blank = reduceVoiceReply(edited, { type: "edited", text: "  " }, noPermission);
    expect(reduceVoiceReply(blank, { type: "send" }, noPermission)).toBe(blank);
  });

  it("keeps the words after a send failure and lets the user retry from listening", () => {
    const sending: VoiceReplyPhase = { status: "sending", action: { kind: "message", text: "Hi" } };
    const failed = reduceVoiceReply(sending, { type: "failed", message: "offline" }, noPermission);
    expect(failed).toEqual({ status: "failed", message: "offline", text: "Hi" });
    expect(reduceVoiceReply(failed, { type: "retry" }, noPermission)).toEqual(listening);
    expect(reduceVoiceReply(sending, { type: "sent" }, noPermission)).toEqual({ status: "sent" });
  });

  it("ignores an empty transcript and goes back to listening", () => {
    expect(
      reduceVoiceReply(
        { status: "transcribing" },
        { type: "transcript", text: "   ", now: 0 },
        noPermission,
      ),
    ).toEqual(listening);
  });
});
