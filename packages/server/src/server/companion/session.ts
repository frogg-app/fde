import { toSpokenText } from "./spoken-text.js";
import { createCompanionNativeVoice, type CompanionNativeVoice } from "./native-voice.js";
import { randomUUID } from "node:crypto";
import { CompanionConversationOptionsSchema } from "@frogg/protocol/messages";
import { companionConversationInstructions } from "./conversation-options.js";
import type { Logger } from "pino";
import type {
  CompanionNotebook as CompanionNotebookPayload,
  ServerCapabilityState,
} from "@frogg/protocol/messages";

import { TTSManager } from "../agent/tts-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { toResolver, type Resolvable } from "../speech/provider-resolver.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../speech/turn-detection-provider.js";
import {
  createVoiceTurnController,
  type VoiceTurnController,
} from "../session/voice/voice-turn-controller.js";
import type { CompanionBackend } from "./backend.js";
import {
  COMPANION_BACKEND_MISSING_REASON_CODE,
  type CompanionApiModelConfig,
  type CompanionCliModelConfig,
  type CompanionCodexModelConfig,
  type CompanionModelConfig,
} from "./model-config.js";
import {
  CompanionDeferredJobs,
  describeSettledJob,
  type CompanionDeferredJob,
  type CompanionDeferredJobRunner,
} from "./deferred-jobs.js";
import {
  COMPANION_STALL_DELAY_MS,
  createCompanionStallGuard,
  systemScheduler,
  type CompanionFillerBank,
  type CompanionScheduler,
  type CompanionStallGuard,
} from "./fillers.js";
import type { CompanionNotebook } from "./notebook.js";
import { CompanionOrchestrator, CompanionTurnError } from "./orchestrator.js";
import {
  createCompanionSpeechStream,
  type CompanionSpeechSink,
  type CompanionSpeechStream,
} from "./speech-stream.js";
import type { CompanionNotebookStore } from "./store.js";
import type { CompanionTool } from "./tools/index.js";

/** Why a start was refused. The app maps these to copy; the daemon fails closed. */
export const COMPANION_DISABLED_REASON_CODE = "companion_disabled";
export const COMPANION_SPEECH_UNAVAILABLE_REASON_CODE = "companion_speech_unavailable";
export const COMPANION_BACKEND_FAILED_REASON_CODE = "companion_backend_failed";

/** What the Companion says when its own model refuses the turn. */
const TURN_FAILURE_LINES: Record<CompanionTurnError["reason"], string> = {
  authentication: "I can't sign in to my own model right now, so I can't answer that.",
  rate_limit: "I'm being rate limited at the moment. Give me a minute and ask again.",
  api: "My model just errored out on that one. Try me again.",
  connection: "I can't reach my model right now. Check the daemon's network and try again.",
};

export interface CompanionSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface CompanionToolFactoryInput {
  deferredJobs: CompanionDeferredJobs;
  logger: Logger;
  conversationId?: string;
  endConversation?: () => void;
}

export type CompanionAvailableModelConfig =
  | CompanionApiModelConfig
  | CompanionCliModelConfig
  | CompanionCodexModelConfig;

export interface CompanionBackendFactoryInput {
  config: CompanionAvailableModelConfig;
  tools: readonly CompanionTool[];
  logger: Logger;
}

/**
 * The daemon-scoped half of the Companion, built once in bootstrap. Everything
 * conversational — history, tools, deferred jobs, audio — is per client and
 * lives on `CompanionSession`; only the notebook, the filler bank and the
 * resolved configuration are shared.
 */
export interface CompanionRuntime {
  capability: ServerCapabilityState;
  refresh?: () => Promise<void>;
  nativeVoicePreview?: boolean;
  cwd?: string;
  onCapabilityChange?: () => void;
  jobs?: CompanionDeferredJobs;
  watchAgent?: (agentId: string, conversationId: string, workspaceId?: string) => () => void;
  acceptedMessages?: Pick<Set<string>, "has"> & { add(id: string): void };
  activeSession?: string;
  speechReadiness?: () => {
    available: boolean;
    reasonCode: string;
    retryable: boolean;
  };
  modelConfig: CompanionModelConfig;
  notebook: CompanionNotebookStore;
  fillers: CompanionFillerBank;
  createTools(input: CompanionToolFactoryInput): CompanionTool[];
  runDeferredJob: CompanionDeferredJobRunner;
  createBackend(input: CompanionBackendFactoryInput): CompanionBackend;
}

