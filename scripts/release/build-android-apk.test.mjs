import assert from "node:assert/strict";
import { test } from "node:test";
import { apkAssetName, gradleArgsFor } from "./build-android-apk.mjs";

test("asset name marks debug-signed release APKs", () => {
  assert.equal(
    apkAssetName({ version: "0.2.14", abi: "arm64-v8a", signed: false, appVariant: "development" }),
    "Frogg-0.2.14-android-arm64-v8a-development-unsigned.apk",
  );
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "arm64-v8a", signed: true }),
    "Frogg-0.1.9-android-arm64-v8a.apk",
  );
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "universal", signed: false }),
    "Frogg-0.1.9-android-universal-unsigned.apk",
  );
  assert.equal(
    apkAssetName({ version: "0.1.9", abi: "arm64-v8a", signed: false, variant: "debug" }),
    "Frogg-0.1.9-android-arm64-v8a-debug.apk",
  );
});

test("gradle args select the ABI and serial mode", () => {
  const testBuild = gradleArgsFor({ abi: "arm64-v8a", variant: "release", lowMemory: true });
  assert.ok(testBuild.includes("--max-workers=1"));
  assert.ok(testBuild.includes("--init-script"));
  assert.match(testBuild.at(-1), /android-low-memory\.gradle$/);
  assert.deepEqual(gradleArgsFor({ abi: "arm64-v8a", variant: "release", serial: false }), [
    ":app:assembleRelease",
    "--no-daemon",
    "-PreactNativeArchitectures=arm64-v8a",
  ]);
  assert.deepEqual(gradleArgsFor({ abi: "universal", variant: "debug", serial: true }), [
    ":app:assembleDebug",
    "--no-daemon",
    "--max-workers=1",
    "-Dorg.gradle.parallel=false",
    "-Dorg.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m",
    "-Dkotlin.daemon.jvm.options=-Xmx1024m",
  ]);
  assert.deepEqual(gradleArgsFor({ abi: "arm64-v8a", variant: "release", workers: 3 }), [
    ":app:assembleRelease",
    "--no-daemon",
    "-PreactNativeArchitectures=arm64-v8a",
    "--max-workers=3",
  ]);
  assert.throws(() => gradleArgsFor({ abi: "mips", variant: "release" }), /Unknown ABI/);
});
