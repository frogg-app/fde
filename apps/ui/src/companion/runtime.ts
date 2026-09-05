import { Buffer } from "buffer";
import type { CompanionAudioOutputMessage, CompanionNotebookEntry } from "@fde/protocol/messages";
import type { AudioEngine, AudioPlaybackSource } from "@/voice/audio-engine-types";
import { decodeAudioChunk, toAudioPlaybackSource } from "@/voice/playback-source";
import { stepDisplayVolume } from "@/voice/volume-smoothing";

const PCM_MIME_TYPE = "audio/pcm;rate=16000;bits=16";

/**
 * The daemon side of one Companion session. A sibling of `VoiceSessionAdapter`
 * rather than a subtype: the Companion is bound to a host, never to an agent.
 */
export interface CompanionSessionAdapter {
  serverId: string;
  startSession(): Promise<CompanionSessionStartResult>;
  stopSession(): Promise<void>;
  sendAudioChunk(audio: string, format: string): Promise<void>;
  audioPlayed(id: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
}

export interface CompanionSessionStartResult {
  accepted: boolean;
  reasonCode: string | null;
  retryable: boolean;
}

/**
 * Everything the runtime pushes outward. The host store implements this, so the
 * runtime can be driven and asserted without React.
 */
export interface CompanionRuntimeSink {
  sessionStarted(): void;
  sessionFailed(input: { reasonCode: string | null; retryable: boolean }): void;
  sessionStopped(): void;
  setMuted(isMuted: boolean): void;
  setVolume(volume: number): void;
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

export interface CompanionRuntime {
  start(adapter: CompanionSessionAdapter): Promise<void>;
  stop(): Promise<void>;
  toggleMute(): void;
  sendMessage(text: string): Promise<void>;
  handleCapturePcm(chunk: Uint8Array): void;
  handleCaptureVolume(level: number): void;
  handleAudioOutput(payload: CompanionAudioOutputMessage["payload"]): void;
  handleInputState(isSpeaking: boolean): void;
  handleTranscript(input: { text: string; isFinal: boolean }): void;
  handleReply(input: { text: string; isFinal: boolean }): void;
  handleNotebook(entries: readonly CompanionNotebookEntry[]): void;
  isActive(): boolean;
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

  function resetPlayback(): void {
    groups.clear();
    groupOrder.length = 0;
    deps.engine.stop();
    deps.engine.clearQueue();
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

        await deps.engine.play(source);
        if (generation !== state.generation) return;
        await adapter.audioPlayed(chunkId);
      }
    } finally {
      draining = false;
      if (announcedStart && generation === state.generation) {
        deps.sink.companionAudioFinished();
      }
    }
  }

  const runtime: CompanionRuntime = {
    async start(adapter) {
      const generation = state.generation + 1;
      state.generation = generation;
      state.adapter = adapter;

      const result = await adapter.startSession();
      if (generation !== state.generation) return;
      if (!result.accepted) {
        state.adapter = null;
        deps.sink.sessionFailed({
          reasonCode: result.reasonCode,
          retryable: result.retryable,
        });
        return;
      }

      try {
        await deps.engine.initialize();
        await deps.engine.startCapture();
      } catch {
        state.adapter = null;
        await adapter.stopSession().catch(() => undefined);
        deps.sink.sessionFailed({
          reasonCode: "companion_microphone_unavailable",
          retryable: true,
        });
        return;
      }
      if (generation !== state.generation) return;

      state.isActive = true;
      state.isMuted = deps.engine.isMuted();
      state.volume = 0;
      state.lastVolumePublishMs = 0;
      deps.sink.sessionStarted();
      deps.sink.setMuted(state.isMuted);
    },

    async stop() {
      const adapter = state.adapter;
      state.generation += 1;
      state.isActive = false;
      state.adapter = null;
      resetPlayback();
      await deps.engine.stopCapture();
      if (adapter) {
        await adapter.stopSession();
      }
      deps.sink.sessionStopped();
    },

    toggleMute() {
      state.isMuted = deps.engine.toggleMute();
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
        await adapter.sendMessage(text);
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
      if (!state.isActive || !adapter) return;

      let group = groups.get(payload.groupId);
      if (!group) {
        group = { chunks: [], chunkIds: [], isComplete: false };
        groups.set(payload.groupId, group);
        groupOrder.push(payload.groupId);
      }
      group.chunks.push(toAudioPlaybackSource(decodeAudioChunk(payload.audio), payload.format));
      group.chunkIds.push(payload.id);
      group.isComplete = group.isComplete || payload.isLastChunk;

      void drain(state.generation, adapter);
    },

    // Barge-in is the primary interaction: the daemon telling us the user has
    // started speaking ends the Companion's turn here, before its own stream does.
    handleInputState(isSpeaking) {
      if (!state.isActive) return;
      if (isSpeaking) {
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