export interface CompanionSessionOptions {
  host: CompanionSessionHost;
  logger: Logger;
  sessionId: string;
  runtime: CompanionRuntime;
  tts: Resolvable<TextToSpeechProvider | null>;
  stt: Resolvable<SpeechToTextProvider | null>;
  turnDetection: Resolvable<TurnDetectionProvider | null>;
  sttLanguage: string;
  scheduler?: CompanionScheduler;
}

export interface CompanionStartRefusal {
  reasonCode: string;
  retryable: boolean;
}

/**
 * The single shape of a start answer. A daemon with no Companion runtime at all
 * refuses through the same path, so the app never has to tell the two apart.
 */
export function emitCompanionStartResponse(
  emit: (msg: SessionOutboundMessage) => void,
  requestId: string,
  refusal: CompanionStartRefusal | null,
  sessionId?: string,
): void {
  emit({
    type: "companion.session.start.response",
    payload: {
      requestId,
      accepted: refusal === null,
      reasonCode: refusal?.reasonCode ?? null,
      retryable: refusal?.retryable ?? false,
      ...(refusal === null && sessionId ? { sessionId } : {}),
    },
  });
}

/**
 * An unavailable Companion never arms the guard, so its threshold is moot; it
 * takes the API path's so the value is always a real one.
 */
function stallBackendKind(config: CompanionModelConfig): "api" | "cli" {
  return config.status === "available" && config.backend === "cli" ? "cli" : "api";
}

/**
 * The store keeps notes; the wire carries entries. Note status is a subset of
 * entry status, so the mapping is a rename, not a translation.
 */
function toNotebookPayload(notebook: CompanionNotebook): CompanionNotebookPayload {
  const newest = notebook.notes[0];
  return {
    entries: notebook.notes,
    updatedAt: newest ? newest.updatedAt : new Date(0).toISOString(),
  };
}

/**
 * One client's conversation with the Companion: the turn lifecycle, the audio
 * state, and barge-in. Speech input reuses the voice-mode turn controller
 * wholesale — VAD, streaming STT and endpointing are the same problem there.
 */
interface NativeVoiceStartInput {
  requestId: string;
  sdp: string;
  tools: CompanionTool[];
  deferredJobs: CompanionDeferredJobs;
  generation: number;
}

type CompanionTurnOutcome = "delivered" | "interrupted" | "failed" | "silent";

export class CompanionSession {
  private readonly host: CompanionSessionHost;
  private readonly logger: Logger;
  private readonly runtime: CompanionRuntime;
  private readonly resolveTts: () => TextToSpeechProvider | null;
  private readonly resolveStt: () => SpeechToTextProvider | null;
  private readonly resolveTurnDetection: () => TurnDetectionProvider | null;
  private readonly sttLanguage: string;
  private readonly ttsManager: TTSManager;
  private readonly stallGuard: CompanionStallGuard;

  private readonly ownerId = randomUUID();
  private nativeVoice: CompanionNativeVoice | null = null;
  private started = false;
  private generation = 0;
  private wireSessionId = randomUUID();
  private wireTurnId = 0;
  private runningTurn = false;
  private readonly nativeJobHandoffs = new Set<string>();
  private readonly pendingJobs = new Map<string, CompanionDeferredJob>();
  /** Retry unheard updates after user input, without an inference retry loop. */
  private readonly retryJobs = new Map<string, CompanionDeferredJob>();
  private readonly acceptedMessages: Pick<Set<string>, "has"> & {
    add(id: string): void;
  };
  private starting: Promise<void> | null = null;
  private turnController: VoiceTurnController | null = null;
  private orchestrator: CompanionOrchestrator | null = null;
  private backend: CompanionBackend | null = null;
  private unsubscribeJobs: (() => void) | null = null;
  private unsubscribeAgent: (() => void) | null = null;

  private turnAbort = new AbortController();
  /**
   * True between VAD `speech_started` and `speech_stopped`. The Companion must
   * never speak while this is set: a reply or filler that becomes ready mid-
   * utterance would talk straight over the user.
   */
  private isUserSpeaking = false;
  /** What the user has actually heard of the turn in flight. Reset per turn. */
  private spokenText = "";
  private pendingUserText: string[] = [];
  private dispatchedTask = false;
  private toolFailed = false;
  private conversation = CompanionConversationOptionsSchema.parse({});
  private turnQueue: Promise<void> = Promise.resolve();
  private readonly fillerGroupIds = new Set<string>();

