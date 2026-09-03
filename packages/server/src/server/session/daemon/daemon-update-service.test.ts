import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import {
  describeDaemonInstall,
  findVersionRoot,
  readLastUpdateResult,
  type DaemonInstallInfo,
} from "./daemon-update-install.js";
import { DaemonUpdateService, type SpawnUpdateCli } from "./daemon-update-service.js";

const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "daemon-update-service-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A versioned install with the running daemon's module under versions/<v>. */
function makeVersionedInstall(version: string): { installDir: string; moduleUrl: string } {
  const installDir = makeDir();
  const root = path.join(installDir, "versions", version);
  mkdirSync(path.join(root, "bin"), { recursive: true });
  mkdirSync(path.join(root, "daemon", "packages", "server", "dist"), { recursive: true });
  writeFileSync(path.join(root, "bin", "fde"), "#!/bin/sh\n", { mode: 0o755 });
  const modulePath = path.join(root, "daemon", "packages", "server", "dist", "x.js");
  writeFileSync(modulePath, "");
  symlinkSync(path.join("versions", version), path.join(installDir, "current"));
  return { installDir, moduleUrl: `file://${modulePath}` };
}

interface FakeChild {
  child: ChildProcess;
  stdout: PassThrough;
  finish(code: number): void;
}

function fakeChild(): FakeChild {
  const emitter = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  Object.assign(emitter, { stdout, stderr, kill: () => true });
  return {
    child: emitter,
    stdout,
    finish(code) {
      stdout.end();
      setImmediate(() => emitter.emit("exit", code, null));
    },
  };
}

function updatableInstall(installDir: string): DaemonInstallInfo {
  return {
    installDir,
    updatable: true,
    reason: null,
    runningRoot: path.join(installDir, "versions", "0.1.13"),
    cliLauncher: path.join(installDir, "versions", "0.1.13", "bin", "fde"),
  };
}

