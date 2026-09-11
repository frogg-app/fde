/**
 * How loudly the Companion is talking, taken from the PCM it is about to play.
 *
 * The orb needs two independent amplitudes, not one: the microphone while the
 * user speaks, and the reply while the Companion does. Driving it from capture
 * alone left it inert for the whole half of the conversation the user is
 * listening to. See docs/companion-voice-design.md.
 */

/** Signed 16-bit PCM, little endian, which is what the daemon sends. */
export function pcm16Rms(bytes: Uint8Array): number {
  const sampleCount = Math.floor(bytes.length / 2);
  if (sampleCount === 0) {
    return 0;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i += 1) {
    const sample = view.getInt16(i * 2, true) / 32768;
    sumSquares += sample * sample;
  }
  // Speech RMS sits well below 1.0, so the raw value would barely move the ring.
  // 3.5x puts a normal speaking level near the top of the range without
  // clipping quiet passages to zero.
  return Math.min(1, Math.sqrt(sumSquares / sampleCount) * 3.5);
}