  constructor(options: CompanionSessionOptions) {
    this.host = options.host;
    this.logger = options.logger.child({
      module: "companion",
      sessionId: options.sessionId,
    });
    this.runtime = options.runtime;
    this.acceptedMessages = options.runtime.acceptedMessages ?? new Set<string>();
    this.resolveStt = toResolver(options.stt);
    this.resolveTts = toResolver(options.tts);
    this.resolveTurnDetection = toResolver(options.turnDetection);
    this.sttLanguage = options.sttLanguage;
    this.ttsManager = new TTSManager(options.sessionId, this.logger, () => {
      const provider = this.resolveTts();
      return provider
        ? {
            synthesizeSpeech: (text) =>
              provider.synthesizeSpeech(text, {
                speed: this.conversation.speechSpeed ?? 1.3,
              }),
          }
        : null;
    });
    this.stallGuard = createCompanionStallGuard({
      scheduler: options.scheduler ?? systemScheduler,
      onStall: () => {
        void this.speakFiller();
      },
      delayMs: COMPANION_STALL_DELAY_MS[stallBackendKind(options.runtime.modelConfig)],
    });
  }

  async handleSessionStart(
    msg: Extract<SessionInboundMessage, { type: "companion.session.start.request" }>,
  ): Promise<void> {
    if (this.started) {
      this.emitStartResponse(msg.requestId, null);
      return;
    }

    if (this.runtime.activeSession && this.runtime.activeSession !== this.ownerId) {
      this.emitStartResponse(msg.requestId, {
        reasonCode: "companion_busy",
        retryable: true,
      });
      return;
    }
    this.runtime.activeSession = this.ownerId;
    if (this.starting) {
      await this.starting;
      this.emitStartResponse(
        msg.requestId,
        this.started
          ? null
          : {
              reasonCode: COMPANION_BACKEND_FAILED_REASON_CODE,
              retryable: true,
            },
      );
      return;
    }
    this.conversation = CompanionConversationOptionsSchema.parse(msg.conversation ?? {});
    this.starting = this.startSession(msg.requestId, msg.voiceTransport?.sdp);
    try {
      await this.starting;
    } catch (error) {
      this.logger.warn({ err: error }, "Companion startup failed");
      await this.shutdown();
      this.emitStartResponse(msg.requestId, {
        reasonCode: COMPANION_BACKEND_FAILED_REASON_CODE,
        retryable: true,
      });
    } finally {
      this.starting = null;
      if (!this.started) {
        this.unsubscribeAgent?.();
        this.unsubscribeAgent = null;
      }
      if (!this.started && this.runtime.activeSession === this.ownerId)
        this.runtime.activeSession = undefined;
    }
  }

