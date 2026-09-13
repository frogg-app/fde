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
import {
  DaemonUpdateService,
  type SpawnUpdateCli,
  type DaemonUpdateServiceOptions,
} from "./daemon-update-service.js";

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

function makeService(
  installDir: string,
  spawnCli: SpawnUpdateCli,
  listen: string | null = "0.0.0.0:9993",
  retained: Pick<DaemonUpdateServiceOptions, "getListen" | "retainAcrossGatewayRestart"> = {},
) {
  const emitted: SessionOutboundMessage[] = [];
  const service = new DaemonUpdateService({
    install: updatableInstall(installDir),
    daemonVersion: "0.1.13",
    fdeHome: path.join(installDir, "home"),
    listen,
    logger: pino({ level: "silent" }),
    env: { PATH: "/usr/bin" },
    spawnCli,
    checkTimeoutMs: 2000,
    ...retained,
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
      FDE_HOME: path.join(installDir, "home"),
      FDE_INSTALL_DIR: installDir,
      FDE_LISTEN: "0.0.0.0:9993",
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
      fdeHome: installDir,
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

describe("retained execution updates", () => {
  test("legacy execution keeps handoff active until its backend restarts", async () => {
    const installDir = makeDir();
    const fake = fakeChild();
    const { service } = makeService(installDir, () => fake.child);
    await service.start({ version: "0.1.14" });
    fake.stdout.write('{"event":"result","status":"handoff","targetVersion":"0.1.14"}\n');
    fake.finish(0);
    await flush();
    writeFileSync(
      path.join(installDir, "last-update.json"),
      JSON.stringify({ to: "0.1.14", at: new Date().toISOString(), status: "applied" }),
    );
    expect(service.status().run?.phase).toBe("restart");
    expect((await service.start()).accepted).toBe(false);
  });

  test.each(["applied", "rolled_back", "failed"])(
    "reconciles %s only after a matching fresh handoff result",
    async (status) => {
      const installDir = makeDir();
      const fake = fakeChild();
      const { service } = makeService(installDir, () => fake.child, "0.0.0.0:9993", {
        retainAcrossGatewayRestart: true,
      });
      await service.start({ version: "0.1.14" });
      const startedAt = service.currentRun()?.at;
      expect(typeof startedAt).toBe("string");
      const writeResult = (to: string, at: string) =>
        writeFileSync(
          path.join(installDir, "last-update.json"),
          JSON.stringify({ from: "0.1.13", to, at, status, reason: null }),
        );
      writeResult("0.1.14", "2000-01-01T00:00:00.000Z");
      fake.stdout.write('{"event":"result","status":"handoff","targetVersion":"0.1.14"}\n');
      fake.finish(0);
      await flush();
      expect(service.currentRun()?.phase).toBe("restart");
      writeResult("0.1.15", new Date().toISOString());
      expect(service.status().run?.phase).toBe("restart");
      writeResult("0.1.14", "invalid-time");
      expect((await service.start()).accepted).toBe(false);
      writeResult("0.1.14", new Date().toISOString());
      expect(service.status()).toMatchObject({
        run: null,
        currentVersion: "0.1.13",
        lastResult: { status, to: "0.1.14" },
      });
      expect((await service.start({ version: "0.1.15" })).accepted).toBe(true);
    },
  );

  test("does not reconcile before handoff, and start itself reconciles completed handoff", async () => {
    const installDir = makeDir();
    const fake = fakeChild();
    const { service } = makeService(installDir, () => fake.child, null, {
      retainAcrossGatewayRestart: true,
    });
    await service.start({ version: "0.1.14" });
    writeFileSync(
      path.join(installDir, "last-update.json"),
      JSON.stringify({ to: "0.1.14", at: new Date().toISOString(), status: "applied" }),
    );
    expect(service.currentRun()?.phase).toBe("check");
    fake.stdout.write('{"event":"result","status":"handoff","targetVersion":"0.1.14"}\n');
    fake.finish(0);
    await flush();
    expect((await service.start({ version: "0.1.15" })).accepted).toBe(true);
  });

  test("resolves the public listen endpoint for each CLI invocation", async () => {
    const installDir = makeDir();
    const calls: NodeJS.ProcessEnv[] = [];
    let listen: string | null = "0.0.0.0:9993";
    let fake = fakeChild();
    const { service } = makeService(
      installDir,
      (_command, _args, options) => {
        calls.push(options.env);
        return fake.child;
      },
      "127.0.0.1:1",
      { getListen: () => listen },
    );
    for (const next of ["0.0.0.0:9993", "0.0.0.0:9994", null]) {
      listen = next;
      fake = fakeChild();
      const pending = service.check();
      fake.stdout.write('{"event":"result","status":"check"}\n');
      fake.finish(0);
      await pending;
    }
    expect(calls.map((env) => env.FDE_LISTEN)).toEqual(["0.0.0.0:9993", "0.0.0.0:9994", undefined]);
  });
});

test("legacy update waits for handoff, shares the update lock, and reports staging failures", async () => {
  const fake = fakeChild();
  const { service } = makeService(makeDir(), () => fake.child);
  const pending = service.startLegacy();
  let settled = false;
  void pending.then(() => {
    settled = true;
    return null;
  });
  await flush();
  expect(settled).toBe(false);
  expect(await service.startLegacy()).toMatchObject({
    success: false,
    error: expect.stringContaining("already in progress"),
  });
  fake.stdout.write('{"event":"result","status":"handoff","targetVersion":"0.6.10"}\n');
  fake.finish(0);
  expect(await pending).toEqual({ success: true, error: null, newVersion: "0.6.10" });

  const failing = fakeChild();
  const other = makeService(makeDir(), () => failing.child);
  const failed = other.service.startLegacy();
  failing.stdout.write('{"event":"result","status":"failed","reason":"checksum mismatch"}\n');
  failing.finish(0);
  expect(await failed).toEqual({ success: false, error: "checksum mismatch", newVersion: null });
});
