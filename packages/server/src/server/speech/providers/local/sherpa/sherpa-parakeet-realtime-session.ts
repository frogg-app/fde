import { EventEmitter } from "node:events";
import { v4 as uuidv4 } from "uuid";
import type { StreamingTranscriptionSession } from "../../../speech-provider.js";
import { pcm16lePeakAbs, pcm16leToFloat32 } from "../../../audio.js";
import type { SherpaOfflineRecognizerEngine } from "./sherpa-offline-recognizer.js";

type Recognizer = Pick<
  SherpaOfflineRecognizerEngine,
  "sampleRate" | "createStream" | "acceptWaveform" | "recognizer"
>;
interface Segment {
  id: string;
  pcm: Buffer;
  prefix: string;
  text: string;
}

/** Decoding stays in the STT worker. Capture, VAD and synthesis have independent queues. */
export class SherpaParakeetRealtimeTranscriptionSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  public readonly requiredSampleRate: number;
  private readonly engine: Recognizer;
  private readonly minDecodeIntervalMs: number;
  private current: Segment | null = null;
  private previousSegmentId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private readonly pending: { segment: Segment; final: boolean }[] = [];

  constructor(params: { engine: Recognizer; minDecodeIntervalMs?: number }) {
    super();
    this.engine = params.engine;
    this.requiredSampleRate = params.engine.sampleRate;
    this.minDecodeIntervalMs = params.minDecodeIntervalMs ?? 400;
  }
  async connect(): Promise<void> {
    this.current ??= this.newSegment();
  }
  private newSegment(): Segment {
    return { id: uuidv4(), pcm: Buffer.alloc(0), prefix: "", text: "" };
  }
  appendPcm16(chunk: Buffer): void {
    const segment = this.current;
    if (!segment) return;
    segment.pcm = Buffer.concat([segment.pcm, chunk]);
    if (this.timer || this.pending.some((job) => job.segment === segment)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.current === segment) this.enqueue(segment, false);
    }, this.minDecodeIntervalMs);
  }
  commit(): void {
    const segment = this.current;
    if (!segment) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Rotate before decoding: new microphone frames cannot be erased by an old final.
    this.current = this.newSegment();
    const previousSegmentId = this.previousSegmentId;
    this.previousSegmentId = segment.id;
    this.emit("committed", { segmentId: segment.id, previousSegmentId });
    this.enqueue(segment, true);
  }
  clear(): void {
    this.close();
    this.current = this.newSegment();
  }
  close(): void {
    this.current = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.scheduled) clearImmediate(this.scheduled);
    this.timer = null;
    this.scheduled = null;
    this.pending.length = 0;
  }
  private enqueue(segment: Segment, final: boolean): void {
    this.pending.push({ segment, final });
    this.schedule();
  }
  private schedule(): void {
    if (this.scheduled || this.pending.length === 0 || !this.current) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      const job = this.pending.shift();
      if (job && (job.final || job.segment === this.current)) {
        try {
          const text = this.decodeSegment(job.segment);
          if (job.final || text !== job.segment.text) {
            job.segment.text = text;
            this.emit("transcript", {
              segmentId: job.segment.id,
              transcript: text,
              isFinal: job.final,
            });
          }
        } catch (error) {
          this.emit("error", error instanceof Error ? error : new Error(String(error)));
        }
      }
      this.schedule();
    });
  }
  private decodeSegment(segment: Segment): string {
    // Bound repeated offline decoding for long speech; accumulate completed portions.
    const windowBytes = this.requiredSampleRate * 2 * 20;
    while (segment.pcm.length > windowBytes) {
      segment.prefix = [segment.prefix, this.decodeNow(segment.pcm.subarray(0, windowBytes))]
        .filter(Boolean)
        .join(" ");
      segment.pcm = segment.pcm.subarray(windowBytes);
    }
    return [segment.prefix, this.decodeNow(segment.pcm)].filter(Boolean).join(" ");
  }
  private decodeNow(pcm16: Buffer): string {
    if (pcm16.length === 0) {
      return "";
    }

    const peak = pcm16lePeakAbs(pcm16);
    const peakFloat = peak / 32768.0;
    const targetPeak = 0.6;
    const maxGain = 50;
    const gain =
      peakFloat > 0 && peakFloat < targetPeak ? Math.min(maxGain, targetPeak / peakFloat) : 1;

    const stream = this.engine.createStream();
    try {
      const floatSamples = pcm16leToFloat32(pcm16, gain);
      this.engine.acceptWaveform(stream, this.engine.sampleRate, floatSamples);
      this.engine.recognizer.decode(stream);
      const result = this.engine.recognizer.getResult(stream);
      return String(
        (typeof result === "object" && result && "text" in result ? result.text : undefined) ??
          result ??
          "",
      ).trim();
    } finally {
      try {
        stream.free?.();
      } catch {
        // ignore
      }
    }
  }
}
