# Voice

Voice in an FDE has three parts: dictation (speech to text into the composer), voice mode (a
realtime conversation with an agent), and spoken alerts (the daemon reads agent notifications
aloud and lets you answer by voice). Dictation and voice mode are inherited from Paseo; this
page documents spoken alerts and the settings that govern all three.

## Daemon settings

The daemon resolves every voice feature the same way (`server/speech/speech-config-resolver.ts`,
`resolveVoiceFeatureEnabled`):

1. `PASEO_VOICE=0` or `features.voice.enabled=false` turns everything off.
2. The feature's own key wins next.
3. `PASEO_VOICE=1` / `features.voice.enabled=true` turns the feature on.
4. Otherwise the feature is on when the local speech runtime (`sherpa-onnx-<platform>`) is present.

| Feature       | `config.json`                          | Environment                 |
| ------------- | -------------------------------------- | --------------------------- |
| Everything    | `features.voice.enabled`               | `PASEO_VOICE`               |
| Dictation     | `features.dictation.enabled`           | `PASEO_DICTATION_ENABLED`   |
| Voice mode    | `features.voiceMode.enabled`           | `PASEO_VOICE_MODE_ENABLED`  |
| Spoken alerts | `features.voice.notifications.enabled` | `PASEO_VOICE_NOTIFICATIONS` |

Spoken alerts also need a text-to-speech provider: the local Kokoro model by default, or
OpenAI when `features.voiceMode.tts.provider` is `openai`. When TTS is not ready the daemon
sends the ordinary text notification and advertises nothing; the app never shows a Play
button it cannot honour. A daemon with spoken alerts available sets
`features.spokenNotifications` on `server_info`.

## How an alert is composed

When an agent finishes a turn, asks a question, requests a permission, or fails, the daemon
already builds a notification (`@fde/protocol/agent-attention-notification`). With spoken
alerts on it also composes a spoken line (`server/notifications/spoken-text.ts`):

- the agent's title and the workspace name are the subject: "Fix login in webapp finished.",
  "Refactor has a question.", "Refactor needs permission.", "Docs hit an error.";
- the same markdown-free gist the notification body uses follows, with bare URLs replaced by
  "a link";
- the whole line is capped at 200 characters on a sentence or word boundary so local TTS
  answers quickly.

Synthesis runs in the background (`server/notifications/spoken-alerts.ts`); the notification
is sent immediately with a fresh `id`, the `spokenText`, and `audioUrl` set to
`/api/notifications/<id>/audio`. The audio lands in `$PASEO_HOME/tts-cache/<sha256>.wav`
(raw PCM gets a WAV header; codec output such as OpenAI's mp3 is stored as-is). The cache is
least-recently-used and capped at 50 MB (`server/notifications/tts-cache.ts`). A request for
audio that is still being synthesised waits for it; one for audio that failed or was evicted
gets a 404 or a `null` answer.

Two ways to fetch the audio, both authenticated:

- `GET /api/notifications/<id>/audio` behind the daemon's bearer middleware, for tools and
  for clients with a direct HTTP path;
- the `notification.audio.request` session RPC, which the app uses everywhere because relay
  connections have no HTTP path. The response carries base64 bytes and a mime type.

## What the app does with it

- A banner above the agent's composer shows the spoken text with **Play/Stop** and **Reply
  by voice** (`components/spoken-alert-banner.tsx`). It stays until dismissed, superseded by
  a newer alert for the same agent, or a reply is sent.
- **Auto-play spoken alerts** (Settings > General > Voice alerts) plays an alert the moment
  it arrives while the app is in the foreground. It is on by default on iOS and Android and
  off on web and desktop.
- When auto-play is off and the user is elsewhere in the app, a toast offers a Play button.
- Desktop and web OS notifications keep their text; the in-app banner carries the Play action.
- A tapped mobile push carries `notificationId`, `spokenText`, and `audioUrl` in its data, so
  opening the agent from the notification seeds the banner and the audio is one tap away. The
  app never auto-plays from the background.

Playback goes through the shared voice audio engine (`voice/audio-engine.*`): WAV is unpacked
to PCM for both platforms; other codecs play only on web, where the engine can decode them.

## Reply by voice

**Reply by voice** opens a sheet (`components/voice-reply-sheet.tsx`) that records through the
daemon's dictation STT, then shows the transcript:

- with **Confirm voice replies** on (the default) the transcript sits for two seconds so it
  can be edited or cancelled; editing stops the countdown;
- with it off the transcript is sent as soon as it is final.

If the agent has a pending permission request, a short "yes / approve / allow" becomes an
allow and a short "no / deny / stop" becomes a deny (`spoken-alerts/permission-intent.ts`).
Anything longer or unclear is never sent by itself: the sheet asks whether to allow, deny, or
send the words as a message. Otherwise the transcript is sent as the agent's next message.

**Keep listening for the next alert** (the switch in the sheet) is the hands-free mode: once an
auto-played alert finishes, the sheet opens again on its own for the next reply.
