import { createCompanionNativeAudio, type CompanionNativeAudio } from "./native-audio";
import { Buffer } from "buffer";
import type {
  CompanionAudioOutputMessage,
  CompanionNotebookEntry,
  CompanionConversationOptions,
} from "@fde/protocol/messages";
import type { AudioEngine, AudioPlaybackSource } from "@/voice/audio-engine-types";
import { decodeAudioChunk, toAudioPlaybackSource } from "@/voice/playback-source";
import { pcm16Rms } from "@/voice/speaking-level";
import { stepDisplayVolume } from "@/voice/volume-smoothing";

const PCM_MIME_TYPE = "audio/pcm;rate=16000;bits=16";

/**
 * The daemon side of one Companion session. A sibling of `VoiceSessionAdapter`
 * rather than a subtype: the Companion is bound to a host, never to an agent.
 */
export interface CompanionSessionAdapter {
  serverId: string;
  startSession(
    voiceTransport?: {
      kind: "codex-webrtc";
      sdp: string;
    },
    conversation?: CompanionConversationOptions,
  ): Promise<CompanionSessionStartResult>;
  stopSession(): Promise<void>;
  sendAudioChunk(audio: string, format: string): Promise<void>;
  audioPlayed(id: string): Promise<void>;
  sendMessage(text: string, requestId?: string): Promise<void>;
}

export interface CompanionSessionStartResult {
  accepted: boolean;
  reasonCode: string | null;
  retryable: boolean;
  sessionId?: string;
  sdp?: string;
}

/**
 * Everything the runtime pushes outward. The host store implements this, so the
 * runtime can be driven and asserted without React.
 */
export interface CompanionRuntimeSink {
  sessionReconnecting(): void;
  sessionStarted(): void;
  sessionFailed(input: { reasonCode: string | null; retryable: boolean }): void;
  sessionStopped(): void;
  setMuted(isMuted: boolean): void;
  setVolume(volume: number): void;
  setSpeakingVolume(volume: number): void;
  userSpeakingChanged(isSpeaking: boolean): void;
  transcriptReceived(input: { text: string; isFinal: boolean }): void;
  replyReceived(input: { text: string; isFinal: boolean }): void;
  companionAudioStarted(): void;
  companionAudioFinished(): void;
  notebookReceived(topics: readonly CompanionNotebookEntry[]): void;
  sendPending(text: string): void;
  sendSucceeded(): void;
  sendFailed(reasonCode: string | null): void;
}

export interface CompanionRuntimeDeps {
  engine: AudioEngine;
  sink: CompanionRuntimeSink;
  now?: () => number;
}

interface PlaybackGroup {
  chunks: AudioPlaybackSource[];
  chunkIds: string[];
  /** Per-chunk loudness, so the orb can move to the Companion's own voice. */
  levels: number[];
  isComplete: boolean;
}

interface RuntimeState {
  adapter: CompanionSessionAdapter | null;
  isActive: boolean;
  isMuted: boolean;
  /** Bumped on every start and stop so late audio from a dead session is dropped. */
  generation: number;
  lastVolumePublishMs: number;
  volume: number;
}

export interface CompanionConnectionState {
  serverId: string;
  isConnected: boolean;
}

export interface CompanionRuntime {
  start(
    adapter: CompanionSessionAdapter,
    nativeVoice?: boolean,
    conversation?: CompanionConversationOptions,
  ): Promise<void>;
  connectionChanged(connection: CompanionConnectionState): Promise<void>;
  stop(): Promise<void>;
  toggleMute(): void;
  sendMessage(text: string): Promise<void>;
  handleCapturePcm(chunk: Uint8Array): void;
  handleCaptureVolume(level: number): void;
  handleAudioOutput(payload: CompanionAudioOutputMessage["payload"]): void;
  handleInputState(isSpeaking: boolean, nextTurnId?: number): void;
  handleTranscript(input: { text: string; isFinal: boolean }): void;
  handleReply(input: { text: string; isFinal: boolean }): void;
  handleNotebook(entries: readonly CompanionNotebookEntry[]): void;
  isActive(): boolean;
  belongsTo(serverId: string, receivedSessionId?: string): boolean;
}

