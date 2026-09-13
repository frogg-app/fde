#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

function validate(options) {
  if (!options.serial?.trim() || !options.apk?.trim()) {
    throw new Error("Explicit --serial and --apk are required");
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(options.appId)) {
    throw new Error("Invalid --app-id");
  }
  if (!Number.isInteger(options.seconds) || options.seconds < 1 || options.seconds > 300) {
    throw new Error("--seconds must be an integer between 1 and 300");
  }
}

export function isAppForeground(activity, appId) {
  return activity
    .split("\n")
    .some(
      (line) =>
        /mResumedActivity|topResumedActivity/.test(line) &&
        line.split(/\s+/).some((token) => token.startsWith(`${appId}/`)),
    );
}

/** Two cold launches verify that the packaged app stays alive and foreground without Metro. */
export async function smokeAndroidApk(options, dependencies = {}) {
  const config = {
    appId: "app.frogg.frogg",
    seconds: 30,
    adb: "adb",
    outDir: "dist/android-startup-smoke",
    ...options,
  };
  validate(config);
  const run = dependencies.spawn ?? spawnSync;
  const wait = dependencies.sleep ?? sleep;
  const out = path.resolve(config.outDir);
  mkdirSync(out, { recursive: true });
  const transcript = [];
  const diagnostics = [];
  const launches = [];
  let since;
  let failure = null;
  const write = (name, value) => writeFileSync(path.join(out, name), value);
  function adb(args, { required = true, binary = false } = {}) {
    const result = run(config.adb, ["-s", config.serial, ...args], {
      encoding: binary ? undefined : "utf8",
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const error =
      result.error?.message ??
      (result.status !== 0 ? `exit ${result.status}: ${String(result.stderr ?? "")}` : null);
    transcript.push({
      args,
      status: result.status,
      error,
      stderr: String(result.stderr ?? ""),
      ...(binary ? {} : { stdout: String(result.stdout ?? "") }),
    });
    if (required && error) throw new Error(`adb ${args.join(" ")}: ${error}`);
    return result.stdout ?? (binary ? Buffer.alloc(0) : "");
  }
  function capture(name, args, binary = false) {
    try {
      write(name, adb(args, { binary }));
    } catch (error) {
      diagnostics.push({ artifact: name, error: error.message });
    }
  }
  try {
    const timestamp = adb(["shell", "date", "+%m-%d\\ %H:%M:%S.000"]).trim();
    if (!/^\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/.test(timestamp))
      throw new Error("Invalid device timestamp");
    since = timestamp;
    if (adb(["shell", "getprop", "sys.boot_completed"]).trim() !== "1") {
      throw new Error("Selected Android device has not completed boot");
    }
    const installation = adb(["install", "-r", path.resolve(config.apk)]);
    write("install.txt", installation);
    if (!/\bSuccess\b/.test(installation))
      throw new Error("APK installation did not report success");
    for (let attempt = 1; attempt <= 2; attempt++) {
      adb(["shell", "am", "force-stop", config.appId]);
      const launch = adb(["shell", "am", "start", "-W", "-n", `${config.appId}/.MainActivity`]);
      write(`launch-${attempt}.txt`, launch);
      if (/Error:|Exception/.test(launch)) throw new Error(`Activity launch ${attempt} failed`);
      // am start -W has its own short display deadline; observe the actual process
      // and foreground state even when that wait expires on a busy emulator.
      const observation = {
        attempt,
        activityWaitTimedOut: /Status: timeout/.test(launch),
        pid: null,
        samples: [],
      };
      launches.push(observation);
      for (let second = 0; second <= config.seconds; second++) {
        const pid = adb(["shell", "pidof", config.appId], { required: false }).trim();
        const activity = adb(["shell", "dumpsys", "activity", "activities"]);
        const foreground = isAppForeground(activity, config.appId);
        observation.samples.push({ second, pid, foreground });
        write(`activity-${attempt}.txt`, activity);
        if (!pid) throw new Error(`Application exited during launch ${attempt}`);
        if (observation.pid && observation.pid !== pid)
          throw new Error(`Application restarted during launch ${attempt}`);
        observation.pid = pid;
        if (!foreground)
          throw new Error(`Application left the foreground during launch ${attempt}`);
        if (second < config.seconds) await wait(1000);
      }
    }
  } catch (error) {
    failure = error.message;
  } finally {
    const range = since ? ["-T", since] : ["-t", "2000"];
    capture("logcat.txt", ["logcat", "-d", ...range]);
    capture("crash.txt", ["logcat", "-b", "crash", "-d", ...range]);
    capture("activity.txt", ["shell", "dumpsys", "activity", "activities"]);
    capture("screen.png", ["exec-out", "screencap", "-p"], true);
    write("adb.json", `${JSON.stringify(transcript, null, 2)}\n`);
  }
  const result = {
    serial: config.serial,
    apk: path.resolve(config.apk),
    appId: config.appId,
    secondsPerLaunch: config.seconds,
    launches,
    passed: !failure,
    failure,
    diagnostics,
  };
  write("result.json", `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      serial: { type: "string" },
      apk: { type: "string" },
      "app-id": { type: "string", default: "app.frogg.frogg" },
      adb: { type: "string", default: "adb" },
      "out-dir": { type: "string", default: "dist/android-startup-smoke" },
      seconds: { type: "string", default: "30" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: node scripts/release/smoke-android-apk.mjs --serial DEVICE --apk FILE [--app-id ID] [--adb PATH] [--out-dir DIR] [--seconds 30]",
    );
  } else {
    try {
      const result = await smokeAndroidApk({
        serial: values.serial,
        apk: values.apk,
        appId: values["app-id"],
        adb: values.adb,
        outDir: values["out-dir"],
        seconds: Number(values.seconds),
      });
      console.log(
        result.passed
          ? `PASS: two launches stayed alive and foreground for ${result.secondsPerLaunch}s each. Inspect ${values["out-dir"]}/screen.png to verify rendered content.`
          : `FAIL: ${result.failure}. Evidence: ${values["out-dir"]}`,
      );
      if (!result.passed) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
