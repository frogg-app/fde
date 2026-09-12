import { Buffer } from "node:buffer";
import type { Logger } from "pino";
import { v4 as uuidv4 } from "uuid";

import { Pcm16MonoResampler } from "../../agent/pcm16-resampler.js";
import { parsePcmRateFromFormat } from "../../speech/audio.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
} from "../../speech/speech-provider.js";
import type { TurnDetectionProvider } from "../../speech/turn-detection-provider.js";

const VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS = 10_000;

const FILLER_PARTIAL_WORDS = new Set([
  "uh",
  "um",
  "ah",
  "eh",
  "er",
  "hmm",
  "mm",
  "mmm",
  "mhm",
  "huh",
  "uhhuh",
  "uh-huh",
  "oh",
]);

function isFillerOnlyPartial(transcript: string): boolean {
  const tokens = transcript
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  return tokens.every((token) => FILLER_PARTIAL_WORDS.has(token));
}

type VoiceInputState =
  | { status: "idle" }
  | { status: "listening" }
  | {
      status: "capturing";
      utteranceId: string;
      startedAt: number;
    };

export interface VoiceTurnControllerCallbacks {
  onSpeechStarted(): Promise<void>;
  onSpeechStopped(): Promise<void>;
  onPartialTranscript(input: { segmentId: string; transcript: string }): Promise<void>;
  onFinalTranscript(input: VoiceFinalTranscript): Promise<void>;
  onError(error: Error): void;
}

export interface VoiceTurnController {
  start(): Promise<void>;
  stop(): Promise<void>;
  appendClientChunk(input: { audioBase64: string; format: string }): Promise<void>;
}

interface TranscriptSegmentMeta {
  language?: string;
  avgLogprob?: number;
  isLowConfidence?: boolean;
}

interface VoiceFinalTranscript {
  segmentId: string;
  transcript: string;
  language?: string;
  avgLogprob?: number;
  isLowConfidence?: boolean;
  durationMs: number;
}

interface FinalizingVoiceTurn {
  turnId: string;
  startedAt: number;
  committedSegmentIds: string[];
  transcriptsBySegmentId: Map<string, string>;
  finalTranscriptSegmentIds: Set<string>;
  transcriptMetaBySegmentId: Map<string, TranscriptSegmentMeta>;
  timeout: ReturnType<typeof setTimeout>;
  fired: boolean;
}

