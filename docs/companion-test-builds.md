# Companion test builds

Built from the Companion implementation in `feature/companion-voice-hands-free`, version
0.2.14, on 2026-09-12. These artifacts exercise the subscription/local-speech
baseline, plus the contextual composer launcher, persistent dismissal, quiet
updates and concurrent listening changes. Update both client and daemon. They
are not a signed production release.

## Artifacts

In `dist/companion-conversation-builds/`:

- `FDE-0.2.14-android-arm64-v8a-development-unsigned.apk`: standalone Android 10+
  ARM64 APK, application ID `app.frogg.fde.debug`, displayed as **FDE Debug**.
  Despite the inherited filename suffix, it is signed with the development key.
  It can coexist with production FDE and does not need Metro. Hermes bytecode uses
  `-O0` to build within this VM's memory; production optimization is unchanged.
- `fde-daemon-0.2.14-linux-x64.tar.gz`: Linux x64 daemon, CLI, browser UI, Node
  22.23.2, npm and native runtime dependencies. Tested on Ubuntu 24.04 x64.
  This is not a Windows, macOS or ARM daemon package.
- `SHA256SUMS`: checksums for the two artifacts.

No account credentials, workspaces, transcripts or speech models are included.
Model downloads happen on the target daemon; allow time and disk space for
Parakeet and Piper. Sign into Claude Code or Codex on that host using the account
that will run its daemon. Git and the selected provider CLI must be available.
The bundle's `node/bin` contains Node and npm if the host needs them.

## Run on another Linux host

The [Companion prerelease](https://github.com/frogg-app/fde/releases/tag/companion-preview-20260912-2)
contains the APK, daemon, checksums and a standalone installer. On Linux x64:

```sh
curl -fL https://github.com/frogg-app/fde/releases/download/companion-preview-20260912-2/install-companion-preview.sh -o /tmp/install-companion-preview.sh && bash /tmp/install-companion-preview.sh
```

The installer verifies the pinned archive checksum, starts the daemon with relay
enabled on port 6799 and prints pairing instructions. It uses separate
`~/.local/share/fde-companion-preview-20260912-2` and
`~/.fde-companion-preview-20260912-2` directories. It does not replace the regular
`fde` command or install a system service. Set `FDE_COMPANION_LISTEN` to choose
another port. Preview 2 uses a new state directory and port 6799 so it can run
alongside preview 1 without stopping it. Pair this new host in the app and add
the workspace you want to test. The provider CLI must already be installed and
signed in on this host.

For manual installation or a LAN-only test:

Copy the daemon archive and `SHA256SUMS`, then extract it:

```sh
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf fde-daemon-0.2.14-linux-x64.tar.gz
FDE_COMPANION_TEST_HOME="$(mktemp -d "$PWD/companion-test-state.XXXXXX")"
cat > "$FDE_COMPANION_TEST_HOME/config.json" <<'JSON'
{
  "features": {
    "voice": { "enabled": true },
    "companion": { "enabled": true, "backend": "subscription" }
  }
}
JSON
./fde-daemon-0.2.14-linux-x64/bin/fde start \
  --home "$FDE_COMPANION_TEST_HOME" --listen 0.0.0.0:6799 --no-relay --web-ui
./fde-daemon-0.2.14-linux-x64/bin/fde status --home "$FDE_COMPANION_TEST_HOME"
```

Use an unused port if 6799 is occupied. Keep the printed state path for subsequent
commands. Open `http://HOST_LAN_IP:6799` to confirm the browser UI loads. For a
remote phone, use the existing FDE pairing/relay workflow or a reachable private
network; the commands above deliberately set up a LAN test.

Install the APK on an ARM64 Android phone, open **FDE Debug**, and add the daemon
using its LAN address and port. If pairing is required, obtain the QR/link with:

```sh
./fde-daemon-0.2.14-linux-x64/bin/fde auth pair --home "$FDE_COMPANION_TEST_HOME"
```

Add a project/workspace, enable **Settings → General → Enable Companion**, and
use the bottom-right **Companion** composer launcher. Allow microphone access.
The sidebar no longer contains a Companion entry. Dismiss the panel to leave it
running; use End to finish. Configure reply length, updates, acknowledgements,
pauses and interruption in the same Settings section. Keep **Codex voice (preview)**
off for Android; its supported path uses local recognition and synthesis with
Claude or Codex subscription orchestration. No API key is needed. Conversation
and worker activity still consume subscription allowance.

For explicit conversation-provider selection, use `"backend": "claude"` or
`"backend": "codex"` in this test state's config. Worker provider/model selection
is independent. Missing login or unavailable speech models appear as setup failures.

Stop only this test daemon when finished:

```sh
./fde-daemon-0.2.14-linux-x64/bin/fde stop --home "$FDE_COMPANION_TEST_HOME"
```

## Acceptance workflow

Start Companion, choose an existing project by voice, request a small change,
minimize it and lock the screen. Ask for progress while the worker runs, answer a
specific permission request, hear the completed result, and end by voice. Also
test barge-in, mute/unmute, End during reconnect, Wi-Fi changes, headset changes,
an incoming call and a 30-minute session. Disabling Companion must remove its
launch controls and release capture without cancelling workers.

The APK passed packaging/signature/service inspection. Automated lifecycle,
speech, provider, protocol and client tests passed; the extracted daemon was
tested separately with its bundled dependencies. Physical Android/iOS background
behavior and microphone-to-speaker latency remain acceptance work. Native Codex
WebRTC remains a desktop/web preview: its upstream interface does not provide
per-job playback receipts, so already-heard results can repeat after reconnect.
See `docs/companion-validation.md` in the source checkout for the detailed record.

## Rebuild

```sh
ANDROID_HOME=/path/to/android-sdk node scripts/release/build-android-apk.mjs \
  --app-variant development --low-memory --out-dir dist/companion-conversation-builds
npm run build:server
npm run build:daemon-web-ui
node scripts/release/build-daemon-bundle.mjs \
  --target linux-x64 --out-dir dist/companion-conversation-builds
```
