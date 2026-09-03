import { describe, expect, it } from "vitest";
import {
  UnsupportedAlertAudioError,
  decodeBase64,
  parsePcm16MonoWav,
  toAlertPlaybackSource,
} from "./audio";

function wavBytes(sampleRate: number, samples: number[]): Uint8Array {
  const pcm = new Uint8Array(new Int16Array(samples).buffer);
  const bytes = new Uint8Array(44 + pcm.length);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length, true);
  bytes.set(pcm, 44);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("decodeBase64", () => {
  it("decodes with and without padding", () => {
    expect(Array.from(decodeBase64("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(decodeBase64("AQI="))).toEqual([1, 2]);
    expect(Array.from(decodeBase64("AQ=="))).toEqual([1]);
    expect(Array.from(decodeBase64(""))).toEqual([]);
  });
});

describe("parsePcm16MonoWav", () => {
  it("returns the sample rate and PCM payload", () => {
    const parsed = parsePcm16MonoWav(wavBytes(24000, [0, 1000, -1000]));
    expect(parsed.sampleRate).toBe(24000);
    expect(Array.from(new Int16Array(parsed.pcm.buffer, parsed.pcm.byteOffset, 3))).toEqual([
      0, 1000, -1000,
    ]);
  });

  it("rejects non-WAV bytes", () => {
    expect(() => parsePcm16MonoWav(new Uint8Array([1, 2, 3]))).toThrow(UnsupportedAlertAudioError);
  });
});

describe("toAlertPlaybackSource", () => {
  it("turns WAV into a raw PCM source the audio engines play at the right rate", async () => {
    const source = toAlertPlaybackSource(
      { base64: toBase64(wavBytes(16000, [5, 6])), mimeType: "audio/wav" },
      { canDecodeCodecs: false },
    );
    expect(source.type).toBe("audio/pcm;rate=16000");
    expect(source.size).toBe(4);
    expect(Array.from(new Int16Array(await source.arrayBuffer()))).toEqual([5, 6]);
  });

  it("passes codecs through only where the engine can decode them", () => {
    const mp3 = { base64: toBase64(new Uint8Array([9, 9])), mimeType: "audio/mpeg" };
    expect(toAlertPlaybackSource(mp3, { canDecodeCodecs: true }).type).toBe("audio/mpeg");
    expect(() => toAlertPlaybackSource(mp3, { canDecodeCodecs: false })).toThrow(
      UnsupportedAlertAudioError,
    );
  });
});
