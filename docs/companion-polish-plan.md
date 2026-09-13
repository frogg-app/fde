# Companion: light, voice and deliberate opt-in

Design and implementation pass, 2026-09-12. Companion remains a preview. The
running daemon must never be stopped or restarted for this work. Tests use
isolated processes, state and ports. The reported Android startup crash is still
unresolved; a successful export is not a native launch qualification.

## Experience

Companion should feel like a responsive presence while a person works. Its centre
is an abstract field of light: translucent cyan, violet and pearl ribbons folding
around a luminous core, with drifting particles and breathing depth. No central
microphone icon, hard circular frame or spinner. Its silhouette extends beyond
a perfect circle. Controls remain clear, labelled and separate from the art.

Listening remains visible during thinking and speech. Input energy changes the
outer field; delivered speech changes the inner field. Muting removes the live
indicator and dims the field. Reduced motion stops continuous movement while
preserving energy feedback. Connection states never claim to hear the user.
Motion must not trigger layout or rerender the transcript at audio frequency.
Use the existing native animation driver and SVG layers, avoiding a new shader
runtime or a web-only animation that disappears on Android.

The conversation surface should put the presence first, then a centred live
transcript, then compact actions. Host/project context remains in the header.
A minimized conversation keeps a small living presence and explicit End action.
The composer launcher should visually belong to this same feature, rather than
look like the legacy voice-mode microphone.

## Opt-in contract

The app's absent, invalid and legacy settings resolve to Companion off. Existing
explicit user opt-in remains respected. Settings explains that this is an
experimental feature and enabling it only reveals the launcher. Disabled clients
do not start sessions or request audio. The daemon feature flag defaults on
independently of installed speech models; authentication and speech readiness are
separate actionable capabilities. Explicit administrator disable and the voice
umbrella remain authoritative. No inference or model download merely from the
feature flag being on.

## Voice direction

The default is **Kitten TTS nano 0.8 FP32, Rosie (speaker 5)** through the
existing isolated sherpa worker. The archive is 63,815,222 bytes (about 61 MiB).
The [upstream Kitten project](https://github.com/KittenML/KittenTTS) and
[model repository](https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32)
provide the voice mapping and Apache-2.0 model licensing. Preserve bundled
phonemizer notices separately; see [speech model notices](speech-model-notices.md).

Corrected a native configuration mismatch: sherpa reads thread count and execution
provider inside `model`, whereas the previous wrapper passed them at the root.
Kokoro 1.0 INT8 still took 5.00–7.81 seconds for three short replies with corrected
two-thread configuration. Kitten FP32 was faster than its INT8 variant on this
reference CPU and is the chosen natural-voice candidate. Piper remains the
explicit low-latency alternative; existing configured models and voices win.
Kokoro 1.0 is also available explicitly, with English pronunciation lexicons.
There is no paid API fallback.

Measured with the real isolated speech worker on Linux x64, Node 22.23.2,
QEMU Virtual CPU 2.5+, two inference threads:

| Voice             | Warm samples | Median first PCM |     p95 |             Cold first PCM |
| ----------------- | -----------: | ---------------: | ------: | -------------------------: |
| Kitten FP32 Rosie |           30 |          1.205 s | 1.491 s |                    2.129 s |
| Piper LJSpeech    |            9 |          0.461 s | 0.550 s | See generated results.json |

These measure synthesis plus worker transport, not microphone-to-speaker latency.
All samples were non-silent and unclipped. Three additional Rosie recordings were
transcribed correctly by Parakeet modulo punctuation/number formatting. These
checks do not establish human-perceived naturalness, phone playback quality, or
end-to-end latency. The downloadable A/B recordings are the listening review.
English is the initial qualification language.

Reproduce without provider accounts or daemon access:

```sh
node --import tsx scripts/dev/companion-speech-benchmark.mts --download --samples 30
node scripts/dev/companion-design-preview.mjs
```

The first command writes isolated models, WAV samples and results under
`.dev/companion-speech-benchmark`. The design harness writes an interactive
simulated conversation and phone/desktop screenshots under
`.dev/companion-design-preview`; it uses the real presence and store, with a theme
bridge for standalone rendering. For its A/B players, run benchmarks with
`--out-dir .dev/companion-polish-audio/rosie` and, for the older voice,
`--model piper-ljspeech-medium --out-dir .dev/companion-polish-audio/piper`.
The harness never captures a microphone or connects to a daemon. Its simulated
state buttons are review tools, not additional product controls.

Keep natural sentence phrasing and avoid speaking markdown syntax. Preserve the
separate synthesis process and bounded overlap with playback. Expose useful
voice configuration through existing host settings or clear setup instructions;
never present a client preference that the daemon ignores.

## Execution and acceptance

1. Verify opt-in storage/loading and all launch gates. Make daemon enablement
   independent from readiness and test explicit disable precedence.
2. Implement the flowing light artwork, continuous independent motion, quieter
   conversation layout and matching launcher/minimized presence. Capture real
   components at phone and desktop sizes in light/dark and reduced-motion states.
3. Probe new speech models and voices, fix runtime configuration issues, add the
   selected model to the supported downloader/provider path, and record latency
   and shareable audio samples. Test defaults and preservation of overrides.
4. Run focused UI/runtime/speech tests and full typecheck. Document measured
   evidence and remaining native-device gaps. Do not replace the Android APK with
   a claimed fix until its reported launch failure has been diagnosed.

The design preview and sample recordings should make this iteration reviewable
without needing to replace or restart the main daemon.

## Verification outcome

- 124 targeted server tests, 163 settings/runtime/locale tests and nine real-browser
  animation tests pass. Full repository typecheck passes.
- Captured the actual presence at 390px and 1280px widths. Earlier light-theme
  capture also passed; the final artwork surface intentionally stays deep navy
  in either app theme. Browser checks cover thinking, microphone energy, muted
  playback, reduced motion and the device animation override.
- Main daemon and its configuration were untouched. Tests only launch their own
  speech workers and ephemeral browser-preview HTTP server.
- Android startup crash remains undiagnosed; no replacement APK or native launch
  claim is made by this visual/speech pass. Physical-device accessibility,
  battery use and 30-minute background audio remain qualification work.
