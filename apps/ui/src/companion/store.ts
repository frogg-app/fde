import type { CompanionNotebookEntry } from "@fde/protocol/messages";
import { create } from "zustand";

/**
 * What the mic orb shows. Derived from the session, not set directly, so the
 * orb can never disagree with the transport about what is happening.
 */
export type CompanionMicState = "idle" | "listening" | "thinking" | "speaking";

/**
 * The session lifecycle. `failed` carries the daemon's reason so the surface can
 * keep an actionable error in front of the user until they retry or dismiss it.
 */
export type CompanionSession =
  | { status: "closed" }
  | { status: "starting" }
  | { status: "open" }
  | { status: "stopping" }
  | { status: "failed"; reasonCode: string | null; retryable: boolean };

/** The typed-input fallback is a fallible action, so it owns all three states. */
export type CompanionSendState =
  | { status: "idle" }
  | { status: "pending"; text: string }
  | { status: "sent"; text: string }
  | { status: "failed"; text: string; reasonCode: string | null };

export interface CompanionState {
  isOpen: boolean;
  session: CompanionSession;
  isMuted: boolean;
  /** Smoothed capture level, 0–1, driving the orb's volume ring. */
  volume: number;
  /** True while the daemon hears the user speaking. */
  isUserSpeaking: boolean;
  /** True while a turn is in flight and the Companion has not started speaking. */
  isThinking: boolean;
  /** True while Companion audio is playing. */
  isSpeaking: boolean;
  partialTranscript: string;
  finalTranscript: string;
  reply: string;
  isReplyFinal: boolean;
  topics: CompanionNotebookEntry[];
  send: CompanionSendState;

  open: () => void;
  close: () => void;
  setOpen: (isOpen: boolean) => void;
  sessionStarting: () => void;
  sessionStarted: () => void;
  sessionFailed: (input: { reasonCode: string | null; retryable: boolean }) => void;
  sessionStopping: () => void;
  sessionStopped: () => void;
  dismissSessionError: () => void;
  setMuted: (isMuted: boolean) => void;
  setVolume: (volume: number) => void;
  userSpeakingChanged: (isSpeaking: boolean) => void;
  transcriptReceived: (input: { text: string; isFinal: boolean }) => void;
  replyReceived: (input: { text: string; isFinal: boolean }) => void;
  companionAudioStarted: () => void;
  companionAudioFinished: () => void;
  notebookReceived: (topics: readonly CompanionNotebookEntry[]) => void;
  sendPending: (text: string) => void;
  sendSucceeded: () => void;
  sendFailed: (reasonCode: string | null) => void;
  dismissSendError: () => void;
}

const CLOSED_SESSION: CompanionSession = { status: "closed" };
const IDLE_SEND: CompanionSendState = { status: "idle" };
const NO_TOPICS: CompanionNotebookEntry[] = [];

/** Everything the conversation accumulates; reset whenever a session ends. */
const CONVERSATION_RESET = {
  isMuted: false,
  volume: 0,
  isUserSpeaking: false,
  isThinking: false,
  isSpeaking: false,
  partialTranscript: "",
  finalTranscript: "",
  reply: "",
  isReplyFinal: false,
  send: IDLE_SEND,
} as const;

/**
 * The orb's one job is to say what the Companion is doing, so playback and
 * pending work outrank the mic. Muting reads as idle because a muted mic is not
 * listening, whatever the transport is doing underneath.
 */
export function deriveCompanionMicState(state: {
  session: CompanionSession;
  isMuted: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
}): CompanionMicState {
  if (state.session.status !== "open") return "idle";
  if (state.isSpeaking) return "speaking";
  if (state.isThinking) return "thinking";
  if (state.isMuted) return "idle";
  return "listening";
}

export const useCompanionStore = create<CompanionState>((set) => ({
  isOpen: false,
  session: CLOSED_SESSION,
  ...CONVERSATION_RESET,
  topics: NO_TOPICS,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setOpen: (isOpen) => set({ isOpen }),

  sessionStarting: () => set({ session: { status: "starting" } }),
  sessionStarted: () => set({ session: { status: "open" }, ...CONVERSATION_RESET }),
  sessionFailed: ({ reasonCode, retryable }) =>
    set({ session: { status: "failed", reasonCode, retryable }, ...CONVERSATION_RESET }),
  sessionStopping: () => set({ session: { status: "stopping" } }),
  sessionStopped: () => set({ session: CLOSED_SESSION, ...CONVERSATION_RESET }),
  dismissSessionError: () =>
    set((state) => (state.session.status === "failed" ? { session: CLOSED_SESSION } : {})),

  setMuted: (isMuted) => set((state) => ({ isMuted, volume: isMuted ? 0 : state.volume })),
  setVolume: (volume) => set((state) => ({ volume: state.isMuted ? 0 : volume })),

  // Barge-in: the user talking over the Companion ends its turn immediately, so
  // the stale reply and the audio-playing flag go with it.
  userSpeakingChanged: (isUserSpeaking) =>
    set((state) => {
      if (!isUserSpeaking) return { isUserSpeaking: false };
      return {
        isUserSpeaking: true,
        isSpeaking: false,
        isThinking: false,
        reply: state.isSpeaking || state.isThinking ? "" : state.reply,
        isReplyFinal: false,
      };
    }),

  transcriptReceived: ({ text, isFinal }) =>
    set(
      isFinal
        ? { partialTranscript: "", finalTranscript: text, isThinking: text.trim().length > 0 }
        : { partialTranscript: text },
    ),

  replyReceived: ({ text, isFinal }) =>
    set((state) => ({ reply: state.reply + text, isReplyFinal: isFinal })),

  companionAudioStarted: () => set({ isSpeaking: true, isThinking: false }),
  companionAudioFinished: () => set({ isSpeaking: false }),

  notebookReceived: (topics) => set({ topics: [...topics] }),

  sendPending: (text) => set({ send: { status: "pending", text } }),
  sendSucceeded: () =>
    set((state) => ({
      send:
        state.send.status === "pending"
          ? { status: "sent", text: state.send.text }
          : { status: "sent", text: "" },
      isThinking: true,
    })),
  sendFailed: (reasonCode) =>
    set((state) => ({
      send: {
        status: "failed",
        text: state.send.status === "pending" ? state.send.text : "",
        reasonCode,
      },
    })),
  dismissSendError: () => set({ send: IDLE_SEND }),
}));