  private async startSession(requestId: string, sdp?: string): Promise<void> {
    const generation = ++this.generation;
    this.wireSessionId = randomUUID();
    this.wireTurnId = 0;
    try {
      await this.runtime.refresh?.();
    } catch (error) {
      this.logger.warn({ err: error }, "Companion readiness refresh failed");
      this.emitStartResponse(requestId, {
        reasonCode: COMPANION_BACKEND_FAILED_REASON_CODE,
        retryable: true,
      });
      return;
    }
    if (generation !== this.generation) {
      this.emitStartResponse(requestId, {
        reasonCode: "companion_session_closed",
        retryable: true,
      });
      return;
    }
    this.runtime.onCapabilityChange?.();
    let refusal = this.refuseStart();
    if (sdp) {
      refusal = null;
      if (!this.runtime.nativeVoicePreview || !this.runtime.capability.enabled)
        refusal = {
          reasonCode: "companion_native_unavailable",
          retryable: false,
        };
    }
    if (refusal) {
      this.logger.info({ reasonCode: refusal.reasonCode }, "Companion session start refused");
      this.emitStartResponse(requestId, refusal);
      return;
    }

    const deferredJobs =
      this.runtime.jobs ??
      new CompanionDeferredJobs({
        run: this.runtime.runDeferredJob,
        logger: this.logger,
      });
    this.watchLaunchedAgent();
    const tools = this.runtime
      .createTools({
        deferredJobs,
        conversationId: this.wireSessionId,
        logger: this.logger,
        endConversation: () => {
          this.host.emit({
            type: "companion.input.state",
            payload: {
              isSpeaking: false,
              ended: true,
              sessionId: this.wireSessionId,
            },
          });
          void this.shutdown();
        },
      })
      .map((tool) =>
        Object.assign({}, tool, {
          invoke: async (input: unknown) => {
            const signal = this.turnAbort.signal;
            const result = await tool.invoke(input);
            if (!signal.aborted && signal === this.turnAbort.signal) {
              if (!result.ok) this.toolFailed = true;
              else if (
                tool.deferred ||
                tool.name === "create_agent" ||
                tool.name === "send_agent_prompt"
              )
                this.dispatchedTask = true;
            }
            return result;
          },
        }),
      );
    if (sdp) {
      await this.startNativeVoice({
        requestId,
        sdp,
        tools,
        deferredJobs,
        generation,
      });
      return;
    }
    const model = this.runtime.modelConfig;
    if (model.status !== "available") {
      this.emitStartResponse(requestId, {
        reasonCode: model.reasonCode,
        retryable: false,
      });
      return;
    }

    const backend = this.runtime.createBackend({
      config: model,
      tools,
      logger: this.logger,
    });

    this.backend = backend;
    // The CLI backend spends seconds spawning a process and initialising its
    // harness. Opening the session pays that, so no conversational turn does.
    try {
      await backend.warm();
      if (generation !== this.generation) {
        await backend.close();
        this.emitStartResponse(requestId, {
          reasonCode: "companion_session_closed",
          retryable: true,
        });
        return;
      }
    } catch (error) {
      this.logger.error({ err: error }, "Companion backend failed to warm");
      await backend.close();
      this.emitStartResponse(requestId, {
        reasonCode: COMPANION_BACKEND_FAILED_REASON_CODE,
        retryable: true,
      });
      return;
    }

    this.unsubscribeJobs = deferredJobs.subscribe((job) => this.handleDeferredJob(job));
    this.backend = backend;
    this.orchestrator = new CompanionOrchestrator({
      backend,
      tools,
      notebook: this.runtime.notebook,
      instructions: companionConversationInstructions(this.conversation),
    });

    try {
      await this.startTurnController();
    } catch (error) {
      await this.shutdown();
      this.logger.warn({ err: error }, "Companion microphone setup failed");
      this.emitStartResponse(requestId, {
        reasonCode: COMPANION_SPEECH_UNAVAILABLE_REASON_CODE,
        retryable: true,
      });
      return;
    }
    if (generation !== this.generation) {
      await this.turnController?.stop();
      this.turnController = null;
      this.emitStartResponse(requestId, {
        reasonCode: "companion_session_closed",
        retryable: true,
      });
      return;
    }
    this.started = true;
    this.emitStartResponse(requestId, null);
    await this.emitNotebook();
    this.replayJobs(deferredJobs);
  }

  private async startNativeVoice(input: NativeVoiceStartInput): Promise<void> {
    const { requestId, sdp, tools, deferredJobs, generation } = input;
    const native = createCompanionNativeVoice({
      instructions: companionConversationInstructions(this.conversation),
      model: "gpt-5.6-luna",
      tools,
      cwd: this.runtime.cwd ?? process.cwd(),
      logger: this.logger,
      onTranscript: (role, text, isFinal) => {
        if (generation !== this.generation) return;
        if (role === "user") this.emitTranscript(text, isFinal);
        else this.emitReply(text, isFinal);
      },
      onError: (error) => {
        if (generation !== this.generation) return;
        this.logger.warn({ err: error }, "Companion native voice failed");
        this.host.emit({
          type: "companion.input.state",
          payload: {
            isSpeaking: false,
            ended: true,
            sessionId: this.wireSessionId,
          },
        });
        void this.shutdown();
      },
    });
    this.nativeVoice = native;
    try {
      const answer = await native.start(sdp);
      if (generation !== this.generation) {
        await native.close();
        this.emitStartResponse(requestId, {
          reasonCode: "companion_session_closed",
          retryable: true,
        });
        return;
      }
      this.started = true;
      this.unsubscribeJobs = deferredJobs.subscribe((job) => this.handleDeferredJob(job));
      this.host.emit({
        type: "companion.session.start.response",
        payload: {
          requestId,
          accepted: true,
          reasonCode: null,
          retryable: false,
          sessionId: this.wireSessionId,
          sdp: answer,
          backend: "codex-webrtc",
        },
      });
      await this.emitNotebook();
      this.replayJobs(deferredJobs);
    } catch (error) {
      this.logger.warn({ err: error }, "Native Companion failed to start");
      await native.close();
      this.emitStartResponse(requestId, {
        reasonCode: "companion_native_unavailable",
        retryable: true,
      });
    }
  }

  async handleSessionStop(
    msg: Extract<SessionInboundMessage, { type: "companion.session.stop.request" }>,
  ): Promise<void> {
    await this.shutdown();
    this.host.emit({
      type: "companion.session.stop.response",
      payload: { requestId: msg.requestId, accepted: true },
    });
  }

