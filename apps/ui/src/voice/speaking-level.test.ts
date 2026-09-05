import { describe, expect, it } from "vitest";
import { pcm16Rms } from "./speaking-level";

function pcm(samples: number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

describe("pcm16Rms", () => {
  it("reads silence as zero", () => {
    expect(pcm16Rms(pcm([0, 0, 0, 0]))).toBe(0);
  });

  it("has nothing to measure in an empty or half-sample buffer", () => {
    expect(pcm16Rms(new Uint8Array(0))).toBe(0);
    expect(pcm16Rms(new Uint8Array(1))).toBe(0);
  });

  it("rises with amplitude and clamps rather than exceeding one", () => {
    const quiet = pcm16Rms(pcm([1000, -1000, 1000, -1000]));
    const loud = pcm16Rms(pcm([12000, -12000, 12000, -12000]));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(pcm16Rms(pcm([32767, -32768, 32767, -32768]))).toBe(1);
  });

  // Speech RMS sits far below full scale, so an unscaled value would barely
  // move the ring. A normal speaking level should land in the ring's upper half.
  it("puts a speaking-level signal in the upper half of the range", () => {
    expect(
      pcm16Rms(pcm(Array.from({ length: 64 }, (_, i) => (i % 2 ? 6000 : -6000)))),
    ).toBeGreaterThan(0.5);
  });
});
