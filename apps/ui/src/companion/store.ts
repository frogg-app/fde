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
  | { status: "reconnecting" }
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
  context: { serverId: string; workspaceId?: string; agentId?: string } | null;
  launch: (context: { serverId: string; workspaceId?: string; agentId?: string }) => void;
  isOpen: boolean;
  serverId: string | null;
  isMinimized: boolean;
  minimize: () => void;
  session: CompanionSession;
  isMuted: boolean;
  /** Smoothed capture level, 0–1, driving the orb's volume ring while listening. */
  volume: number;
  /** Loudness of the Companion's own voice, 0–1, driving the ring while it speaks. */
  speakingVolume: number;
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
  sessionStarting: (serverId?: string) => void;
  sessionStarted: () => void;
  sessionReconnecting: () => void;
  sessionFailed: (input: { reasonCode: string | null; retryable: boolean }) => void;
  sessionStopping: () => void;
  sessionStopped: () => void;
  dismissSessionError: () => void;
  setMuted: (isMuted: boolean) => void;
  setVolume: (volume: number) => void;
  setSpeakingVolume: (volume: number) => void;
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
  context: null,
  serverId: null,
  isMuted: false,
  volume: 0,
  speakingVolume: 0,
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
  if (state.session.status !== "open" || state.isMuted) return "idle";
  if (state.isSpeaking) return "speaking";
  if (state.isThinking) return "thinking";
  return "listening";
}

export const useCompanionStore = create<CompanionState>((set) => ({
  isOpen: false,
  isMinimized: false,
  minimize: () => set({ isOpen: false, isMinimized: true }),
  session: CLOSED_SESSION,
  ...CONVERSATION_RESET,
  topics: NO_TOPICS,

  open: () => set({ isOpen: true, isMinimized: false }),
  close: () =>
    set((state) => ({
      isOpen: false,
      isMinimized: ["open", "starting", "reconnecting"].includes(state.session.status),
    })),
  setOpen: (isOpen) =>
    set((state) => ({
      isOpen,
      isMinimized: !isOpen && ["open", "starting", "reconnecting"].includes(state.session.status),
    })),
  launch: (context) =>
    set((state) => ({
      isOpen: true,
      isMinimized: false,
      ...(["open", "starting", "reconnecting"].includes(state.session.status)
        ? {}
        : { context, serverId: context.serverId }),
    })),

  sessionStarting: (serverId) =>
    set({ serverId: serverId ?? null, session: { status: "starting" } }),
  sessionReconnecting: () =>
    set({
      session: { status: "reconnecting" },
      isSpeaking: false,
      isThinking: false,
      speakingVolume: 0,
    }),
  sessionStarted: () =>
    set((state) => ({
      ...CONVERSATION_RESET,
      serverId: state.serverId,
      context: state.context,
      session: { status: "open" },
    })),
  sessionFailed: ({ reasonCode, retryable }) =>
    set({ session: { status: "failed", reasonCode, retryable }, ...CONVERSATION_RESET }),
  sessionStopping: () => set({ session: { status: "stopping" } }),
  sessionStopped: () => set({ isMinimized: false, session: CLOSED_SESSION, ...CONVERSATION_RESET }),
  dismissSessionError: () =>
    set((state) => (state.session.status === "failed" ? { session: CLOSED_SESSION } : {})),

  setMuted: (isMuted) => set((state) => ({ isMuted, volume: isMuted ? 0 : state.volume })),
  setSpeakingVolume: (speakingVolume) => set({ speakingVolume }),
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

  replyReceived: ({ text, isFinal }) => set({ reply: text, isReplyFinal: isFinal }),

  companionAudioStarted: () => set({ isSpeaking: true, isThinking: false }),
  companionAudioFinished: () => set({ isSpeaking: false, speakingVolume: 0 }),

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
