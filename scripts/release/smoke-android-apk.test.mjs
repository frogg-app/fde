import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isAppForeground, smokeAndroidApk } from "./smoke-android-apk.mjs";

const appId = "app.frogg.fde";
const resumed = `mResumedActivity: ActivityRecord{abc u0 ${appId}/.MainActivity t1}`;
function fakeAdb(overrides = {}) {
  const calls = [];
  let launches = 0;
  let samples = 0;
  return {
    calls,
    spawn(command, args) {
      assert.equal(command, "fake-adb");
      assert.deepEqual(args.slice(0, 2), ["-s", "explicit-device"]);
      const action = args.slice(2);
      calls.push(action);
      const key = action.join(" ");
      let stdout = "";
      if (key.startsWith("shell date")) stdout = "09-12 19:30:00.000\n";
      else if (key === "shell getprop sys.boot_completed") stdout = "1\n";
      else if (action[0] === "install") {
        if (overrides.installFails)
          return { status: 1, stdout: "", stderr: "INSTALL_FAILED_UPDATE_INCOMPATIBLE" };
        stdout = "Success\n";
      } else if (key.startsWith("shell am start")) {
        launches++;
        samples = 0;
        stdout = "Status: ok\n";
      } else if (key.startsWith("shell pidof")) {
        samples++;
        stdout = overrides.pid?.(launches, samples) ?? `${launches}234\n`;
      } else if (key === "shell dumpsys activity activities")
        stdout = overrides.activity?.(launches, samples) ?? resumed;
      else if (action[0] === "logcat") {
        if (overrides.logcatFails) return { status: 1, stdout: "", stderr: "device offline" };
        stdout = action.includes("crash") ? "FATAL EXCEPTION captured\n" : "device logs retained\n";
      } else if (action[0] === "exec-out") stdout = Buffer.from("png");
      return { status: 0, stdout, stderr: "" };
    },
  };
}
async function runCase(overrides, inspect) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "android-smoke-test-"));
  const fake = fakeAdb(overrides);
  const waits = [];
  try {
    const result = await smokeAndroidApk(
      {
        serial: "explicit-device",
        apk: "build/app.apk",
        appId,
        seconds: 2,
        adb: "fake-adb",
        outDir,
      },
      { spawn: fake.spawn, sleep: async (ms) => waits.push(ms) },
    );
    assert.deepEqual(JSON.parse(await readFile(path.join(outDir, "result.json"), "utf8")), result);
    await inspect({ result, calls: fake.calls, waits, outDir });
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

test("installs and cold-launches twice, observing PID and foreground throughout each interval", async () => {
  await runCase({}, async ({ result, calls, waits, outDir }) => {
    assert.equal(result.passed, true);
    assert.deepEqual(
      result.launches.map((launch) => [launch.pid, launch.samples.length]),
      [
        ["1234", 3],
        ["2234", 3],
      ],
    );
    assert.deepEqual(waits, [1000, 1000, 1000, 1000]);
    assert.equal(calls.filter((args) => args[0] === "install").length, 1);
    assert.equal(calls.filter((args) => args.includes("force-stop")).length, 2);
    assert.equal(
      calls.some((args) => args.includes("-c")),
      false,
    );
    assert.deepEqual(
      calls.find((args) => args[0] === "logcat"),
      ["logcat", "-d", "-T", "09-12 19:30:00.000"],
    );
    assert.equal(
      await readFile(path.join(outDir, "crash.txt"), "utf8"),
      "FATAL EXCEPTION captured\n",
    );
  });
});

test("rejects an exited or restarted process even when a foreground activity remains", async () => {
  for (const [pid, failure] of [
    [() => "", /exited/],
    [(_launch, sample) => (sample === 1 ? "111" : "222"), /restarted/],
  ]) {
    await runCase({ pid }, async ({ result, outDir }) => {
      assert.equal(result.passed, false);
      assert.match(result.failure, failure);
      assert.match(await readFile(path.join(outDir, "logcat.txt"), "utf8"), /logs retained/);
    });
  }
});

test("detects foreground loss during observation, not only after the final wait", async () => {
  await runCase(
    {
      activity: (_launch, sample) =>
        sample === 2 ? "mResumedActivity: other.app/.MainActivity" : resumed,
    },
    async ({ result }) => {
      assert.equal(result.passed, false);
      assert.match(result.failure, /left the foreground/);
      assert.equal(result.launches[0].samples.length, 2);
    },
  );
  assert.equal(
    isAppForeground("mResumedActivity: app.frogg.fde.other/.MainActivity", appId),
    false,
  );
});

test("preserves diagnostics on install failure even when logcat also fails", async () => {
  await runCase({ installFails: true, logcatFails: true }, async ({ result, calls, outDir }) => {
    assert.equal(result.passed, false);
    assert.match(result.failure, /INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
    assert.equal(result.diagnostics.length, 2);
    assert.equal(
      calls.some((args) => args.includes("force-stop")),
      false,
    );
    assert.equal(await readFile(path.join(outDir, "screen.png"), "utf8"), "png");
  });
});

test("requires an explicit device and APK before issuing any adb command", async () => {
  await assert.rejects(smokeAndroidApk({ apk: "x.apk" }), /Explicit --serial/);
  await assert.rejects(smokeAndroidApk({ serial: "device" }), /Explicit --serial/);
  await assert.rejects(
    smokeAndroidApk({ serial: "device", apk: "x.apk", seconds: 0 }),
    /--seconds/,
  );
});
