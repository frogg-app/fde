# Android

The Expo app in `apps/ui` is also the Android app. It runs no daemon on the phone: it
connects to FDE daemons on other machines over TCP, WebSocket or the relay, exactly like
the web UI. Releases attach a sideloadable APK (see [ci.md](ci.md)); there is no Play
Store, EAS or F-Droid pipeline.

## Identity

| Variant (`APP_VARIANT`) | App name  | Package id            | Gradle variant |
| ----------------------- | --------- | --------------------- | -------------- |
| `production` (default)  | FDE       | `app.frogg.fde`       | `release`      |
| `development`           | FDE Debug | `app.frogg.fde.debug` | `debug`        |

Both come from `apps/ui/app.config.js`. The deep-link scheme stays `paseo://` for daemon
compatibility (see ROADMAP.md). Icons are `apps/ui/assets/images/icon.png` and
`android-icon-foreground.png`.

## Version and version code

The root `package.json` is the single version source. `app.config.js` reads it directly
and `apps/ui/native-release-version.js` derives the Android `versionCode` and iOS
`buildNumber`:

```text
versionCode = major * 1_000_000 + minor * 1_000 + patch      # 0.1.9 -> 1009
```

Bumping the version (see docs/ci.md "Cutting a release") therefore bumps the version
code; nothing is hand-maintained. Minor and patch each get three digits; change the
formula before either reaches `1000`. The F-Droid plugin (`plugins/with-fdroid-autolinking.js`,
only active with `PASEO_FDROID_BUILD=1`) multiplies it by 10 plus an ABI digit for
single-ABI builds; the normal release build keeps the base value for every ABI.

## Building the APK

`scripts/release/build-android-apk.mjs` is the one entry point, used locally and in CI.
It builds the workspace packages the JS bundle imports (`npm run build:app-deps`), runs
`expo prebuild --platform android --clean` (the `apps/ui/android` directory is generated and
gitignored), runs Gradle, and copies the APK to `release-assets/` as

```text
FDE-<version>-android-<abi>.apk             release-signed
FDE-<version>-android-<abi>-unsigned.apk    debug-signed, no keystore configured
```

```bash
export ANDROID_HOME=~/.local/share/android-sdk      # or wherever the SDK lives
node scripts/release/build-android-apk.mjs                          # arm64-v8a, release
node scripts/release/build-android-apk.mjs --abi universal          # all four ABIs in one APK
node scripts/release/build-android-apk.mjs --variant debug          # assembleDebug, app.frogg.fde.debug
node scripts/release/build-android-apk.mjs --skip-deps --skip-prebuild --serial
```

`--abi` accepts `arm64-v8a` (default, every phone since 2017), `armeabi-v7a`, `x86`,
`x86_64` or `universal`. `--serial` (`--max-workers=1`, no parallel Gradle) is for machines
with less than ~16 GB of RAM: the release build compiles the native ABIs and runs the
Hermes bundle in one Gradle invocation and can otherwise be killed with exit 137.
`--skip-deps` / `--skip-prebuild` reuse the previous run's `dist/` and `android/`.

No `google-services.json` is needed or used: the config only wires Firebase when
`GOOGLE_SERVICES_FILE_PROD` (or `apps/ui/.secrets/google-services.prod.json`) exists, so
push notifications are off and everything else works.

### Signing

Release builds read a dedicated keystore from the environment
(`apps/ui/plugins/with-android-release-signing.js` patches the generated
`android/app/build.gradle`):

| Variable                        | Meaning                                       |
| ------------------------------- | --------------------------------------------- |
| `FDE_ANDROID_KEYSTORE`          | absolute path to the `.keystore` / `.jks`     |
| `FDE_ANDROID_KEYSTORE_PASSWORD` | store password                                |
| `FDE_ANDROID_KEY_ALIAS`         | key alias                                     |
| `FDE_ANDROID_KEY_PASSWORD`      | key password (defaults to the store password) |

Unset, Gradle prints `WARNING: FDE_ANDROID_KEYSTORE is not set` and signs with the debug
key; the script names the APK `-unsigned`. Android treats a different signing key as a
different app, so a debug-signed APK cannot update a release-signed install and vice
versa. Keep one release keystore for the lifetime of `app.frogg.fde`; never commit it
(`*.keystore`, `*.jks` are gitignored).

Create one once:

```bash
keytool -genkeypair -v -keystore ~/.android/fde-release.keystore -alias fde \
  -keyalg RSA -keysize 2048 -validity 10000
```

For CI, store it as `FDE_ANDROID_KEYSTORE_BASE64` (`base64 -w0 ~/.android/fde-release.keystore`)
plus `FDE_ANDROID_KEYSTORE_PASSWORD`, `FDE_ANDROID_KEY_ALIAS` and `FDE_ANDROID_KEY_PASSWORD`
repository secrets (see [ci.md](ci.md)).

## Toolchain

`.tool-versions` pins `java 21` and `android-sdk 21.0` for [mise](https://mise.jdx.dev)
users. Without mise, on Debian/Ubuntu:

```bash
sudo apt-get install -y openjdk-21-jdk-headless unzip
SDK=~/.local/share/android-sdk; mkdir -p $SDK/cmdline-tools
curl -fsSLO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q commandlinetools-linux-13114758_latest.zip && mv cmdline-tools $SDK/cmdline-tools/latest
yes | $SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK --licenses
$SDK/cmdline-tools/latest/bin/sdkmanager --sdk_root=$SDK \
  "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
export ANDROID_HOME=$SDK
```

React Native 0.81 / Expo 54 compile against API 36 with NDK 27; once the licenses are
accepted Gradle downloads anything else it needs. The SDK is about 2.4 GB.

## Installing and running

```bash
adb install -r release-assets/FDE-<version>-android-arm64-v8a.apk
```

or copy the APK to the phone and open it (allow "install unknown apps" for the browser
or file manager). On first launch add a host: a daemon URL (`ws://host:6767` or the
relay pairing link) or scan the pairing QR code with the camera. The app keeps
`usesCleartextTraffic` so plain `http://`/`ws://` LAN daemons work.

Emulator: the AVD does not share the host's loopback; use `10.0.2.2:<port>` (or
`adb reverse tcp:<port> tcp:<port>` and `localhost`) for a daemon running on the same
machine. For the dev client (`npm run android` in `apps/ui`) also set
`REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2` so Metro is reachable.

## Notes

- `apps/ui/eas.json` and the `eas-cli` dev dependency are upstream leftovers; nothing here
  uses EAS.
- `PASEO_FDROID_BUILD=1` still selects upstream's source-only profile (no camera,
  notifications or dev client; every Expo module built from source). It is not used
  for FDE releases and needs far more memory.
- Keep `react`/`react-dom` at the version React Native embeds (`19.1.0` for RN 0.81):
  a newer React builds fine but crashes at startup with `Incompatible React versions`.
