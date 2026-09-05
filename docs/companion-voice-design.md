# Companion voice: what the reference implementations do, and what we take

Written after the 0.2.0 Companion turned out to be unpleasant to talk to: it
spoke over the user, and replies arrived long after they had stopped talking.
This is the research behind the fixes, kept so the next person does not have to
redo it.

Sources are linked inline. Where a claim is inference rather than something a
source states, it says so.

## The headline: do not copy the orb

The full-screen blue orb is the image most people have of ChatGPT voice, and it
is the wrong thing to chase.

- **Nov 2025**: OpenAI moved voice _inside_ the chat. The orb screen became an
  opt-in legacy mode.
  ([TechCrunch](https://techcrunch.com/2025/11/25/chatgpts-voice-mode-is-no-longer-a-separate-interface/))
- **Jul 2026**: GPT-Live replaced Advanced Voice Mode with a **full-duplex**
  model that listens and speaks at the same time.
  ([MacRumors](https://www.macrumors.com/2026/07/08/openai-gpt-live-voice/),
  [teardown](https://blog.risingstack.com/chatgpt-live-new-architecture-of-voice-ai/))

Full duplex dissolves the `listening -> thinking -> speaking` state machine our
orb is built around. GPT-Live signals "I am following you" with _audible_
backchannels -- "mhmm", "yeah", "got it" -- while the user is still speaking,
rather than with a visual state. The stated design principle is worth keeping
even though we cannot ship a full-duplex model: **state must be visible, because
opaque orchestration reads as broken.** A silent "thinking" state is
indistinguishable from a hung one.

The orb's biggest documented flaw is also instructive: it showed no transcript,
so users had to leave voice mode to read the answer. We already show one.

## Turn detection: the single biggest lever

Endpointing is 150-300 ms of a ~600 ms budget, and unlike model latency it is
free to improve.

| System                    | Silence before end-of-turn                 |
| ------------------------- | ------------------------------------------ |
| OpenAI `server_vad`       | **500 ms** (`silence_duration_ms` default) |
| Pipecat Silero            | **200 ms** (`stop_secs`)                   |
| **FDE Companion (0.2.0)** | **1000 ms**                                |

([OpenAI VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad),
[Pipecat](https://docs.pipecat.ai/guides/learn/speech-input))

We sit at double OpenAI's default and five times Pipecat's, and that second is
paid on _every single turn_ before the model is even asked. OpenAI's own note on
the tradeoff: shorter values respond more quickly "but may jump in on short
pauses from the user."

LiveKit publishes the tradeoff curve, which is the most useful data here
([Turn Detector v1.0](https://livekit.com/blog/solving-end-of-turn-detection)):

| Operating point | False-cutoff rate |
| --------------- | ----------------- |
| 300 ms          | 9.9%              |
| 600 ms          | 4.5%              |

Halving the cut-off rate roughly doubles the wait. Fixed silence forces one
global choice for a quantity that genuinely varies per utterance -- which is the
entire argument for semantic endpointing (OpenAI's `semantic_vad`, LiveKit's
turn detector, Pipecat's Smart Turn v3 at 12 ms CPU inference). Those models
consume audio directly rather than a transcript, so they do not pay STT
finalisation latency, and they key on intonation, pace and filler words.

Adopting a semantic turn detector is the largest available win and is out of
scope for the immediate fix. Lowering the fixed threshold is not.

## Barge-in: the full protocol

Stopping playback is the easy half. The half everyone gets wrong is **history**.

The server generates faster than realtime, so at the moment of interruption it
has already produced audio the user will never hear. If nothing reconciles this,
the model believes it said things the user never heard, and will refer back to
them. OpenAI's fix is `conversation.item.truncate` with an `audio_end_ms`
measured from **actual playback position**
([reference](https://developers.openai.com/api/reference/resources/realtime/client-events)):

> Truncating audio will delete the server-side text transcript to ensure there
> is not text in the context that hasn't been heard by the user.

They keep the truncated prefix deliberately, so the model knows where it was cut
off and can answer "what was that last thing?".

**We had the inverse bug.** `remember()` was the last statement in
`CompanionOrchestrator.turn()` with no `try/finally`, so aborting the generator
on barge-in skipped it entirely and discarded _the whole exchange_ -- both the
reply and the user's message that prompted it. Interrupting did not leave the
Companion half-informed; it left it with no record the exchange happened, free
to repeat itself.

Correct ordering on barge-in, cheapest perceptible feedback first:

1. Fade and stop the output device (~10 ms ramp, see below).
2. Flush the queued chunks.
3. Compute what was actually played.
4. Reconcile history to that.

## Echo cancellation

The failure mode is the agent hearing its own speaker output, classifying it as
user speech, and interrupting itself. Defences in order: AEC with a
time-aligned reference stream; half-duplex gating (cheap, but makes barge-in
impossible by construction); and headphones, where there is no acoustic path at
all.

Worth knowing: **double-talk is the hard case.** During a barge-in both parties
speak, and the user's voice sits inside the very signal the canceller is driving
to zero -- so barge-in detection operates on the worst part of the AEC's
performance envelope. ([Coval](https://www.coval.ai/blog/voice-ai-echo-cancellation/))

## Latency techniques, ranked

1. **Turn detection** -- above. Biggest, cheapest, most overlooked.
2. **Asymmetric TTS chunking.** Make the _first_ chunk as small as a natural
   boundary allows, then switch to whole sentences. 2-3 s of playback buys
   enough runway to hide all subsequent latency, and after that you are bounded
   by playback rather than generation, so take the prosody win. Splitting on
   commas throughout gives choppy prosody. We use a flat 40-character minimum
   for every segment including the first.
3. **Preemptive generation.** LiveKit runs the LLM on the partial transcript
   before turn commit, **on by default**; Deepgram Flux reports 100-200 ms saved
   for 50-70% more LLM calls
   ([LiveKit](https://docs.livekit.io/agents/multimodality/audio/)). The win
   scales with how often the speculation survives, so it is good for short
   conversational turns and actively wasteful for dictation or long
   utterances -- LiveKit recommends disabling it there. Anything
   non-idempotent (tool calls, billing) must never run speculatively.
4. **TTS time to first byte.** Nearly all of a TTS turn's latency is the first
   byte; everything after streams while the user is already listening. Optimise
   TTFB, ignore total throughput above realtime.
5. **Fillers.** Defensible as cover for a genuinely long operation, where a
   human would also say "let me check". Poor as a blanket latency mask: it
   becomes a verbal tic and papers over a pipeline that should have been fixed.
   Prefer event-driven (fire only past ~1 s) over per-turn.

Reference budget for a cascaded pipeline, end-of-speech to first audio: network
30-80 ms, VAD 150-300 ms, LLM TTFT 150-400 ms, TTS 100-200 ms, so **~600 ms**
total. Human conversation turn gaps are ~230 ms; under 500 ms feels natural and
over 800 ms feels like a bad phone line.

## Playback

- **20 ms frames** are the WebRTC/telephony convention.
- Keep the jitter buffer **shallow**: every buffered millisecond is divergence
  between what the model thinks it said and what the user heard.
- Track playback position from the **audio clock** -- frames actually consumed
  by the output device -- never from the receive clock, which runs ahead by the
  buffer depth. Measuring from the receive timeline is the most common cause of
  the assistant "remembering" things the user never heard.
- **Never hard-cut.** A truncated non-zero sample is a broadband impulse and
  clicks. Apply a 5-20 ms fade before dropping the queue, and count the faded
  region as played.
- Budget: TTS audio should stop within ~60 ms of barge-in firing.

## The visual, given all of the above

Two independent amplitude scalars, not one:

- `micLevel` -- RMS of the user's input.
- `ttsLevel` -- RMS of the assistant's output.

Ours only ever had the first, so the orb was inert while the Companion spoke.
Smooth each with an **asymmetric envelope follower** -- fast attack (~30-50 ms),
slow release (~200-300 ms) -- or the orb strobes on consonants.

`thinking` has no audio to drive it, so it needs self-driven motion that is
_different in kind_ from the amplitude-reactive states, so the user reads "not
waiting on me" rather than "not hearing me".

For provisional text, OpenAI's own realtime demo inserts a `[Transcribing...]`
placeholder and renders bracketed titles **italic and muted**, replacing it in
place as deltas arrive. Same bubble, provisional styling, normal weight when
final. Their docs are also blunt that transcripts cannot be precisely aligned to
audio and "may not exactly match what the user or ChatGPT said" -- so they are
not a verbatim record.

Connecting deserves an explicit, visibly disabled state; their demo models it as
`DISCONNECTED | CONNECTING | CONNECTED` with the control disabled mid-connect.
