#!/usr/bin/env node
// Builds the FDE Android APK from apps/ui and copies it to <out-dir> under the
// release asset name documented in docs/android.md and docs/ci.md:
//
//   FDE-<version>-android-<abi>.apk            signed with the release keystore
//   FDE-<version>-android-<abi>-unsigned.apk   debug-signed (no keystore configured)
//
// <abi> is `arm64-v8a` (default), one of the other React Native ABIs, or
// `universal` (all four in one APK). The release keystore comes from the
// FDE_ANDROID_KEYSTORE* environment variables (see docs/android.md); when
// FDE_ANDROID_KEYSTORE is unset the APK is debug-signed and named accordingly.
//
// Usage: node scripts/release/build-android-apk.mjs [--abi arm64-v8a|universal|...]
//        [--variant release|debug] [--out-dir release-assets] [--skip-prebuild]
//        [--skip-deps] [--serial | --workers N]

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../..");
const UI_DIR = path.join(REPO_ROOT, "apps/ui");
const ANDROID_DIR = path.join(UI_DIR, "android");
const KNOWN_ABIS = ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"];

/** Pure: the asset name for a build; exported for the test. */
export function apkAssetName({ version, abi, signed, variant = "release" }) {
  let suffix = `-${variant}`;
  if (variant === "release") {
    suffix = signed ? "" : "-unsigned";
  }
  return `FDE-${version}-android-${abi}${suffix}.apk`;
}

/** Pure: Gradle arguments for an ABI; `universal` keeps the default (all four). */
export function gradleArgsFor({ abi, variant, serial, workers }) {
  const task = variant === "release" ? "assembleRelease" : "assembleDebug";
  const args = [task, "--no-daemon"];
  if (abi !== "universal") {
    if (!KNOWN_ABIS.includes(abi)) {
      throw new Error(`Unknown ABI "${abi}" (expected universal or ${KNOWN_ABIS.join(", ")})`);
    }
    args.push(`-PreactNativeArchitectures=${abi}`);
  }
  if (serial) {
    // Small-machine mode: one worker and heaps well below the 4 GB that
    // expo-gradle-jvmargs writes into gradle.properties (-D on the command line
    // wins), so an 8 GB host is not OOM-killed during the native build.
    args.push(
      "--max-workers=1",
      "-Dorg.gradle.parallel=false",
      "-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m",
      "-Dkotlin.daemon.jvm.options=-Xmx1024m",
    );
  } else if (workers) {
    args.push(`--max-workers=${workers}`);
  }
  return args;
}

function run(cmd, args, options = {}) {
  const shown = [cmd, ...args].join(" ");
  console.log(
    `\n$ ${shown}${options.cwd ? `   (in ${path.relative(REPO_ROOT, options.cwd)})` : ""}`,
  );
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${shown} exited with ${result.status ?? result.signal}`);
  }
}

/** Validates the release keystore environment and says which key the build will use. */
function reportSigning({ signed, variant }) {
  if (!signed) {
    if (variant === "release") {
      console.log(
        "FDE_ANDROID_KEYSTORE is not set: the release APK will be debug-signed (-unsigned suffix).",
      );
    }
    return;
  }
  if (!existsSync(process.env.FDE_ANDROID_KEYSTORE)) {
    throw new Error(`FDE_ANDROID_KEYSTORE does not exist: ${process.env.FDE_ANDROID_KEYSTORE}`);
  }
  for (const key of ["FDE_ANDROID_KEYSTORE_PASSWORD", "FDE_ANDROID_KEY_ALIAS"]) {
    if (!process.env[key]) throw new Error(`${key} is required when FDE_ANDROID_KEYSTORE is set`);
  }
  console.log(
    `Signing with ${process.env.FDE_ANDROID_KEYSTORE} (alias ${process.env.FDE_ANDROID_KEY_ALIAS}).`,
  );
}

function main() {
  const { values } = parseArgs({
    options: {
      abi: { type: "string", default: "arm64-v8a" },
      variant: { type: "string", default: "release" },
      "out-dir": { type: "string", default: "release-assets" },
      "skip-prebuild": { type: "boolean", default: false },
      "skip-deps": { type: "boolean", default: false },
      serial: { type: "boolean", default: false },
      workers: { type: "string" },
    },
  });
  const { abi, variant, serial } = values;
  const workers = values.workers ? Number(values.workers) : undefined;
  if (values.workers && !(Number.isInteger(workers) && workers > 0)) {
    throw new Error(`--workers must be a positive integer, got "${values.workers}"`);
  }
  if (variant !== "release" && variant !== "debug") {
    throw new Error(`--variant must be release or debug, got "${variant}"`);
  }
  const version = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")).version;
  const signed = variant === "release" && Boolean(process.env.FDE_ANDROID_KEYSTORE);

  if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
    throw new Error("ANDROID_HOME (or ANDROID_SDK_ROOT) must point at an Android SDK");
  }
  reportSigning({ signed, variant });

  const env = {
    ...process.env,
    CI: "1",
    APP_VARIANT: variant === "release" ? "production" : "development",
  };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  if (!values["skip-deps"] && variant === "release") {
    // Metro bundles the JS during assembleRelease; workspace packages need dist/.
    run(npm, ["run", "build:app-deps"], { cwd: REPO_ROOT, env });
  }
  if (!values["skip-prebuild"]) {
    run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], { cwd: UI_DIR, env });
  }
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  run(gradlew, gradleArgsFor({ abi, variant, serial, workers }), { cwd: ANDROID_DIR, env });

  const built = path.join(ANDROID_DIR, `app/build/outputs/apk/${variant}/app-${variant}.apk`);
  if (!existsSync(built)) throw new Error(`Gradle finished but ${built} is missing`);
  const outDir = path.resolve(REPO_ROOT, values["out-dir"]);
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, apkAssetName({ version, abi, signed, variant }));
  copyFileSync(built, target);
  const mb = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`\nAPK: ${target} (${mb} MB, ${signed ? "release-signed" : "debug-signed"})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`\nbuild-android-apk: ${error.message}`);
    process.exit(1);
  }
}