  async handleAudioChunk(
    msg: Extract<SessionInboundMessage, { type: "companion.audio.chunk" }>,
  ): Promise<void> {
    if (!this.turnController) {
      return;
    }
    await this.turnController.appendClientChunk({
      audioBase64: msg.audio,
      format: msg.format,
    });
  }

  handleAudioPlayed(id: string): void {
    const [groupId] = id.split(":");
    if (this.fillerGroupIds.delete(groupId)) {
      return;
    }
    this.ttsManager.confirmAudioPlayed(id);
  }

  async handleMessageSend(
    msg: Extract<SessionInboundMessage, { type: "companion.message.send.request" }>,
  ): Promise<void> {
    const text = msg.text.trim();
    const duplicate = this.acceptedMessages.has(msg.requestId);
    let reasonCode: string | null = null;
    if (!duplicate) {
      if (!this.started || !this.orchestrator) reasonCode = "companion_session_closed";
      else if (!text) reasonCode = "companion_message_empty";
    }
    if (!reasonCode && !duplicate) {
      try {
        this.acceptedMessages.add(msg.requestId);
      } catch (error) {
        this.logger.error({ err: error }, "Companion acceptance could not be persisted");
        this.host.emit({
          type: "companion.message.send.response",
          payload: {
            requestId: msg.requestId,
            accepted: false,
            reasonCode: "companion_receipt_failed",
          },
        });
        return;
      }
    }
    this.host.emit({
      type: "companion.message.send.response",
      payload: {
        requestId: msg.requestId,
        accepted: reasonCode === null,
        reasonCode,
      },
    });
    if (reasonCode || duplicate) return;
    this.emitTranscript(text, true);
    this.bargeIn();
    this.emitInputState(false);
    this.stallGuard.arm();
    await this.enqueueTurn(text).catch((error) =>
      this.logger.warn({ err: error }, "Companion message failed"),
    );
  }

  async handleNotebookFetch(
    msg: Extract<SessionInboundMessage, { type: "companion.notebook.fetch.request" }>,
  ): Promise<void> {
    const notebook = await this.runtime.notebook.get();
    this.host.emit({
      type: "companion.notebook.fetch.response",
      payload: {
        requestId: msg.requestId,
        notebook: toNotebookPayload(notebook),
      },
    });
  }

  async cleanup(): Promise<void> {
    await this.shutdown();
    this.ttsManager.cleanup();
  }

  private refuseStart(): CompanionStartRefusal | null {
    if (this.runtime.modelConfig.status === "unavailable") {
      return {
        reasonCode: COMPANION_BACKEND_MISSING_REASON_CODE,
        retryable: false,
      };
    }
    if (!this.runtime.capability.enabled) {
      return { reasonCode: COMPANION_DISABLED_REASON_CODE, retryable: false };
    }
    const readiness = this.runtime.speechReadiness?.();
    if (readiness && !readiness.available)
      return {
        reasonCode: COMPANION_SPEECH_UNAVAILABLE_REASON_CODE,
        retryable: readiness.retryable,
      };
    if (!this.resolveTts() || !this.resolveStt() || !this.resolveTurnDetection()) {
      return {
        reasonCode: COMPANION_SPEECH_UNAVAILABLE_REASON_CODE,
        retryable: true,
      };
    }
    return null;
  }

  private emitStartResponse(requestId: string, refusal: CompanionStartRefusal | null): void {
    emitCompanionStartResponse(
      (msg) => this.host.emit(msg),
      requestId,
      refusal,
      this.wireSessionId,
    );
  }

