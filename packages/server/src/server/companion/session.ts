import type { Logger } from "pino";
import type {
  CompanionNotebook as CompanionNotebookPayload,
  ServerCapabilityState,
} from "@fde/protocol/messages";

import { TTSManager } from "../agent/tts-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { toResolver, type Resolvable } from "../speech/provider-resolver.js";
import type { SpeechToTextProvider, TextToSpeechProvider } from "../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../speech/turn-detection-provider.js";
import {
  createVoiceTurnController,
  type VoiceTurnController,
} from "../session/voice/voice-turn-controller.js";
import {
  COMPANION_KEY_MISSING_REASON_CODE,
  type CompanionModelConfig,
} from "./anthropic-config.js";
import {
  CompanionDeferredJobs,
  describeSettledJob,
  type CompanionDeferredJob,
  type CompanionDeferredJobRunner,
} from "./deferred-jobs.js";
import {
  createCompanionStallGuard,
  systemScheduler,
  type CompanionFillerBank,
  type CompanionScheduler,
  type CompanionStallGuard,
} from "./fillers.js";
import type { CompanionNotebook } from "./notebook.js";
import {
  CompanionOrchestrator,
  CompanionTurnError,
  type CompanionModelClient,
  type CompanionModelSettings,
} from "./orchestrator.js";
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
}

/**
 * The daemon-scoped half of the Companion, built once in bootstrap. Everything
 * conversational — history, tools, deferred jobs, audio — is per client and
 * lives on `CompanionSession`; only the notebook, the filler bank and the
 * resolved configuration are shared.
 */
