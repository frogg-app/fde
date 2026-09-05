import { Buffer } from "buffer";
import type { AudioPlaybackSource } from "@/voice/audio-engine-types";

/**
 * The daemon names an audio format ("pcm", "mp3", "wav"); the audio engines want
 * a MIME type. Both the voice runtime and the Companion runtime decode the same
 * base64 frames off the wire, so the mapping lives here rather than in each.
 */
export function toAudioPlaybackSource(bytes: Uint8Array, format: string): AudioPlaybackSource {
  return {
    size: bytes.byteLength,
    type: audioMimeType(format),
    async arrayBuffer() {
      return Uint8Array.from(bytes).buffer;
    },
  };
}

export function decodeAudioChunk(base64: string): Uint8Array {
  return Buffer.from(base64, "base64");
}

function audioMimeType(format: string): string {
  if (format === "pcm") return "audio/pcm;rate=24000;bits=16";
  if (format === "mp3") return "audio/mpeg";
  return `audio/${format}`;
}