  private async startTurnController(): Promise<void> {
    const stt = this.resolveStt();
    const turnDetection = this.resolveTurnDetection();
    if (!stt || !turnDetection) {
      throw new Error("Companion speech providers disappeared between the check and the start");
    }

    const generation = this.generation;
    const controller = createVoiceTurnController({
      logger: this.logger.child({ component: "voice-turn-controller" }),
      turnDetection,
      stt,
      sttLanguage: this.sttLanguage,
      continuousTranscripts: true,
      endpointing: { confirmMs: 120, silenceMs: this.conversation.pauseMs },
      callbacks: {
        // Barge-in hangs off VAD onset, not the first STT partial. A partial
        // needs the VAD confirm window, a round trip through the recogniser and
        // a non-filler result, so gating on it let the Companion talk over the
        // user for the best part of a second -- and never stop at all when the
        // recogniser returned nothing usable.
        onSpeechStarted: async () => {
          if (generation !== this.generation) return;
          this.logger.debug("Companion VAD speech_started");
          this.isUserSpeaking = true;
          if (this.conversation.interruptible) this.bargeIn();
          this.emitInputState(this.conversation.interruptible);
        },
        onPartialTranscript: async ({ transcript }) => {
          if (generation !== this.generation) return;
          this.emitTranscript(transcript, false);
        },
        onSpeechStopped: async () => {
          if (generation !== this.generation) return;
          this.isUserSpeaking = false;
          this.emitInputState(false);
          this.stallGuard.arm();
        },
        onFinalTranscript: async ({ transcript, isLowConfidence }) => {
          if (generation !== this.generation) return;
          const text = isLowConfidence ? "" : transcript.trim();
          if (text) this.pendingUserText.push(text);
          if (this.isUserSpeaking) return;
          const utterance = this.pendingUserText.join(" ");
          this.pendingUserText = [];
          if (!utterance) {
            this.stallGuard.cancel();
            this.flushJobs();
            return;
          }
          this.emitTranscript(utterance, true);
          await this.enqueueTurn(utterance);
        },
        onError: (error) => {
          this.logger.error({ err: error }, "Companion voice turn controller failed");
        },
      },
    });

    this.turnController = controller;
    await controller.start();
    if (generation !== this.generation) await controller.stop();
  }

  /**
   * Talking over the Companion stops it dead: the turn in flight is abandoned,
   * queued playback is dropped, and the stall guard stands down.
   */
  private bargeIn(): void {
    this.stallGuard.cancel();
    this.wireTurnId += 1;
    this.turnAbort.abort();
    this.ttsManager.cancelPendingPlaybacks("companion barge-in");
  }

  private enqueueTurn(
    text: string,
    origin: "user" | "announcement" = "user",
  ): Promise<CompanionTurnOutcome> {
    const generation = this.generation;
    const turnId = this.wireTurnId;
    const run = (): Promise<CompanionTurnOutcome> => {
      const superseded = origin === "announcement" && turnId !== this.wireTurnId;
      if (generation !== this.generation || superseded) {
        this.runningTurn = false;
        return Promise.resolve("interrupted");
      }
      return this.runTurn(text);
    };
    const next = this.turnQueue.then(run, run);
    this.turnQueue = next.then(
      () => undefined,
      () => undefined,
    );
    if (origin === "user") {
      const resumeUpdates = () => {
        if (generation !== this.generation) return;
        for (const [id, job] of this.retryJobs)
          if (!this.pendingJobs.has(id)) this.pendingJobs.set(id, job);
        this.retryJobs.clear();
        this.flushJobs();
      };
      void next.then(resumeUpdates, resumeUpdates);
    }
    return next;
  }

  private async runTurn(text: string): Promise<CompanionTurnOutcome> {
    const orchestrator = this.orchestrator;
    if (!orchestrator) {
      return "interrupted";
    }

    const generation = this.generation;
    this.runningTurn = true;
    this.turnAbort = new AbortController();
    this.dispatchedTask = false;
    this.toolFailed = false;
    const signal = this.turnAbort.signal;
    let speechFailed = false;
    let modelCompleted = false;
    const stream = createCompanionSpeechStream({
      sink: this.createSink(signal),
      onSpeaking: () => this.stallGuard.cancel(),
      onError: (error) => {
        speechFailed = true;
        this.logger.warn({ err: error }, "Companion segment failed to speak");
      },
      signal,
    });
    this.spokenText = "";
    const turn = orchestrator.turn(text, () => this.spokenText, signal);
    let reply = "";
    const finalOnly = !this.conversation.acknowledgeTasks;
    try {
      for await (const event of turn) {
        if (signal.aborted) {
          break;
        }
        if (event.type === "text_delta") {
          reply += event.text;
          if (!finalOnly) stream.push(event.text);
          this.emitReply(reply, false);
          continue;
        }
        if (event.type === "completed") {
          modelCompleted = true;
          if (!finalOnly) reply = event.reply;
        }
        if (event.type === "tool_started") {
          if (finalOnly) reply = "";
        }
      }
      if (!signal.aborted) {
        if (finalOnly && this.shouldSpeakFinalReply()) stream.push(reply);
        stream.end();
        this.emitReply(reply, true);
      }
    } catch (error) {
      modelCompleted = false;
      await this.speakTurnFailure(error, stream, signal);
    } finally {
      await turn.return();
      this.stallGuard.cancel();
      await stream.idle();
      orchestrator.reconcileLastReply(this.spokenText);
      this.runningTurn = false;
    }

    if (!signal.aborted) {
      await this.emitNotebook();
    }
    if (signal.aborted || generation !== this.generation) return "interrupted";
    if (!modelCompleted || speechFailed) return "failed";
    return this.spokenText ? "delivered" : "silent";
  }

