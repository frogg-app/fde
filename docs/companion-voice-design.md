# Companion voice follow-ups

Implementation status reviewed 2026-09-12. These changes follow the initial
Companion release in 0.2.0; they do not establish end-to-end voice quality.

## Integrated fixes

- VAD speech onset interrupts the turn immediately, without waiting for an STT
  partial. Audio and fillers that arrive while the user speaks are suppressed.
- An abandoned orchestrator generator records the interrupted exchange in a
  `finally` block, so the next turn retains conversational context.
- The first speakable segment can end at a natural boundary after 16 characters;
  later segments retain the 40-character minimum and prefer sentence boundaries.
- The glass sphere continuously flows while the microphone is live, including
  during thinking. Capture drives its outer glow and scale; per-chunk PCM loudness
  drives its inner light independently. Playback stop resets the reply level.
- Listening stays visible alongside a secondary Thinking/Speaking label. Muting
  dims the sphere and removes the live indicator. Connecting/reconnecting do not
  claim to be listening. Reduced motion disables rotation/scale animation while
  retaining microphone brightness feedback. Transform/opacity animations use
  the native driver on Android/iOS, stop on unmount and do not block interactions.
- Audio-level subscriptions live inside the voice surface so microphone updates
  do not rerender the transcript, controls or task list.

Regression coverage lives in the Companion session, orchestrator, speech-stream,
and client runtime tests, plus `apps/ui/src/voice/speaking-level.test.ts`.

## Current lifecycle implementation (2026-09-12)

Backend abort now propagates to Claude SDK interrupt, Codex turn interrupt and
API request abort. Session generations reject late startup/audio; shutdown is
bounded. Canonical history credits completely played segments, with provider
context reconstructed after interruption. Local synthesis prepares the next
segment while playback continues. See [Companion](companion.md).

## Conversational input and quiet replies (2026-09-12)

The microphone/VAD queue no longer awaits final-transcript response callbacks.
Recognition emits growing partials, and VAD runs independently from synchronous
Parakeet decoding and TTS. Finalizing utterances retain their own buffers and IDs
when another utterance begins. Default endpointing tolerates 1.4 seconds of silence
and confirms interruption after 120ms of detected speech, plus Silero's internal
window and transport delay; this is not a measured 120ms playback-stop claim.

Quiet mode suppresses dispatch narration and fillers, then speaks verified results,
failures and permissions. Settings select longer pauses, reply length, announcements
and optional acknowledgements. Dismissal minimizes; End releases the session.
The real local regression sends microphone-paced fixture PCM through independent
VAD/STT workers, inserts a short pause, and holds the first reply callback open
while recognizing a second utterance. See [validation](companion-validation.md).

## Legacy launcher active-writer incident (2026-09-12)

The screenshot's thread ID matches daemon logs from 0.2.10 and 0.3.0 reporting
`set_voice_mode failed`. That legacy RPC calls `reloadAgentSession`, which starts
its replacement Codex process before closing the original writer. It can also
interrupt the worker as part of the reload. This is not the Companion startup RPC.

The contextual launcher on `feature/companion-voice-hands-free` sends
`companion.session.start.request` and passes the selected worker as observation
context. `watch-agent.test.ts` exercises running Claude and Codex workers with
pending permissions and checks that the original session is retained without any
reload/resume/cancel calls. Ending Companion retains the task receipt. Install the
matching preview client and daemon; merely updating the daemon does not change an
older client's launcher. The legacy generic reload transaction remains separate
work; this preview does not claim to fix arbitrary Codex Reload-agent operations.

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
