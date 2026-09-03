import type { NotificationAudio } from "@fde/protocol/messages";
import type { AudioPlaybackSource } from "@/voice/audio-engine-types";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = new Uint8Array(256);
for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
  BASE64_LOOKUP[BASE64_ALPHABET.charCodeAt(i)] = i;
}

export function decodeBase64(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)];
    const b = BASE64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = BASE64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = BASE64_LOOKUP[clean.charCodeAt(i + 3)];
    if (byteIndex < bytes.length) bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (byteIndex < bytes.length) bytes[byteIndex++] = ((b & 15) << 4) | (c >> 2);
    if (byteIndex < bytes.length) bytes[byteIndex++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

export class UnsupportedAlertAudioError extends Error {
  constructor(public readonly mimeType: string) {
    super(`Unsupported alert audio: ${mimeType}`);
    this.name = "UnsupportedAlertAudioError";
  }
}

interface WavPcm {
  sampleRate: number;
  pcm: Uint8Array;
}

function ascii(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** Pulls the PCM16 mono payload out of a RIFF/WAVE file; the audio engine only plays raw PCM. */
export function parsePcm16MonoWav(bytes: Uint8Array): WavPcm {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || ascii(view, 0) !== "RIFF" || ascii(view, 8) !== "WAVE") {
    throw new UnsupportedAlertAudioError("audio/wav (bad header)");
  }
  let offset = 12;
  let sampleRate: number | null = null;
  let pcm: Uint8Array | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = Math.min(start + size, bytes.byteLength);
    if (id === "fmt ") {
      const audioFormat = view.getUint16(start, true);
      const channels = view.getUint16(start + 2, true);
      const bitsPerSample = view.getUint16(start + 14, true);
      if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16) {
        throw new UnsupportedAlertAudioError(
          `audio/wav (format=${audioFormat} channels=${channels} bits=${bitsPerSample})`,
        );
      }
      sampleRate = view.getUint32(start + 4, true);
    } else if (id === "data") {
      pcm = bytes.subarray(start, end);
    }
    offset = end + (size % 2);
  }
  if (sampleRate === null || pcm === null) {
    throw new UnsupportedAlertAudioError("audio/wav (missing chunks)");
  }
  return { sampleRate, pcm };
}

function toPlaybackSource(bytes: Uint8Array, type: string): AudioPlaybackSource {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return {
    arrayBuffer: () => Promise.resolve(buffer),
    size: bytes.byteLength,
    type,
  };
}

/**
 * WAV becomes raw PCM with its rate in the type, which both audio engines play. Other
 * codecs are handed over as-is: the web engine decodes them, the native one cannot.
 */
export function toAlertPlaybackSource(
  audio: NotificationAudio,
  options: { canDecodeCodecs: boolean },
): AudioPlaybackSource {
  const bytes = decodeBase64(audio.base64);
  const mimeType = audio.mimeType.toLowerCase();
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") {
    const { sampleRate, pcm } = parsePcm16MonoWav(bytes);
    return toPlaybackSource(pcm, `audio/pcm;rate=${sampleRate}`);
  }
  if (mimeType.startsWith("audio/pcm")) {
    return toPlaybackSource(bytes, mimeType);
  }
  if (!options.canDecodeCodecs) {
    throw new UnsupportedAlertAudioError(audio.mimeType);
  }
  return toPlaybackSource(bytes, mimeType);
}