  private replayJobs(jobs: CompanionDeferredJobs): void {
    for (const job of jobs.list())
      if (!job.announced && (job.status !== "running" || job.summary)) this.handleDeferredJob(job);
  }

  private watchLaunchedAgent(): void {
    if (!this.conversation.agentId) return;
    this.unsubscribeAgent =
      this.runtime.watchAgent?.(
        this.conversation.agentId,
        this.wireSessionId,
        this.conversation.workspaceId,
      ) ?? null;
  }

  private shouldSpeakFinalReply(): boolean {
    return !this.dispatchedTask || this.toolFailed;
  }

  private async speakTurnFailure(
    error: unknown,
    stream: CompanionSpeechStream,
    signal: AbortSignal,
  ): Promise<void> {
    if (!(error instanceof CompanionTurnError)) {
      throw error;
    }
    this.logger.warn(
      { err: error, reason: error.reason, status: error.status },
      "Companion turn failed",
    );
    if (signal.aborted) {
      return;
    }
    const line = TURN_FAILURE_LINES[error.reason];
    this.emitReply(line, true);
    stream.push(line);
    stream.end();
  }

  private createSink(signal: AbortSignal): CompanionSpeechSink {
    const forward = (msg: SessionOutboundMessage) => {
      if (!signal.aborted) this.forwardAudio(msg);
    };
    return {
      prepare: async (text) => {
        text = toSpokenText(text);
        if (!text) return async () => {};
        const play = await this.ttsManager.prepareSpeech(text, forward, signal);
        return async () => {
          await play();
          if (!signal.aborted) this.spokenText += this.spokenText ? ` ${text}` : text;
        };
      },
      speak: async (text) => {
        text = toSpokenText(text);
        if (!text) return;
        await this.ttsManager.generateAndWaitForPlayback(text, forward, signal, true);
        if (!signal.aborted) this.spokenText += this.spokenText ? ` ${text}` : text;
      },
    };
  }

  /**
   * `TTSManager` speaks voice mode's `audio_output`; the Companion has its own
   * outbound name. Grouping is optional on that message but always set by the
   * manager, so a chunk without it is a bug rather than a shape to tolerate.
   */
  private forwardAudio(msg: SessionOutboundMessage): void {
    if (msg.type !== "audio_output") {
      return;
    }
    const { audio, format, id, groupId, isLastChunk } = msg.payload;
    if (groupId === undefined || isLastChunk === undefined) {
      this.logger.warn({ id }, "Dropping ungrouped Companion audio chunk");
      return;
    }
    // Synthesis that finished while the user started talking is dropped rather
    // than played late: `bargeIn` has already abandoned the turn it belongs to.
    if (this.isUserSpeaking && this.conversation.interruptible) {
      this.logger.debug({ id }, "Dropping Companion audio chunk while the user is speaking");
      return;
    }
    this.host.emit({
      type: "companion.audio.output",
      payload: {
        audio,
        format,
        id,
        groupId,
        isLastChunk,
        sessionId: this.wireSessionId,
        turnId: this.wireTurnId,
      },
    });
  }

  /**
   * The stall guard's payload: cached audio straight onto the wire, so the line
   * lands without waiting on a provider. Its playback ack belongs to no
   * TTSManager playback, so it is swallowed rather than warned about.
   */
  private async speakFiller(): Promise<void> {
    if (!this.conversation.acknowledgeTasks) return;
    const signal = this.turnAbort.signal;
    const generation = this.generation;
    const filler = await this.runtime.fillers.take();
    if (generation !== this.generation || !filler || signal.aborted || this.isUserSpeaking) {
      return;
    }
    const groupId = `companion-filler-${Date.now()}`;
    this.fillerGroupIds.add(groupId);
    this.host.emit({
      type: "companion.audio.output",
      payload: {
        audio: filler.audio,
        format: filler.format,
        id: `${groupId}:0`,
        groupId,
        isLastChunk: true,
        sessionId: this.wireSessionId,
        turnId: this.wireTurnId,
      },
    });
  }

