import { describe, expect, it } from "vitest";

const { configureReleaseSigning } = require("./with-android-release-signing");

const template = [
  "android {",
  "    signingConfigs {",
  "        debug {",
  "            storeFile file('debug.keystore')",
  "            storePassword 'android'",
  "            keyAlias 'androiddebugkey'",
  "            keyPassword 'android'",
  "        }",
  "    }",
  "    buildTypes {",
  "        debug {",
  "            signingConfig signingConfigs.debug",
  "        }",
  "        release {",
  "            // Caution! In production, you need to generate your own keystore file.",
  "            // see https://reactnative.dev/docs/signed-apk-android.",
  "            signingConfig signingConfigs.debug",
  "            minifyEnabled enableMinifyInReleaseBuilds",
  "        }",
  "    }",
  "}",
].join("\n");

describe("withAndroidReleaseSigning", () => {
  it("adds an env-driven release signing config and keeps the debug one", () => {
    const result = configureReleaseSigning(template);
    expect(result).toContain('System.getenv("FDE_ANDROID_KEYSTORE")');
    expect(result).toContain("storeFile file('debug.keystore')");
    expect(result).toContain(
      'signingConfig System.getenv("FDE_ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    expect(result).toContain("WARNING: FDE_ANDROID_KEYSTORE is not set");
    // The debug build type is untouched.
    expect(result).toMatch(/debug \{\n {12}signingConfig signingConfigs\.debug\n {8}\}/);
    expect(result).toContain("minifyEnabled enableMinifyInReleaseBuilds");
  });

  it("is idempotent", () => {
    const once = configureReleaseSigning(template);
    expect(configureReleaseSigning(once)).toBe(once);
  });

  it("fails loudly when the template changed shape", () => {
    expect(() => configureReleaseSigning("android {}")).toThrow(/signingConfigs/);
  });
});