/**
 * A sibling of `voice-runtime.ts`, not a fork of it. The Companion shares the
 * capture, decode and volume-envelope plumbing but has its own turn shape: no
 * agent binding, no thinking cue, and a wire format whose audio frames carry no
 * chunk index, so playback is an arrival-ordered queue per group rather than the
 * voice runtime's indexed reassembly.
 */
export function createCompanionRuntime(deps: CompanionRuntimeDeps): CompanionRuntime {
  const now = deps.now ?? (() => Date.now());
  const state: RuntimeState = {
    adapter: null,
    isActive: false,
    isMuted: false,
    generation: 0,
    lastVolumePublishMs: 0,
    volume: 0,
  };
  const groups = new Map<string, PlaybackGroup>();
  const groupOrder: string[] = [];
  let draining = false;
  let requestSequence = 0;
  let pendingMessage: { text: string; id: string } | null = null;
  let sessionId: string | undefined;
  let nativeAudio: CompanionNativeAudio | null = null;
  let usingNativeVoice = false;
  let conversationOptions: CompanionConversationOptions | undefined;
  let reconnect: { nativeVoice: boolean; muted: boolean } | null = null;
  let turnId = 0;
  let userSpeaking = false;
  let nativeSpeaking = false;
  let starting: Promise<void> | null = null;

  function resetPlayback(): void {
    groups.clear();
    groupOrder.length = 0;
    deps.engine.stop();
    deps.engine.clearQueue();
    deps.sink.setSpeakingVolume(0);
  }

  async function drain(generation: number, adapter: CompanionSessionAdapter): Promise<void> {
    if (draining) return;
    draining = true;
    let announcedStart = false;
    try {
      while (groupOrder.length > 0 && generation === state.generation) {
        const groupId = groupOrder[0];
        const group = groups.get(groupId);
        if (!group) {
          groupOrder.shift();
          continue;
        }

        const source = group.chunks.shift();
        const chunkId = group.chunkIds.shift();
        const level = group.levels.shift() ?? 0;
        if (!source || !chunkId) {
          if (!group.isComplete) return;
          groups.delete(groupId);
          groupOrder.shift();
          continue;
        }

        if (!announcedStart) {
          announcedStart = true;
          deps.sink.companionAudioStarted();
        }

        deps.sink.setSpeakingVolume(level);
        await deps.engine.play(source);
        if (generation !== state.generation) return;
        await adapter.audioPlayed(chunkId);
      }
    } finally {
      draining = false;
      if (generation !== state.generation && state.isActive && state.adapter && groupOrder.length) {
        drainPlayback(state.generation, state.adapter);
      }
      if (announcedStart && generation === state.generation) {
        deps.sink.setSpeakingVolume(0);
        deps.sink.companionAudioFinished();
      }
    }
  }

  function drainPlayback(generation: number, adapter: CompanionSessionAdapter): void {
    void drain(generation, adapter).catch(() => {
      if (generation !== state.generation) return;
      resetPlayback();
      deps.sink.companionAudioFinished();
    });
  }

  const runtime: CompanionRuntime = {
    async start(adapter, nativeVoice = false, conversation) {
      if (starting) {
        const requestedGeneration = state.generation;
        await starting;
        if (requestedGeneration === state.generation)
          await runtime.start(adapter, nativeVoice, conversation);
        return;
      }
      if (state.isActive) return;
      usingNativeVoice = nativeVoice;
      conversationOptions = conversation;
      const generation = ++state.generation;
      state.adapter = adapter;
      starting = (async () => {
        let reasonCode = "companion_connection_failed";
        try {
          if (nativeVoice) reasonCode = "companion_native_unavailable";
          if (nativeVoice)
            nativeAudio = createCompanionNativeAudio(
              () => {
                void runtime.stop();
              },
              (level) => {
                if (!state.isActive) return;
                deps.sink.setSpeakingVolume(level);
                const speaking = level > 0.01;
                if (speaking !== nativeSpeaking) {
                  nativeSpeaking = speaking;
                  if (speaking) deps.sink.companionAudioStarted();
                  else deps.sink.companionAudioFinished();
                }
              },
            );
          const offer = nativeAudio ? await nativeAudio.prepare() : undefined;
          if (generation !== state.generation) return;
          const result = await adapter.startSession(
            offer ? { kind: "codex-webrtc", sdp: offer } : undefined,
            conversation,
          );
          if (generation !== state.generation) {
            await adapter.stopSession().catch(() => undefined);
            return;
          }
          if (!result.accepted) {
            nativeAudio?.close();
            nativeAudio = null;
            await deps.engine.stopCapture().catch(() => undefined);
            state.adapter = null;
            deps.sink.sessionFailed(result);
            return;
          }
          sessionId = result.sessionId;
          turnId = 0;
          userSpeaking = false;
          nativeSpeaking = false;
          if (nativeAudio) {
            if (!result.sdp) throw new Error("The daemon does not support native voice");
            await nativeAudio.connect(result.sdp);
          } else {
            reasonCode = "companion_microphone_unavailable";
            await deps.engine.initialize();
            if (generation !== state.generation) return;
            await deps.engine.startCapture();
            if (generation !== state.generation) {
              await deps.engine.stopCapture().catch(() => undefined);
              return;
            }
          }
          if (generation !== state.generation) return;
          state.isActive = true;
          state.isMuted = nativeVoice ? false : deps.engine.isMuted();
          state.volume = 0;
          state.lastVolumePublishMs = 0;
          deps.sink.sessionStarted();
          deps.sink.setMuted(state.isMuted);
        } catch {
          if (generation !== state.generation) return;
          nativeAudio?.close();
          nativeAudio = null;
          await deps.engine.stopCapture().catch(() => undefined);
          await adapter.stopSession().catch(() => undefined);
          if (generation === state.generation) {
            state.adapter = null;
            deps.sink.sessionFailed({ reasonCode, retryable: true });
          }
        }
      })();
      try {
        await starting;
      } finally {
        starting = null;
      }
    },

    async stop() {
      reconnect = null;
      const adapter = state.adapter;
      if (!adapter && !state.isActive && !starting) return;
      state.generation += 1;
      state.isActive = false;
      state.adapter = null;
      sessionId = undefined;
      nativeAudio?.close();
      nativeAudio = null;
      resetPlayback();
      // Local capture release never depends on a successful remote acknowledgement.
      await deps.engine.stopCapture().catch(() => undefined);
      deps.sink.sessionStopped();
      if (adapter) await adapter.stopSession().catch(() => undefined);
    },

    async connectionChanged({ serverId, isConnected }) {
      const adapter = state.adapter;
      if (!adapter || adapter.serverId !== serverId) return;
      if (!isConnected) {
        if (reconnect || (!state.isActive && !starting)) return;
        reconnect = { nativeVoice: usingNativeVoice, muted: state.isMuted };
        state.generation += 1;
        state.isActive = false;
        sessionId = undefined;
        nativeAudio?.close();
        nativeAudio = null;
        resetPlayback();
        // Retain local capture's foreground audio session across network changes.
        // Frames are discarded until the new daemon session is ready.
        deps.sink.sessionReconnecting();
        return;
      }
      if (!reconnect) return;
      const intent = reconnect;
      reconnect = null;
      const expectedGeneration = state.generation + 1;
      await runtime.start(adapter, intent.nativeVoice, conversationOptions);
      if (state.generation !== expectedGeneration || !state.isActive) return;
      if (state.isMuted !== intent.muted) runtime.toggleMute();
    },

    toggleMute() {
      if (nativeAudio) {
        state.isMuted = !state.isMuted;
        nativeAudio.mute(state.isMuted);
      } else state.isMuted = deps.engine.toggleMute();
      deps.sink.setMuted(state.isMuted);
    },

    async sendMessage(text) {
      const adapter = state.adapter;
      deps.sink.sendPending(text);
      if (!adapter) {
        deps.sink.sendFailed("companion_session_closed");
        return;
      }
      try {
        pendingMessage =
          pendingMessage?.text === text
            ? pendingMessage
            : { text, id: `companion-${Date.now()}-${++requestSequence}` };
        await adapter.sendMessage(text, pendingMessage.id);
        pendingMessage = null;
        deps.sink.sendSucceeded();
      } catch (error) {
        deps.sink.sendFailed(reasonCodeOf(error));
      }
    },

    handleCapturePcm(chunk) {
      const adapter = state.adapter;
      if (!adapter || !state.isActive || state.isMuted || chunk.byteLength === 0) {
        return;
      }
      const audio = Buffer.from(chunk).toString("base64");
      void adapter.sendAudioChunk(audio, PCM_MIME_TYPE).catch(() => {
        // A dropped capture frame is not an operation the user started; the
        // session's own failure path reports a transport that has actually gone.
      });
    },

    handleCaptureVolume(level) {
      if (!state.isActive) return;
      const nowMs = now();
      const step = stepDisplayVolume({
        level: state.isMuted ? 0 : level,
        previousVolume: state.volume,
        msSinceLastPublish: nowMs - state.lastVolumePublishMs,
      });
      if (!step.shouldPublish) return;
      state.lastVolumePublishMs = nowMs;
      state.volume = step.volume;
      deps.sink.setVolume(step.volume);
    },

    handleAudioOutput(payload) {
      const adapter = state.adapter;
      if (!state.isActive || !adapter || userSpeaking) return;
      if (sessionId && payload.sessionId !== sessionId) return;
      if (payload.turnId !== undefined && payload.turnId < turnId) return;
      turnId = payload.turnId ?? turnId;

      let group = groups.get(payload.groupId);
      if (!group) {
        group = { chunks: [], chunkIds: [], levels: [], isComplete: false };
        groups.set(payload.groupId, group);
        groupOrder.push(payload.groupId);
      }
      const bytes = decodeAudioChunk(payload.audio);
      group.chunks.push(toAudioPlaybackSource(bytes, payload.format));
      group.chunkIds.push(payload.id);
      group.levels.push(pcm16Rms(bytes));
      group.isComplete = group.isComplete || payload.isLastChunk;

      drainPlayback(state.generation, adapter);
    },

    // Barge-in is the primary interaction: the daemon telling us the user has
    // started speaking ends the Companion's turn here, before its own stream does.
    handleInputState(isSpeaking, nextTurnId) {
      userSpeaking = isSpeaking;
      const invalidatesPlayback = nextTurnId !== undefined && nextTurnId > turnId;
      if (nextTurnId !== undefined) turnId = Math.max(turnId, nextTurnId);
      if (!state.isActive) return;
      if (isSpeaking || invalidatesPlayback) {
        state.generation += 1;
        resetPlayback();
      }
      deps.sink.userSpeakingChanged(isSpeaking);
    },

    handleTranscript(input) {
      if (!state.isActive) return;
      deps.sink.transcriptReceived(input);
    },

    handleReply(input) {
      if (!state.isActive) return;
      deps.sink.replyReceived(input);
    },

    handleNotebook(entries) {
      deps.sink.notebookReceived(entries);
    },

    belongsTo(serverId, receivedSessionId) {
      return (
        state.adapter?.serverId === serverId &&
        (receivedSessionId === undefined || receivedSessionId === sessionId)
      );
    },

    isActive() {
      return state.isActive;
    },
  };

  return runtime;
}

/**
 * Refusals carry the daemon's machine reason so the surface can name what went
 * wrong. Anything else is a transport failure with no reason to show.
 */
export class CompanionMessageRejected extends Error {
  readonly reasonCode: string | null;

  constructor(reasonCode: string | null) {
    super(`Companion rejected the message${reasonCode ? ` (${reasonCode})` : ""}`);
    this.name = "CompanionMessageRejected";
    this.reasonCode = reasonCode;
  }
}

function reasonCodeOf(error: unknown): string | null {
  return error instanceof CompanionMessageRejected ? error.reasonCode : null;
}