  private handleDeferredJob(job: CompanionDeferredJob): void {
    this.host.emit({
      type: "companion.job.update",
      payload: {
        jobId: job.jobId,
        label: job.label,
        status: job.status === "succeeded" ? "completed" : job.status,
        summary: job.summary,
      },
    });
    if (job.status === "running" && !job.summary) return;
    if (job.status !== "running" && this.conversation.updates === "off") return;
    if (job.status === "failed" && this.conversation.updates === "completion") return;
    if (this.nativeVoice) {
      const handoffId = `${job.jobId}:${job.status}:${job.summary ?? ""}`;
      if (this.nativeJobHandoffs.has(handoffId)) return;
      this.nativeJobHandoffs.add(handoffId);
      // An append acknowledgement is not proof the audio was delivered. Keep results unannounced
      // for reconnection until native transcript/playback acknowledgement is qualified.
      void this.nativeVoice
        .appendSpeech(
          job.status === "running"
            ? `${job.summary}. Ask about this specific permission.`
            : describeSettledJob(job),
        )
        .catch((error: unknown) => {
          this.nativeJobHandoffs.delete(handoffId);
          this.logger.warn({ err: error }, "Native result handoff failed");
        });
      return;
    }
    this.retryJobs.delete(job.jobId);
    this.pendingJobs.set(job.jobId, { ...job });
    this.flushJobs();
  }

  private flushJobs(): void {
    if (!this.started || this.isUserSpeaking || this.runningTurn || this.pendingJobs.size === 0)
      return;
    const jobs = Array.from(this.pendingJobs.values()).sort(
      (a, b) => Number(b.status === "running") - Number(a.status === "running"),
    );
    this.pendingJobs.clear();
    const generation = this.generation;
    const text = jobs
      .map((job) =>
        job.status === "running"
          ? `${job.summary}. Ask the user about this specific permission.`
          : describeSettledJob(job),
      )
      .join("\n");
    this.runningTurn = true;
    const retainUnheard = () => {
      if (generation !== this.generation) return;
      for (const job of jobs)
        if (!this.pendingJobs.has(job.jobId)) this.retryJobs.set(job.jobId, job);
    };
    void this.enqueueTurn(text, "announcement")
      .then((outcome) => {
        if (outcome !== "delivered") {
          retainUnheard();
          return undefined;
        }
        for (const job of jobs) {
          if (generation !== this.generation) continue;
          if (job.status !== "running") this.runtime.jobs?.markAnnounced(job.jobId);
        }
        return undefined;
      })
      .catch((error: unknown) => {
        retainUnheard();
        this.logger.warn({ err: error }, "Companion announcement failed");
      })
      .finally(() => this.flushJobs());
  }

  private emitInputState(isSpeaking: boolean): void {
    this.host.emit({
      type: "companion.input.state",
      payload: {
        isSpeaking,
        sessionId: this.wireSessionId,
        turnId: this.wireTurnId,
      },
    });
  }

  private emitTranscript(text: string, isFinal: boolean): void {
    this.host.emit({
      type: "companion.transcript",
      payload: {
        text,
        isFinal,
        sessionId: this.wireSessionId,
        turnId: this.wireTurnId,
      },
    });
  }

  private emitReply(text: string, isFinal: boolean): void {
    this.host.emit({
      type: "companion.reply",
      payload: {
        text,
        isFinal,
        sessionId: this.wireSessionId,
        turnId: this.wireTurnId,
      },
    });
  }

  private async emitNotebook(): Promise<void> {
    const notebook = await this.runtime.notebook.get();
    this.host.emit({
      type: "companion.notebook.update",
      payload: { notebook: toNotebookPayload(notebook) },
    });
  }

  private async shutdown(): Promise<void> {
    if (this.runtime.activeSession === this.ownerId) this.runtime.activeSession = undefined;
    this.generation += 1;
    const native = this.nativeVoice;
    this.nativeVoice = null;
    this.bargeIn();
    this.unsubscribeJobs?.();
    this.unsubscribeJobs = null;
    this.unsubscribeAgent?.();
    this.unsubscribeAgent = null;
    this.orchestrator = null;
    this.started = false;
    this.pendingJobs.clear();
    this.retryJobs.clear();
    this.nativeJobHandoffs.clear();
    this.pendingUserText = [];
    this.isUserSpeaking = false;

    const backend = this.backend;
    this.backend = null;
    const controller = this.turnController;
    this.turnController = null;
    const cleanup = Promise.allSettled([backend?.close(), controller?.stop(), native?.close()]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2500);
      }),
    ]);
    clearTimeout(timer);
  }
}
