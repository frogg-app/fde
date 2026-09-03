import { resolveVoicePermissionIntent } from "./permission-intent";

export const VOICE_REPLY_CONFIRM_MS = 2000;

export interface PendingPermissionTarget {
  requestId: string;
}

/** What the transcript will do once confirmed. */
export type VoiceReplyAction =
  | { kind: "message"; text: string }
  | { kind: "permission"; requestId: string; behavior: "allow" | "deny" }
  /** A permission is pending but the words were not a clear yes or no. */
  | { kind: "permission_ambiguous"; requestId: string; text: string };

export type VoiceReplyPhase =
  | { status: "listening" }
  | { status: "transcribing" }
  | { status: "confirming"; text: string; action: VoiceReplyAction; autoSendAt: number | null }
  | { status: "sending"; action: VoiceReplyAction }
  | { status: "sent" }
  | { status: "failed"; message: string; text: string };

export type VoiceReplyEvent =
  | { type: "transcribing" }
  | { type: "transcript"; text: string; now: number }
  | { type: "edited"; text: string }
  | { type: "send" }
  | { type: "choose"; action: VoiceReplyAction }
  | { type: "sent" }
  | { type: "failed"; message: string }
  | { type: "retry" };

export interface VoiceReplyContext {
  pendingPermission: PendingPermissionTarget | null;
  /** When false the transcript is sent as soon as it is final. */
  confirmBeforeSend: boolean;
}

type ConfirmingPhase = Extract<VoiceReplyPhase, { status: "confirming" }>;

export function resolveVoiceReplyAction(
  text: string,
  pendingPermission: PendingPermissionTarget | null,
): VoiceReplyAction {
  if (!pendingPermission) return { kind: "message", text };
  const intent = resolveVoicePermissionIntent(text);
  if (intent.kind === "ambiguous") {
    return { kind: "permission_ambiguous", requestId: pendingPermission.requestId, text };
  }
  return { kind: "permission", requestId: pendingPermission.requestId, behavior: intent.kind };
}

function isSendable(action: VoiceReplyAction): boolean {
  return action.kind !== "permission_ambiguous";
}

function onTranscript(
  phase: VoiceReplyPhase,
  event: Extract<VoiceReplyEvent, { type: "transcript" }>,
  context: VoiceReplyContext,
): VoiceReplyPhase {
  if (phase.status !== "listening" && phase.status !== "transcribing") return phase;
  const text = event.text.trim();
  if (text.length === 0) return { status: "listening" };
  const action = resolveVoiceReplyAction(text, context.pendingPermission);
  const sendable = isSendable(action);
  if (!context.confirmBeforeSend && sendable) {
    return { status: "sending", action };
  }
  const autoSendAt = sendable ? event.now + VOICE_REPLY_CONFIRM_MS : null;
  return { status: "confirming", text, action, autoSendAt };
}

// Touching the transcript cancels the countdown: the user is now in charge of sending.
function onEdited(
  phase: VoiceReplyPhase,
  text: string,
  context: VoiceReplyContext,
): VoiceReplyPhase {
  if (phase.status !== "confirming") return phase;
  const trimmed = text.trim();
  const action: VoiceReplyAction =
    trimmed.length === 0
      ? { kind: "message", text: "" }
      : resolveVoiceReplyAction(trimmed, context.pendingPermission);
  return { status: "confirming", text, action, autoSendAt: null };
}

function onSend(phase: VoiceReplyPhase): VoiceReplyPhase {
  if (phase.status !== "confirming") return phase;
  const confirming: ConfirmingPhase = phase;
  if (!isSendable(confirming.action) || confirming.text.trim().length === 0) return phase;
  return { status: "sending", action: confirming.action };
}

function onFailed(phase: VoiceReplyPhase, message: string): VoiceReplyPhase {
  if (phase.status !== "sending") return phase;
  const text = phase.action.kind === "permission" ? "" : phase.action.text;
  return { status: "failed", message, text };
}

export function reduceVoiceReply(
  phase: VoiceReplyPhase,
  event: VoiceReplyEvent,
  context: VoiceReplyContext,
): VoiceReplyPhase {
  switch (event.type) {
    case "transcribing":
      return phase.status === "listening" ? { status: "transcribing" } : phase;
    case "transcript":
      return onTranscript(phase, event, context);
    case "edited":
      return onEdited(phase, event.text, context);
    case "send":
      return onSend(phase);
    case "choose":
      return phase.status === "confirming" ? { status: "sending", action: event.action } : phase;
    case "sent":
      return phase.status === "sending" ? { status: "sent" } : phase;
    case "failed":
      return onFailed(phase, event.message);
    case "retry":
      return phase.status === "failed" ? { status: "listening" } : phase;
  }
}