export function createVoiceTurnController(params: {
  logger: Logger;
  turnDetection: TurnDetectionProvider;
  stt: SpeechToTextProvider;
  sttLanguage?: string;
  continuousTranscripts?: boolean;
  endpointing?: { confirmMs?: number; silenceMs?: number };
  callbacks: VoiceTurnControllerCallbacks;
}): VoiceTurnController {
  const detector = params.turnDetection.createSession({
    logger: params.logger.child({ component: "turn-detection" }),
    ...params.endpointing,
  });

  let state: VoiceInputState = { status: "idle" };
  let stopped = false;
  let resampler: Pcm16MonoResampler | null = null;
  let sttSession: StreamingTranscriptionSession | null = null;
  let sttResampler: Pcm16MonoResampler | null = null;
  let inputRate = detector.requiredSampleRate;
  let sttInputRate = 0;
  let preroll = Buffer.alloc(0);
  let queued = Promise.resolve();
  let activeTranscriptSegmentId: string | null = null;
  let partialTranscriptFired = false;
  let reconnectAttemptedForTurn = false;
  const sealedTranscriptSegmentIds = new Set<string>();
  let currentFinalizingTurn: FinalizingVoiceTurn | null = null;
  const finalizingTurns = new Map<string, FinalizingVoiceTurn>();

  function fail(error: unknown): void {
    params.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }

  function firePartialTranscript(segmentId: string, transcript: string): void {
    if ((!params.continuousTranscripts && partialTranscriptFired) || state.status !== "capturing") {
      return;
    }

    partialTranscriptFired = true;
    void runSerial(async () => {
      await params.callbacks.onPartialTranscript({ segmentId, transcript });
    });
  }

  function clearFinalizingTurnTimeout(): void {
    for (const turn of finalizingTurns.values()) clearTimeout(turn.timeout);
  }

  function getFinalizingTurnForSegment(segmentId: string): FinalizingVoiceTurn | null {
    for (const turn of finalizingTurns.values()) {
      if (turn.committedSegmentIds.includes(segmentId)) return turn;
    }
    if (
      currentFinalizingTurn?.committedSegmentIds.length === 0 &&
      (!activeTranscriptSegmentId || activeTranscriptSegmentId === segmentId)
    )
      return currentFinalizingTurn;
    return null;
  }

  function getOrderedFinalSegmentIds(turn: FinalizingVoiceTurn): string[] {
    if (turn.committedSegmentIds.length === 0) {
      return [...turn.finalTranscriptSegmentIds];
    }

    return turn.committedSegmentIds.filter((segmentId) =>
      turn.finalTranscriptSegmentIds.has(segmentId),
    );
  }

  function assembleFinalTranscript(turn: FinalizingVoiceTurn): VoiceFinalTranscript {
    const orderedFinalSegmentIds = getOrderedFinalSegmentIds(turn);
    const transcript = orderedFinalSegmentIds
      .map((segmentId) => turn.transcriptsBySegmentId.get(segmentId)?.trim() ?? "")
      .filter((segment) => segment.length > 0)
      .join(" ")
      .trim();
    const orderedFinalMeta = orderedFinalSegmentIds
      .map((segmentId) => turn.transcriptMetaBySegmentId.get(segmentId))
      .filter((meta): meta is TranscriptSegmentMeta => Boolean(meta));
    const language = orderedFinalMeta.find((meta) => meta.language)?.language;
    const singleSegmentMeta = orderedFinalMeta.length === 1 ? orderedFinalMeta[0] : null;
    const allLowConfidence =
      orderedFinalMeta.length > 0 &&
      orderedFinalMeta.every((meta) => meta.isLowConfidence === true);

    return {
      segmentId: turn.committedSegmentIds[0] ?? orderedFinalSegmentIds[0] ?? turn.turnId,
      transcript,
      ...(language ? { language } : {}),
      ...(singleSegmentMeta?.avgLogprob !== undefined
        ? { avgLogprob: singleSegmentMeta.avgLogprob }
        : {}),
      ...(allLowConfidence ? { isLowConfidence: true } : {}),
      durationMs: Math.max(0, Date.now() - turn.startedAt),
    };
  }

  function fireFinalTranscript(turn: FinalizingVoiceTurn, reason: "complete" | "timeout"): void {
    if (turn.fired || !finalizingTurns.has(turn.turnId)) {
      return;
    }

    turn.fired = true;
    clearTimeout(turn.timeout);
    finalizingTurns.delete(turn.turnId);
    if (currentFinalizingTurn === turn) currentFinalizingTurn = null;
    for (const id of turn.committedSegmentIds) sealedTranscriptSegmentIds.delete(id);

    const finalTranscript = assembleFinalTranscript(turn);
    if (reason === "timeout") {
      params.logger.warn(
        {
          turnId: turn.turnId,
          committedSegments: turn.committedSegmentIds.length,
          receivedFinals: turn.finalTranscriptSegmentIds.size,
          timeoutMs: VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS,
          transcriptLength: finalTranscript.transcript.length,
        },
        "voice_turn.final_transcript_timeout",
      );
    }

    // Responses may run for minutes. They must never own the microphone input queue.
    void params.callbacks.onFinalTranscript(finalTranscript).catch(fail);
  }

  function maybeFireFinalTranscript(turn: FinalizingVoiceTurn): void {
    if (turn.fired || turn.committedSegmentIds.length === 0) {
      return;
    }

    const allCommittedSegmentsFinal = turn.committedSegmentIds.every((segmentId) =>
      turn.finalTranscriptSegmentIds.has(segmentId),
    );
    if (allCommittedSegmentsFinal) {
      fireFinalTranscript(turn, "complete");
    }
  }

  async function reconnectSttSession(): Promise<void> {
    if (stopped) return;
    const previousSession = sttSession;
    sttSession = null;
    sttResampler = null;
    sttInputRate = 0;
    previousSession?.close();

    try {
      const nextSession = createSttSession();
      sttSession = nextSession;
      await nextSession.connect();
      if (stopped) {
        nextSession.close();
        return;
      }
      params.logger.info("voice_turn.stt_reconnected");
    } catch (error) {
      if (stopped) return;
      fail(error);
      params.logger.warn({ err: error }, "voice_turn.stt_reconnect_failed");
    }
  }

  function handleSttError(error: unknown): void {
    if (stopped) return;
    fail(error);
    params.logger.warn({ err: error }, "voice_turn.stt_error");
    if (reconnectAttemptedForTurn) {
      sttSession?.close();
      sttSession = null;
      return;
    }

    reconnectAttemptedForTurn = true;
    void runSerial(reconnectSttSession);
  }

  function handleFinalSttTranscript(event: StreamingTranscriptionEvent): void {
    const turn = getFinalizingTurnForSegment(event.segmentId);
    if (!turn || turn.fired) {
      return;
    }

    turn.transcriptsBySegmentId.set(event.segmentId, event.transcript);
    turn.finalTranscriptSegmentIds.add(event.segmentId);
    turn.transcriptMetaBySegmentId.set(event.segmentId, {
      ...(event.language ? { language: event.language } : {}),
      ...(event.avgLogprob !== undefined ? { avgLogprob: event.avgLogprob } : {}),
      ...(event.isLowConfidence !== undefined ? { isLowConfidence: event.isLowConfidence } : {}),
    });
    maybeFireFinalTranscript(turn);
  }

  function handlePartialSttTranscript(event: StreamingTranscriptionEvent): void {
    if (state.status !== "capturing" || (!params.continuousTranscripts && partialTranscriptFired)) {
      return;
    }

    if (sealedTranscriptSegmentIds.has(event.segmentId)) {
      return;
    }

    if (activeTranscriptSegmentId && event.segmentId !== activeTranscriptSegmentId) {
      return;
    }

    const transcript = event.transcript.trim();
    if (!transcript) {
      return;
    }

    activeTranscriptSegmentId = event.segmentId;

    if (isFillerOnlyPartial(transcript)) {
      return;
    }

    firePartialTranscript(event.segmentId, transcript);
  }

  function handleSttTranscript(event: StreamingTranscriptionEvent): void {
    if (stopped) return;
    if (event.isFinal) {
      handleFinalSttTranscript(event);
      return;
    }

    handlePartialSttTranscript(event);
  }

  function createSttSession(): StreamingTranscriptionSession {
    const session = params.stt.createSession({
      logger: params.logger.child({ component: "stt" }),
      language: params.sttLanguage ?? "en",
    });
    session.on("transcript", handleSttTranscript);
    session.on("committed", ({ segmentId }) => {
      if (stopped) return;
      sealedTranscriptSegmentIds.add(segmentId);
      // A worker acknowledgement can arrive after the next utterance starts.
      // Assign it to the oldest outstanding commit, never the new live input.
      const turn =
        [...finalizingTurns.values()].find(
          (candidate) => candidate.committedSegmentIds.length === 0,
        ) ?? currentFinalizingTurn;
      if (turn && !turn.committedSegmentIds.includes(segmentId)) {
        turn.committedSegmentIds.push(segmentId);
        maybeFireFinalTranscript(turn);
      }
    });
    session.on("error", handleSttError);
    return session;
  }

  function runSerial(task: () => Promise<void>): Promise<void> {
    queued = queued.then(task).catch((error) => {
      fail(error);
    });
    return queued;
  }

  function updateDetectorResampler(parsedInputRate: number): void {
    if (parsedInputRate === inputRate) {
      return;
    }

    inputRate = parsedInputRate;
    resampler =
      inputRate === detector.requiredSampleRate
        ? null
        : new Pcm16MonoResampler({
            inputRate,
            outputRate: detector.requiredSampleRate,
          });
  }

  function updateSttResampler(
    session: StreamingTranscriptionSession,
    parsedInputRate: number,
  ): void {
    if (parsedInputRate === sttInputRate) {
      return;
    }

    sttInputRate = parsedInputRate;
    sttResampler =
      sttInputRate === session.requiredSampleRate
        ? null
        : new Pcm16MonoResampler({
            inputRate: sttInputRate,
            outputRate: session.requiredSampleRate,
          });
  }

  function pcmForDetector(pcm16: Buffer): Buffer {
    return resampler === null ? pcm16 : resampler.processChunk(pcm16);
  }

  function pcmForStt(
    session: StreamingTranscriptionSession,
    pcm16: Buffer,
    detectorPcm16: Buffer,
  ): Buffer {
    if (session.requiredSampleRate === detector.requiredSampleRate) {
      return detectorPcm16;
    }

    if (sttResampler === null) {
      return pcm16;
    }

    return sttResampler.processChunk(pcm16);
  }

  async function handleSpeechStarted(): Promise<void> {
    if (stopped || state.status === "capturing") {
      return;
    }

    await params.callbacks.onSpeechStarted();
    if (stopped) return;

    const startedAt = Date.now();
    activeTranscriptSegmentId = null;
    partialTranscriptFired = false;
    reconnectAttemptedForTurn = false;
    state = {
      status: "capturing",
      utteranceId: uuidv4(),
      startedAt,
    };
    if (params.continuousTranscripts && preroll.length > 0) {
      sttSession?.appendPcm16(preroll);
      preroll = Buffer.alloc(0);
    }
    params.logger.info(
      {
        utteranceId: state.utteranceId,
      },
      "voice_turn.speech_started",
    );
  }

  async function handleSpeechStopped(): Promise<void> {
    if (stopped) return;
    if (state.status !== "capturing") {
      return;
    }

    const turnId = state.utteranceId;
    const startedAt = state.startedAt;
    const endedAt = Date.now();

    state = { status: "listening" };

    const finalizingTurn: FinalizingVoiceTurn = {
      turnId,
      startedAt,
      committedSegmentIds: [],
      transcriptsBySegmentId: new Map(),
      finalTranscriptSegmentIds: new Set(),
      transcriptMetaBySegmentId: new Map(),
      timeout: setTimeout(() => {
        fireFinalTranscript(finalizingTurn, "timeout");
      }, VOICE_FINAL_TRANSCRIPT_TIMEOUT_MS),
      fired: false,
    };
    currentFinalizingTurn = finalizingTurn;
    finalizingTurns.set(turnId, finalizingTurn);

    detector.reset();
    try {
      sttSession?.commit();
    } catch (error) {
      handleSttError(error);
    }

    await params.callbacks.onSpeechStopped();

    params.logger.info(
      {
        utteranceAgeMs: Math.max(0, endedAt - startedAt),
      },
      "voice_turn.speech_stopped",
    );
  }

  detector.on("speech_started", () => {
    void runSerial(handleSpeechStarted);
  });
  detector.on("speech_stopped", () => {
    void runSerial(handleSpeechStopped);
  });
  detector.on("error", fail);

  return {
    async start(): Promise<void> {
      if (stopped) throw new Error("Voice input controller is stopped");
      const session = createSttSession();
      sttSession = session;
      await session.connect();
      if (stopped) {
        session.close();
        throw new Error("Voice input stopped during startup");
      }
      await detector.connect();
      if (stopped) {
        detector.close();
        throw new Error("Voice input stopped during startup");
      }
      state = { status: "listening" };
    },

    async stop(): Promise<void> {
      stopped = true;
      // Start/reconnect may be waiting on provider setup outside the serial
      // cleanup. Release those resources now instead of waiting for setup.
      detector.close();
      sttSession?.close();
      await runSerial(async () => {
        clearFinalizingTurnTimeout();
        detector.close();
        sttSession?.close();
        resampler?.reset();
        sttResampler?.reset();
        resampler = null;
        sttResampler = null;
        sttSession = null;
        preroll = Buffer.alloc(0);
        currentFinalizingTurn = null;
        finalizingTurns.clear();
        sealedTranscriptSegmentIds.clear();
        state = { status: "idle" };
      });
    },

    async appendClientChunk(input): Promise<void> {
      await runSerial(async () => {
        if (stopped || state.status === "idle") {
          return;
        }

        const pcm16 = Buffer.from(input.audioBase64, "base64");
        if (pcm16.length === 0) {
          return;
        }

        const parsedInputRate =
          parsePcmRateFromFormat(input.format, detector.requiredSampleRate) ??
          detector.requiredSampleRate;

        updateDetectorResampler(parsedInputRate);
        const currentSttSession = sttSession;
        if (currentSttSession) {
          updateSttResampler(currentSttSession, parsedInputRate);
        }

        const detectorPcm16 = pcmForDetector(pcm16);
        const sttPcm16 = currentSttSession
          ? pcmForStt(currentSttSession, pcm16, detectorPcm16)
          : null;
        if (detectorPcm16.length === 0 && (!sttPcm16 || sttPcm16.length === 0)) {
          return;
        }

        if (detectorPcm16.length > 0) {
          detector.appendPcm16(detectorPcm16);
        }

        if (sttPcm16 && sttPcm16.length > 0) {
          try {
            if (params.continuousTranscripts && state.status !== "capturing") {
              // Keep the start of a word while VAD confirms speech, without
              // repeatedly decoding a quiet room between utterances.
              const joined = Buffer.concat([preroll, sttPcm16]);
              const limit = (currentSttSession?.requiredSampleRate ?? 16000) * 2;
              preroll = joined.subarray(Math.max(0, joined.length - limit));
            } else {
              currentSttSession?.appendPcm16(sttPcm16);
            }
          } catch (error) {
            handleSttError(error);
          }
        }
      });
    },
  };
}
