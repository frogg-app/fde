const { withAppBuildGradle } = require("expo/config-plugins");

// Expo's template signs `release` with the checked-in debug keystore. This plugin
// makes Gradle read a dedicated release keystore from the environment instead:
//
//   FROGG_ANDROID_KEYSTORE           absolute path to a .keystore / .jks file
//   FROGG_ANDROID_KEYSTORE_PASSWORD  store password
//   FROGG_ANDROID_KEY_ALIAS          key alias
//   FROGG_ANDROID_KEY_PASSWORD       key password (defaults to the store password)
//
// When FROGG_ANDROID_KEYSTORE is unset the release build stays debug-signed and Gradle
// prints a warning, so a local build still succeeds but the APK is only good for
// sideloading tests. The keystore itself is never part of the repo.

const MARKER = "// Frogg release signing (plugins/with-android-release-signing.js)";

const SIGNING_CONFIGS_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        ${MARKER}
        release {
            def froggKeystore = System.getenv("FROGG_ANDROID_KEYSTORE")
            if (froggKeystore) {
                storeFile file(froggKeystore)
                storePassword System.getenv("FROGG_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("FROGG_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("FROGG_ANDROID_KEY_PASSWORD") ?: System.getenv("FROGG_ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }`;

const RELEASE_SIGNING_LINE = `            signingConfig System.getenv("FROGG_ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug
            if (!System.getenv("FROGG_ANDROID_KEYSTORE")) {
                println "WARNING: FROGG_ANDROID_KEYSTORE is not set; the release APK is signed with the debug keystore."
            }`;

function configureReleaseSigning(contents) {
  if (contents.includes(MARKER)) {
    return contents;
  }

  const signingConfigsPattern = /^ {4}signingConfigs \{\n {8}debug \{[\s\S]*?\n {8}\}\n {4}\}/m;
  if (!signingConfigsPattern.test(contents)) {
    throw new Error("Could not find the signingConfigs block in android/app/build.gradle");
  }
  let configured = contents.replace(signingConfigsPattern, SIGNING_CONFIGS_BLOCK);

  const releasePattern =
    /(^ {8}release \{\n(?: {12}\/\/.*\n)*) {12}signingConfig signingConfigs\.debug\n/m;
  if (!releasePattern.test(configured)) {
    throw new Error("Could not find the release signingConfig line in android/app/build.gradle");
  }
  configured = configured.replace(releasePattern, `$1${RELEASE_SIGNING_LINE}\n`);
  return configured;
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = configureReleaseSigning(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.configureReleaseSigning = configureReleaseSigning;
