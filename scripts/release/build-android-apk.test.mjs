import assert from "node:assert/strict";
import { test } from "node:test";
import { apkAssetName, gradleArgsFor } from "./build-android-apk.mjs";

test("asset name marks debug-signed release APKs", () => {
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "arm64-v8a", signed: true }),
    "FDE-0.1.9-android-arm64-v8a.apk",
  );
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "universal", signed: false }),
    "FDE-0.1.9-android-universal-unsigned.apk",
  );
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "arm64-v8a", signed: false, variant: "debug" }),
    "FDE-0.1.9-android-arm64-v8a-debug.apk",
  );
});

test("gradle args select the ABI and serial mode", () => {
  assert.deepEqual(gradleArgsFor({ abi: "arm64-v8a", variant: "release", serial: false }), [
    "assembleRelease",
    "--no-daemon",
    "-PreactNativeArchitectures=arm64-v8a",
  ]);
  assert.deepEqual(gradleArgsFor({ abi: "universal", variant: "debug", serial: true }), [
    "assembleDebug",
    "--no-daemon",
    "--max-workers=1",
    "-Dorg.gradle.parallel=false",
    "-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m",
    "-Dkotlin.daemon.jvm.options=-Xmx1024m",
  ]);
  assert.deepEqual(gradleArgsFor({ abi: "arm64-v8a", variant: "release", workers: 3 }), [
    "assembleRelease",
    "--no-daemon",
    "-PreactNativeArchitectures=arm64-v8a",
    "--max-workers=3",
  ]);
  assert.throws(() => gradleArgsFor({ abi: "mips", variant: "release" }), /Unknown ABI/);
});