export interface CompanionRuntime {
  capability: ServerCapabilityState;
  modelConfig: CompanionModelConfig;
  notebook: CompanionNotebookStore;
  fillers: CompanionFillerBank;
  createTools(input: CompanionToolFactoryInput): CompanionTool[];
  runDeferredJob: CompanionDeferredJobRunner;
  createModelClient(settings: CompanionModelSettings): CompanionModelClient;
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
): void {
  emit({
    type: "companion.session.start.response",
    payload: {
      requestId,
      accepted: refusal === null,
      reasonCode: refusal?.reasonCode ?? null,
      retryable: refusal?.retryable ?? false,
    },
  });
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
export class CompanionSession {
  private readonly host: CompanionSessionHost;
  private readonly logger: Logger;
  private readonly runtime: CompanionRuntime;
  private readonly resolveStt: () => SpeechToTextProvider | null;
  private readonly resolveTurnDetection: () => TurnDetectionProvider | null;
  private readonly sttLanguage: string;
  private readonly ttsManager: TTSManager;
  private readonly stallGuard: CompanionStallGuard;

  private started = false;
  private turnController: VoiceTurnController | null = null;
  private orchestrator: CompanionOrchestrator | null = null;
  private unsubscribeJobs: (() => void) | null = null;

  private turnAbort = new AbortController();
  private turnQueue: Promise<void> = Promise.resolve();
  private readonly fillerGroupIds = new Set<string>();

  constructor(options: CompanionSessionOptions) {
    this.host = options.host;
    this.logger = options.logger.child({ module: "companion", sessionId: options.sessionId });
    this.runtime = options.runtime;
    this.resolveStt = toResolver(options.stt);
    this.resolveTurnDetection = toResolver(options.turnDetection);
    this.sttLanguage = options.sttLanguage;
    this.ttsManager = new TTSManager(options.sessionId, this.logger, options.tts);
    this.stallGuard = createCompanionStallGuard({
      scheduler: options.scheduler ?? systemScheduler,
      onStall: () => {
        void this.speakFiller();
      },
    });
  }

  async handleSessionStart(
    msg: Extract<SessionInboundMessage, { type: "companion.session.start.request" }>,
  ): Promise<void> {
    if (this.started) {
      this.emitStartResponse(msg.requestId, null);
      return;
    }

    const refusal = this.refuseStart();
    if (refusal) {
      this.logger.info({ reasonCode: refusal.reasonCode }, "Companion session start refused");
      this.emitStartResponse(msg.requestId, refusal);
      return;
    }

    const model = this.runtime.modelConfig;
    if (model.status !== "available") {
      this.emitStartResponse(msg.requestId, {
        reasonCode: model.reasonCode,
        retryable: false,
      });
      return;
    }

    const deferredJobs = new CompanionDeferredJobs({
      run: this.runtime.runDeferredJob,
      logger: this.logger,
    });
    this.unsubscribeJobs = deferredJobs.subscribe((job) => this.handleDeferredJob(job));
    this.orchestrator = new CompanionOrchestrator({
      client: this.runtime.createModelClient(model),
      tools: this.runtime.createTools({ deferredJobs, logger: this.logger }),
      notebook: this.runtime.notebook,
      model: model.model,
    });

    await this.startTurnController();
    this.started = true;
    this.emitStartResponse(msg.requestId, null);
    await this.emitNotebook();
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
    await this.turnController.appendClientChunk({ audioBase64: msg.audio, format: msg.format });
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
    if (!this.orchestrator || !text) {
      return;
    }
    this.emitTranscript(text, true);
    await this.enqueueTurn(text);
  }

  async handleNotebookFetch(
    msg: Extract<SessionInboundMessage, { type: "companion.notebook.fetch.request" }>,
  ): Promise<void> {
    const notebook = await this.runtime.notebook.get();
    this.host.emit({
      type: "companion.notebook.fetch.response",
      payload: { requestId: msg.requestId, notebook: toNotebookPayload(notebook) },
    });
  }

  async cleanup(): Promise<void> {
    await this.shutdown();
    this.ttsManager.cleanup();
  }

  private refuseStart(): CompanionStartRefusal | null {
    if (this.runtime.modelConfig.status === "unavailable") {
      return { reasonCode: COMPANION_KEY_MISSING_REASON_CODE, retryable: false };
    }
    if (!this.runtime.capability.enabled) {
      return { reasonCode: COMPANION_DISABLED_REASON_CODE, retryable: false };
    }
    if (!this.resolveStt() || !this.resolveTurnDetection()) {
      return { reasonCode: COMPANION_SPEECH_UNAVAILABLE_REASON_CODE, retryable: true };
    }
    return null;
  }

  private emitStartResponse(requestId: string, refusal: CompanionStartRefusal | null): void {
    emitCompanionStartResponse((msg) => this.host.emit(msg), requestId, refusal);
  }

  private async startTurnController(): Promise<void> {
    const stt = this.resolveStt();
    const turnDetection = this.resolveTurnDetection();
    if (!stt || !turnDetection) {
      throw new Error("Companion speech providers disappeared between the check and the start");
    }

    const controller = createVoiceTurnController({
      logger: this.logger.child({ component: "voice-turn-controller" }),
      turnDetection,
      stt,
      sttLanguage: this.sttLanguage,
      callbacks: {
        onSpeechStarted: async () => {
          this.logger.debug("Companion VAD speech_started");
        },
        onPartialTranscript: async ({ transcript }) => {
          this.emitInputState(true);
          this.emitTranscript(transcript, false);
          this.bargeIn();
        },
        onSpeechStopped: async () => {
          this.emitInputState(false);
          this.stallGuard.arm();
        },
        onFinalTranscript: async ({ transcript, isLowConfidence }) => {
          const text = isLowConfidence ? "" : transcript.trim();
          if (!text) {
            this.stallGuard.cancel();
            return;
          }
          this.emitTranscript(text, true);
          await this.enqueueTurn(text);
        },
        onError: (error) => {
          this.logger.error({ err: error }, "Companion voice turn controller failed");
        },
      },
    });

    await controller.start();
    this.turnController = controller;
  }

  /**
   * Talking over the Companion stops it dead: the turn in flight is abandoned,
   * queued playback is dropped, and the stall guard stands down.
   */
  private bargeIn(): void {
    this.stallGuard.cancel();
    this.turnAbort.abort();
    this.ttsManager.cancelPendingPlaybacks("companion barge-in");
  }

  private enqueueTurn(text: string): Promise<void> {
    const next = this.turnQueue.then(
      () => this.runTurn(text),
      () => this.runTurn(text),
    );
    this.turnQueue = next.catch(() => undefined);
    return next;
  }

  private async runTurn(text: string): Promise<void> {
    const orchestrator = this.orchestrator;
    if (!orchestrator) {
      return;
    }

    this.turnAbort = new AbortController();
    const signal = this.turnAbort.signal;
    const stream = createCompanionSpeechStream({
      sink: this.createSink(signal),
      onSpeaking: () => this.stallGuard.cancel(),
      onError: (error) => this.logger.warn({ err: error }, "Companion segment failed to speak"),
      signal,
    });
    const turn = orchestrator.turn(text);
    let reply = "";
    try {
      for await (const event of turn) {
        if (signal.aborted) {
          break;
        }
        if (event.type === "text_delta") {
          reply += event.text;
          stream.push(event.text);
          this.emitReply(reply, false);
          continue;
        }
        if (event.type === "completed") {
          reply = event.reply;
        }
      }
      if (!signal.aborted) {
        stream.end();
        this.emitReply(reply, true);
      }
    } catch (error) {
      await this.speakTurnFailure(error, stream, signal);
    } finally {
      await turn.return();
      this.stallGuard.cancel();
      await stream.idle();
    }

    if (!signal.aborted) {
      await this.emitNotebook();
    }
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
    return {
      speak: (text) =>
        this.ttsManager.generateAndWaitForPlayback(
          text,
          (msg) => this.forwardAudio(msg),
          signal,
          true,
        ),
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
    this.host.emit({
      type: "companion.audio.output",
      payload: { audio, format, id, groupId, isLastChunk },
    });
  }

  /**
   * The stall guard's payload: cached audio straight onto the wire, so the line
   * lands without waiting on a provider. Its playback ack belongs to no
   * TTSManager playback, so it is swallowed rather than warned about.
   */
  private async speakFiller(): Promise<void> {
    const filler = await this.runtime.fillers.take();
    if (!filler || this.turnAbort.signal.aborted) {
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
    if (job.status === "running") {
      return;
    }
    void this.enqueueTurn(describeSettledJob(job));
  }

  private emitInputState(isSpeaking: boolean): void {
    this.host.emit({ type: "companion.input.state", payload: { isSpeaking } });
  }

  private emitTranscript(text: string, isFinal: boolean): void {
    this.host.emit({ type: "companion.transcript", payload: { text, isFinal } });
  }

  private emitReply(text: string, isFinal: boolean): void {
    this.host.emit({ type: "companion.reply", payload: { text, isFinal } });
  }

  private async emitNotebook(): Promise<void> {
    const notebook = await this.runtime.notebook.get();
    this.host.emit({
      type: "companion.notebook.update",
      payload: { notebook: toNotebookPayload(notebook) },
    });
  }

  private async shutdown(): Promise<void> {
    this.bargeIn();
    this.unsubscribeJobs?.();
    this.unsubscribeJobs = null;
    this.orchestrator = null;
    this.started = false;

    const controller = this.turnController;
    this.turnController = null;
    await controller?.stop();
  }
}
