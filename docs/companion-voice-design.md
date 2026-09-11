# Companion voice follow-ups

Implementation status reviewed 2026-09-11. These changes follow the initial
Companion release in 0.2.0; they do not establish end-to-end voice quality.

## Integrated fixes

- VAD speech onset interrupts the turn immediately, without waiting for an STT
  partial. Audio and fillers that arrive while the user speaks are suppressed.
- An abandoned orchestrator generator records the interrupted exchange in a
  `finally` block, so the next turn retains conversational context.
- The first speakable segment can end at a natural boundary after 16 characters;
  later segments retain the 40-character minimum and prefer sentence boundaries.
- The orb uses microphone level while listening and per-chunk PCM loudness while
  playing a reply. Playback stop resets the reply level.

Regression coverage lives in the Companion session, orchestrator, speech-stream,
and client runtime tests, plus `apps/ui/src/voice/speaking-level.test.ts`.

## Remaining limitations

- The session abort signal does not cancel the in-flight backend request. The
  turn queue can still wait for the model to yield before it accepts a new turn.
- Interrupted history uses text handed to TTS as an approximation of what was
  heard. It has no playback-position reconciliation: failed synthesis, queued
  segments, and partially played segments can overstate what reached the user.
  A model turn completed before playback interruption retains the full reply.
- Reply loudness is sampled per chunk, not from the output device's audio clock.
  Verify supported audio formats and smooth the level only if device testing
  demonstrates a visual problem.
- Echo cancellation, interruption latency, and microphone-to-speaker latency
  need testing on real devices. Backend-only timing is not a full-loop measure.

## Next acceptance pass

1. Test API and CLI backends with a microphone and headphones; record device,
   backend, speech provider, end-of-speech time, and first audible reply time.
2. Interrupt during model generation, synthesis, and playback. Verify output
   stops, the next turn starts promptly, and history does not claim unheard text.
3. Repeat with speakers to assess echo-induced false interruptions.
4. Exercise reconnect, mute, backend failure, and unavailable speech models.

Keep these gaps in [ROADMAP.md](../ROADMAP.md) until the evidence is recorded.