function makeService(installDir: string, spawnCli: SpawnUpdateCli, listen = "0.0.0.0:9993") {
  const emitted: SessionOutboundMessage[] = [];
  const service = new DaemonUpdateService({
    install: updatableInstall(installDir),
    daemonVersion: "0.1.13",
    paseoHome: path.join(installDir, "home"),
    listen,
    logger: pino({ level: "silent" }),
    env: { PATH: "/usr/bin" },
    spawnCli,
    checkTimeoutMs: 2000,
  });
  service.setBroadcaster((msg) => emitted.push(msg));
  return { service, emitted };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("describeDaemonInstall", () => {
  test("recognizes a versioned install and points at its launcher", () => {
    const { installDir, moduleUrl } = makeVersionedInstall("0.1.13");
    const info = describeDaemonInstall({
      env: { FDE_INSTALL_DIR: installDir },
      desktopManaged: false,
      moduleUrl,
      platform: "linux",
    });
    expect(info.updatable).toBe(true);
    expect(info.runningRoot).toBe(path.join(installDir, "versions", "0.1.13"));
    expect(info.cliLauncher).toBe(path.join(installDir, "versions", "0.1.13", "bin", "fde"));
    expect(findVersionRoot("/nowhere/x.js", path.join(installDir, "versions"))).toBeNull();
  });

  test("explains why Docker, desktop-managed, and dev checkouts cannot self-update", () => {
    const installDir = makeDir();
    expect(
      describeDaemonInstall({
        env: { FDE_INSTALL_DIR: installDir, FDE_DOCKER: "1" },
        desktopManaged: false,
        platform: "linux",
      }),
    ).toMatchObject({ updatable: false, reason: expect.stringContaining("Pull the new image") });
    expect(
      describeDaemonInstall({
        env: { FDE_INSTALL_DIR: installDir },
        desktopManaged: true,
        platform: "linux",
      }).reason,
    ).toMatch(/FDE Desktop/);
    const dev = describeDaemonInstall({
      env: { FDE_INSTALL_DIR: installDir },
      desktopManaged: false,
      platform: "linux",
    });
    expect(dev.updatable).toBe(false);
    expect(dev.reason).toMatch(/versioned install/);
  });

  test("reads last-update.json and tolerates its absence", () => {
    const installDir = makeDir();
    expect(readLastUpdateResult(installDir)).toBeNull();
    writeFileSync(
      path.join(installDir, "last-update.json"),
      JSON.stringify({
        from: "0.1.13",
        to: "0.1.14",
        status: "rolled_back",
        reason: "boom",
        at: "t",
      }),
    );
    expect(readLastUpdateResult(installDir)).toEqual({
      from: "0.1.13",
      to: "0.1.14",
      status: "rolled_back",
      reason: "boom",
      at: "t",
    });
  });
});

describe("DaemonUpdateService", () => {
  test("check runs the CLI with the daemon's home and install dir and maps its result", async () => {
    const installDir = makeDir();
    const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
    const fake = fakeChild();
    const { service } = makeService(installDir, (command, args, options) => {
      calls.push({ command, args, env: options.env });
      return fake.child;
    });
    const pending = service.check({ channel: "beta" });
    fake.stdout.write('{"event":"progress","phase":"check","message":"checking"}\n');
    fake.stdout.write(
      '{"event":"result","status":"check","currentVersion":"0.1.13","targetVersion":"0.1.14","updatable":true,"updateAvailable":true,"releaseUrl":"https://r"}\n',
    );
    fake.finish(0);
    const result = await pending;
    expect(result).toMatchObject({
      updatable: true,
      channel: "beta",
      latestVersion: "0.1.14",
      updateAvailable: true,
      releaseUrl: "https://r",
      error: null,
    });
    expect(calls[0]?.command).toBe(path.join(installDir, "versions", "0.1.13", "bin", "fde"));
    expect(calls[0]?.args).toEqual([
      "daemon",
      "self-update",
      "--json",
      "--home",
      path.join(installDir, "home"),
      "--install-dir",
      installDir,
      "--check",
      "--channel",
      "beta",
    ]);
    expect(calls[0]?.env).toMatchObject({
      PASEO_HOME: path.join(installDir, "home"),
      FDE_INSTALL_DIR: installDir,
      PASEO_LISTEN: "0.0.0.0:9993",
    });
  });

  test("check reports a CLI that exits without a result as an error, not a throw", async () => {
    const installDir = makeDir();
    const fake = fakeChild();
    const { service } = makeService(installDir, () => fake.child);
    const pending = service.check();
    (fake.child.stderr as PassThrough).write("boom\n");
    fake.finish(1);
    const result = await pending;
    expect(result.error).toMatch(/exited with 1: boom/);
    expect(result.updateAvailable).toBe(false);
  });

  test("start broadcasts each phase, refuses a second run, and ends in the restart phase on handoff", async () => {
    const installDir = makeDir();
    const fake = fakeChild();
    const { service, emitted } = makeService(installDir, () => fake.child);

    const started = await service.start({ version: "0.1.14" });
    expect(started).toMatchObject({ accepted: true, targetVersion: "0.1.14" });
    expect(service.currentRun()?.phase).toBe("check");
    expect(await service.start()).toMatchObject({ accepted: false, runId: started.runId });

    fake.stdout.write('{"event":"progress","phase":"download","message":"downloading"}\n');
    fake.stdout.write('{"event":"progress","phase":"verify","message":"sha ok"}\n');
    fake.stdout.write('{"event":"progress","phase":"install","message":"unpacking"}\n');
    fake.stdout.write('{"event":"progress","phase":"restart","message":"supervisor started"}\n');
    fake.stdout.write('{"event":"result","status":"handoff","targetVersion":"0.1.14"}\n');
    fake.finish(0);
    await flush();

    const phases = emitted
      .filter((msg) => msg.type === "daemon.update.run.progress")
      .map((msg) => (msg as { payload: { phase: string } }).payload.phase);
    expect(phases).toEqual(["check", "download", "verify", "install", "restart", "restart"]);
    expect(service.status().run).toMatchObject({
      runId: started.runId,
      to: "0.1.14",
      phase: "restart",
    });
    expect(service.status()).toMatchObject({
      updatable: true,
      currentVersion: "0.1.13",
      installDir,
    });
  });

  test("a failed run clears the in-flight state and reports the reason", async () => {
    const installDir = makeDir();
    const fake = fakeChild();
    const { service, emitted } = makeService(installDir, () => fake.child);
    await service.start();
    fake.stdout.write('{"event":"result","status":"failed","reason":"checksum mismatch"}\n');
    fake.finish(1);
    await flush();
    expect(service.currentRun()).toBeNull();
    const last = emitted.at(-1) as { payload: { phase: string; message: string } };
    expect(last.payload).toMatchObject({ phase: "failed", message: "checksum mismatch" });
    expect(await service.start()).toMatchObject({ accepted: true });
  });

  test("a non-updatable install refuses to start", async () => {
    const installDir = makeDir();
    const service = new DaemonUpdateService({
      install: {
        installDir,
        updatable: false,
        reason: "dev checkout",
        runningRoot: null,
        cliLauncher: null,
      },
      daemonVersion: "0.1.13",
      paseoHome: installDir,
      listen: null,
      logger: pino({ level: "silent" }),
    });
    expect(await service.start()).toEqual({
      accepted: false,
      runId: null,
      targetVersion: null,
      error: "dev checkout",
    });
    expect(await service.check()).toMatchObject({ updatable: false, reason: "dev checkout" });
  });
});
