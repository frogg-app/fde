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

## Current lifecycle implementation (2026-09-12)

Backend abort now propagates to Claude SDK interrupt, Codex turn interrupt and
API request abort. Session generations reject late startup/audio; shutdown is
bounded. Canonical history credits completely played segments, with provider
context reconstructed after interruption. Local synthesis prepares the next
segment while playback continues. See [Companion](companion.md).

## Remaining limitations

- Partial segments are omitted conservatively; there is no word-level playback
  reconciliation or physical device audio-clock acknowledgement.
- Native voice result delivery is not yet correlated to individual durable jobs,
  so unconfirmed results may repeat after reconnect.
- Echo cancellation, interruption latency and microphone-to-speaker latency need
  physical-device tests. Native background declarations/service code are not
  device qualification. See [validation](companion-validation.md).

## Next acceptance pass

1. Test API and CLI backends with a microphone and headphones; record device,
   backend, speech provider, end-of-speech time, and first audible reply time.
2. Interrupt during model generation, synthesis, and playback. Verify output
   stops, the next turn starts promptly, and history does not claim unheard text.
3. Repeat with speakers to assess echo-induced false interruptions.
4. Exercise reconnect, mute, backend failure, and unavailable speech models.

Keep these gaps in [ROADMAP.md](../ROADMAP.md) until the evidence is recorded.
