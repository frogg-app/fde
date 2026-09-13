# Companion to-do

Outstanding Companion work as of 2026-09-13. Device acceptance is also tracked
in [ROADMAP.md](../ROADMAP.md); design context is in
[companion-voice-design.md](companion-voice-design.md).

## Settings page

- [ ] Group the Companion settings page into Voice, Conversation and Appearance.
- [ ] Interrupt delay setting. The daemon confirms barge-in after a fixed 120ms
      of speech; expose presets like the existing pause setting.
- [ ] Conversation model picker. The model is resolved on the daemon (API key or
      CLI backend) and the page only displays it. Needs a new RPC and a
      `server_info.features` gate so older daemons don't show the picker.

## Device acceptance

- [ ] Microphone + headphones on API and CLI backends; record end-of-speech to
      first audible reply.
- [ ] Interrupt during generation, synthesis and playback; output stops and
      history does not claim unheard text.
- [ ] Speakers, to check echo-induced false interruptions.
- [ ] Reconnect, mute, backend failure and missing speech models.

## Known gaps

- [ ] Correlate native voice results with durable jobs so results are not
      repeated after reconnect.
- [ ] Word-level playback reconciliation for interrupted replies.
- [ ] Echo cancellation checks on physical devices.
- [ ] The generic "Reload agent" transaction can still start a second writer
      before closing the first (separate from Companion launch).

## Unrelated issues found along the way

- [ ] The daemon on the dev VM (0.6.13, `0.0.0.0:9999`, web UI enabled) returns
      404 for `/`.
